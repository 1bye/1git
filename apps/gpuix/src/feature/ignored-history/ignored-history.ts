import { isUtf8 } from "node:buffer";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	lstat,
	mkdir,
	open,
	readFile,
	readdir,
	realpath,
	rename,
	rm,
	stat,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createTwoFilesPatch } from "diff";
import { GitIgnore } from "@1git/git";
import type { CredentialVault } from "../accounts/lib/native-credentials";
import { WorkspaceSessionStore } from "../workspace-tabs/lib/workspace-session-store";
import {
	historyChunkBytes,
	historyMaxFiles,
	historyPath,
	historyWrite,
	HistoryStorage,
	type HistoryManifest,
	type HistoryVersion,
} from "./history-storage";

/** Canonical local worktree identity supplied by an opened Git repository. */
export interface IgnoredRepository {
	readonly root: string;
	readonly commonDirectory: string;
	readonly gitDirectory: string;
}

/** Explicit selections are recursive; preferences are shared by linked worktrees. */
export interface IgnoredPreferences {
	readonly enabled: boolean;
	readonly paths: readonly string[];
	readonly budgetBytes: number;
	readonly maxVersions: number;
}
export const defaultIgnoredPreferences: IgnoredPreferences = {
	enabled: false,
	paths: [],
	budgetBytes: 512 * 1024 * 1024,
	maxVersions: 20,
};

/** A file's current captured version and its accepted baseline, without decrypted content. */
export interface IgnoredFile {
	readonly path: string;
	readonly baseline: string | null;
	readonly versions: readonly HistoryVersion[];
	readonly changed: boolean;
}
export interface IgnoredHistoryState {
	readonly preferences: IgnoredPreferences;
	readonly files: readonly IgnoredFile[];
	readonly bytes: number;
	readonly skipped: readonly string[];
}

const missing = (error: unknown): boolean =>
	error instanceof Error && "code" in error && error.code === "ENOENT";

const inside = (parent: string, child: string): boolean => {
	const path = relative(parent, child);

	return !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
};

const selected = (paths: readonly string[], path: string): boolean =>
	paths.some((parent) => path === parent || path.startsWith(`${parent}/`));

const emptyState = (preferences: IgnoredPreferences): IgnoredHistoryState => ({
	preferences,
	files: [],
	bytes: 0,
	skipped: [],
});

/** Owns one window's encrypted local-history access; no source contents enter preferences or logs. */
export class IgnoredHistory {
	private readonly observed = new Map<string, string>();
	private readonly operations = new Map<string, Promise<unknown>>();

	constructor(
		private readonly vault: CredentialVault,
		readonly directory = process.env.GPUIX_IGNORED_HISTORY_PATH ??
			join(dirname(WorkspaceSessionStore.defaultPath()), "ignored-history")
	) {}

	/** Releases the memory cache when a worktree closes; saved history remains encrypted on disk. */
	release(root: string): void {
		for (const key of this.observed.keys())
			if (key.startsWith(`${root}\0`)) this.observed.delete(key);
	}

	async preferences(
		repository: IgnoredRepository
	): Promise<IgnoredPreferences> {
		if (!isAbsolute(repository.root)) return defaultIgnoredPreferences;

		try {
			const path = join(this.repositoryDirectory(repository), "settings.json");

			if ((await stat(path)).size > 64 * 1024)
				throw new Error("Invalid ignored-history settings.");

			return IgnoredHistory.parsePreferences(
				JSON.parse(await readFile(path, "utf8"))
			);
		} catch (error) {
			if (missing(error)) return defaultIgnoredPreferences;

			throw new Error(
				"Could not read ignored-history settings. The saved file was left unchanged."
			);
		}
	}

	async configure(
		repository: IgnoredRepository,
		input: IgnoredPreferences,
		signal?: AbortSignal
	): Promise<IgnoredHistoryState> {
		const preferences = IgnoredHistory.parsePreferences(input);

		return await this.lock(repository, async () => {
			const previous = await this.preferences(repository);

			if (!preferences.enabled) {
				await historyWrite(
					join(this.repositoryDirectory(repository), "settings.json"),
					JSON.stringify(preferences)
				);

				return emptyState(preferences);
			}

			if (!preferences.paths.length)
				throw new Error("Select at least one ignored file or folder.");

			for (const path of preferences.paths) {
				await this.safePath(repository, path, true);

				if (!(await GitIgnore.isIgnored(repository.root, path, signal)))
					throw new Error(
						`“${path}” must be ignored by Git and not tracked. Select an ignored file or folder.`
					);
			}

			const storage = await this.storage(repository, true);
			const manifest = await storage.load();

			const result = await this.capture(
				repository,
				storage,
				manifest,
				preferences,
				preferences.paths.filter((path) => !previous.paths.includes(path)),
				signal
			);

			await historyWrite(
				join(this.repositoryDirectory(repository), "settings.json"),
				JSON.stringify(preferences)
			);

			return result;
		});
	}

	async refresh(
		repository: IgnoredRepository,
		signal?: AbortSignal
	): Promise<IgnoredHistoryState> {
		const preferences = await this.preferences(repository);

		if (!preferences.enabled) return emptyState(preferences);

		return await this.lock(repository, async () => {
			const current = await this.preferences(repository);

			if (!current.enabled) return emptyState(current);

			const storage = await this.storage(repository, false);

			return await this.capture(
				repository,
				storage,
				await storage.load(),
				current,
				[],
				signal
			);
		});
	}

	/** Accepts only the version shown in the UI; opening a diff never advances the baseline. */
	async accept(
		repository: IgnoredRepository,
		path: string,
		expected: string
	): Promise<void> {
		await this.lock(repository, async () => {
			const preferences = await this.preferences(repository);

			await this.requireEligible(repository, path, preferences);
			const storage = await this.storage(repository, false);
			const manifest = await storage.load();
			const file = manifest.files[path];

			if (!file || file.versions[0]?.id !== expected)
				throw new Error("This file changed. Refresh and review it again.");

			const current = await this.captureFile(repository, path, storage, {
				used: await storage.collect(manifest),
				limit: preferences.budgetBytes,
			});

			if (current.id !== expected)
				throw new Error("This file changed. Refresh and review it again.");

			file.baseline = expected;
			await storage.save(manifest);
		});
	}

	/** Saves the current file before replacing it, and refuses tracked files, links or stale reviews. */
	async restore(
		repository: IgnoredRepository,
		path: string,
		versionId: string | null,
		expected: string
	): Promise<IgnoredHistoryState> {
		return await this.lock(repository, async () => {
			const preferences = await this.preferences(repository);

			await this.requireEligible(repository, path, preferences);
			const storage = await this.storage(repository, false);
			const manifest = await storage.load();
			const file = manifest.files[path];

			const target =
				versionId === null
					? this.absent(storage)
					: file?.versions.find((item) => item.id === versionId);

			if (!file || !target || file.versions[0]?.id !== expected)
				throw new Error("This saved version is unavailable. Refresh history.");

			const budget = {
				used: await storage.collect(manifest),
				limit: preferences.budgetBytes,
			};

			const current = await this.captureFile(repository, path, storage, budget);

			if (current.id !== expected)
				throw new Error(
					"This file changed since review. Refresh before restoring."
				);

			this.remember(file, current, preferences.maxVersions);
			await storage.save(manifest);
			const destination = await this.safePath(repository, path, true);

			// Git metadata keeps decrypted restore scratch files out of every commit path.
			const temporary = join(
				repository.gitDirectory,
				`.1git-restore-${randomUUID()}`
			);

			try {
				if (!target.deleted) {
					const output = await open(temporary, "wx", 0o600);

					try {
						for (const id of target.chunks) {
							const chunk = await storage.readChunk(id);

							try {
								await output.writeFile(chunk);
							} finally {
								chunk.fill(0);
							}
						}

						await output.chmod(target.mode);
						await output.sync();
					} finally {
						await output.close();
					}
				}

				await this.requireEligible(repository, path, preferences);
				const rechecked = await this.captureFile(
					repository,
					path,
					storage,
					budget
				);

				if (rechecked.id !== expected)
					throw new Error(
						"This file changed during restore. Nothing was replaced."
					);

				await this.safePath(repository, path, true);

				if (target.deleted) await rm(destination, { force: true });
				else {
					await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
					await this.safePath(repository, path, true);
					await rename(temporary, destination);
				}
			} finally {
				await rm(temporary, { force: true });
			}

			return await this.capture(repository, storage, manifest, preferences, []);
		});
	}

	/** Produces bounded in-memory text patches; decrypted snapshots never become diff temp files. */
	async diff(
		repository: IgnoredRepository,
		path: string,
		versionId: string | null,
		expected: string,
		signal?: AbortSignal,
		ignoreWhitespace = false
	): Promise<{ patch: string; message: string | null }> {
		return await this.lock(
			repository,
			async () =>
				await this.readDiff(
					repository,
					path,
					versionId,
					expected,
					signal,
					ignoreWhitespace
				)
		);
	}

	private async readDiff(
		repository: IgnoredRepository,
		path: string,
		versionId: string | null,
		expected: string,
		signal?: AbortSignal,
		ignoreWhitespace = false
	): Promise<{ patch: string; message: string | null }> {
		historyPath(path);
		const storage = await this.storage(repository, false);
		const manifest = await storage.load();
		const file = manifest.files[path];
		const current = file?.versions[0];

		const before =
			versionId === null
				? this.absent(storage)
				: file?.versions.find((item) => item.id === versionId);

		if (!current || !before || current.id !== expected)
			throw new Error("The comparison changed. Refresh history.");

		if (current.size > 512 * 1024 || before.size > 512 * 1024)
			return {
				patch: "",
				message:
					"Large file — history and restore are available; text preview exceeds 512 KiB.",
			};

		const read = async (version: HistoryVersion): Promise<Buffer> => {
			const chunks: Buffer[] = [];

			try {
				for (const id of version.chunks) {
					signal?.throwIfAborted();
					chunks.push(await storage.readChunk(id));
				}

				return Buffer.concat(chunks);
			} finally {
				for (const chunk of chunks) chunk.fill(0);
			}
		};

		const left = await read(before);
		let right: Buffer | undefined;

		try {
			right = await read(current);

			if (
				left.includes(0) ||
				right.includes(0) ||
				!isUtf8(left) ||
				!isUtf8(right)
			)
				return {
					patch: "",
					message: "Binary file — saved versions can be restored.",
				};

			const quoted = (prefix: string) => JSON.stringify(`${prefix}/${path}`);

			const patch = createTwoFilesPatch(
				before.deleted ? "/dev/null" : quoted("a"),
				current.deleted ? "/dev/null" : quoted("b"),
				left.toString("utf8"),
				right.toString("utf8"),
				undefined,
				undefined,
				{ context: 3, timeout: 100, maxEditLength: 2000, ignoreWhitespace }
			);

			if (
				!patch ||
				Buffer.byteLength(patch) > 512 * 1024 ||
				patch.split("\n").length > 2000
			)
				return {
					patch: "",
					message:
						"This change exceeds the safe text preview limit. Saved versions can still be restored.",
				};

			let message: string | null = null;

			if (current.id === before.id)
				message = "No changes from this saved version.";
			else if (!/^@@ /m.test(patch))
				message = ignoreWhitespace
					? "No textual changes with whitespace hidden."
					: "No textual changes; file metadata or presence changed.";

			return {
				patch: `diff --git ${quoted("a")} ${quoted("b")}\n${patch}`,
				message,
			};
		} finally {
			left.fill(0);
			right?.fill(0);
		}
	}

	private async capture(
		repository: IgnoredRepository,
		storage: HistoryStorage,
		original: HistoryManifest,
		preferences: IgnoredPreferences,
		baselinePaths: readonly string[],
		signal?: AbortSignal
	): Promise<IgnoredHistoryState> {
		const manifest = structuredClone(original);

		manifest.files = Object.assign(Object.create(null), manifest.files);
		let modified = !original.initialized;
		const skipped: string[] = [];

		const candidates = new Set(
			await GitIgnore.list(repository.root, preferences.paths, signal)
		);

		if (candidates.size > historyMaxFiles)
			throw new Error(
				"The selection exceeds 100,000 files. Choose smaller folders."
			);

		const budget = {
			used: await storage.collect(original),
			limit: preferences.budgetBytes,
		};

		const eligible = new Set<string>();

		try {
			for (const path of new Set([
				...candidates,
				...Object.keys(manifest.files).filter((path) =>
					selected(preferences.paths, path)
				),
			])) {
				signal?.throwIfAborted();
				historyPath(path);

				if (
					!candidates.has(path) &&
					!(await GitIgnore.isIgnored(repository.root, path, signal))
				) {
					skipped.push(path);
					continue;
				}

				try {
					await this.safePath(repository, path, true);
				} catch {
					skipped.push(path);
					continue;
				}

				eligible.add(path);
				const file = manifest.files[path];
				const absolute = resolve(repository.root, path);

				const info = await lstat(absolute, { bigint: true }).catch(
					(error: unknown) => {
						if (missing(error)) return null;

						throw error;
					}
				);

				const fingerprint = info
					? `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.mode}`
					: "absent";

				const cacheKey = `${repository.root}\0${path}`;

				if (
					file &&
					this.observed.get(cacheKey) ===
						`${file.versions[0]?.id}:${fingerprint}`
				)
					continue;

				const version = await this.captureFile(
					repository,
					path,
					storage,
					budget,
					signal
				);

				if (file) this.remember(file, version, preferences.maxVersions);
				else
					manifest.files[path] = {
						baseline: selected(
							original.initialized ? baselinePaths : preferences.paths,
							path
						)
							? version.id
							: null,
						versions: [version],
					};

				if (
					!file ||
					file.versions[0]?.id !== original.files[path]?.versions[0]?.id
				)
					modified = true;

				this.observed.set(cacheKey, `${version.id}:${fingerprint}`);
			}

			if (Object.keys(manifest.files).length > historyMaxFiles)
				throw new Error("History reached its 100,000-file limit.");

			signal?.throwIfAborted();
			manifest.initialized = true;

			if (modified) await storage.save(manifest);
		} catch (error) {
			await storage.collect(original);

			throw error;
		}

		const bytes = await storage.collect(manifest);

		return {
			preferences,
			bytes,
			skipped,
			files: Object.entries(manifest.files)
				.filter(([path]) => eligible.has(path))
				.map(([path, file]) => ({
					path,
					...file,
					changed:
						file.baseline === null
							? !file.versions[0]?.deleted
							: file.versions[0]?.id !== file.baseline,
				})),
		};
	}

	private async captureFile(
		repository: IgnoredRepository,
		path: string,
		storage: HistoryStorage,
		budget: { used: number; limit: number },
		signal?: AbortSignal
	): Promise<HistoryVersion> {
		const absolute = await this.safePath(repository, path, true);
		let file;

		try {
			file = await open(
				absolute,
				constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
			);
		} catch (error) {
			if (missing(error)) return this.absent(storage);

			throw error;
		}

		try {
			const start = await file.stat({ bigint: true });

			if (!start.isFile() || start.nlink !== 1n)
				throw new Error(
					"History supports regular files without symbolic or hard links."
				);

			const size = Number(start.size);

			if (!Number.isSafeInteger(size) || size > budget.limit)
				throw new Error("This file is larger than the history storage budget.");

			const chunks: string[] = [];
			const buffer = Buffer.alloc(historyChunkBytes);

			try {
				for (let position = 0; position < size;) {
					signal?.throwIfAborted();
					const length = Math.min(historyChunkBytes, size - position);
					let read = 0;

					while (read < length) {
						const result = await file.read(
							buffer,
							read,
							length - read,
							position + read
						);

						if (!result.bytesRead)
							throw new Error(
								"A monitored file changed while reading it. Capture will retry."
							);

						read += result.bytesRead;
					}

					chunks.push(await storage.chunk(buffer.subarray(0, length), budget));
					position += length;
				}
			} finally {
				buffer.fill(0);
			}

			const end = await file.stat({ bigint: true });
			const current = await lstat(absolute, { bigint: true });

			if (
				current.ino !== start.ino ||
				current.dev !== start.dev ||
				start.size !== end.size ||
				start.mtimeNs !== end.mtimeNs ||
				start.ctimeNs !== end.ctimeNs
			)
				throw new Error(
					"A monitored file changed while reading it. Capture will retry."
				);

			const mode = Number(start.mode) & 0o777;

			return {
				id: storage.id(JSON.stringify([size, mode, chunks])),
				at: new Date().toISOString(),
				chunks,
				size,
				mode,
				deleted: false,
			};
		} finally {
			await file.close();
		}
	}

	private absent(storage: HistoryStorage): HistoryVersion {
		return {
			id: storage.id("absent"),
			at: new Date().toISOString(),
			size: 0,
			mode: 0o600,
			chunks: [],
			deleted: true,
		};
	}

	private remember(
		file: HistoryManifest["files"][string],
		version: HistoryVersion,
		limit: number
	): void {
		if (file.versions[0]?.id === version.id) return;

		const baseline = file.versions.find((item) => item.id === file.baseline);

		file.versions = [
			version,
			...file.versions.filter((item) => item.id !== version.id),
		].slice(0, limit);

		if (baseline && !file.versions.some((item) => item.id === baseline.id))
			file.versions.push(baseline);
	}

	private async requireEligible(
		repository: IgnoredRepository,
		path: string,
		preferences: IgnoredPreferences
	): Promise<void> {
		historyPath(path);

		if (
			!preferences.enabled ||
			!selected(preferences.paths, path) ||
			!(await GitIgnore.isIgnored(repository.root, path))
		)
			throw new Error(
				"This path is no longer monitored and ignored. No file was changed."
			);

		await this.safePath(repository, path, true);
	}

	private async safePath(
		repository: IgnoredRepository,
		path: string,
		allowMissing: boolean
	): Promise<string> {
		historyPath(path);
		const root = await realpath(repository.root);
		let current = root;
		const parts = path.split("/");

		for (const [index, part] of parts.entries()) {
			current = join(current, part);
			let info;

			try {
				info = await lstat(current);
			} catch (error) {
				if (allowMissing && missing(error)) return resolve(root, path);

				throw error;
			}

			if (
				info.isSymbolicLink() ||
				(!info.isDirectory() && (!info.isFile() || info.nlink !== 1)) ||
				(index < parts.length - 1 && !info.isDirectory())
			)
				throw new Error(
					"Monitored paths must be ordinary files or folders without links."
				);
		}

		return current;
	}

	private repositoryDirectory(repository: IgnoredRepository): string {
		return join(
			this.directory,
			HistoryStorage.identity(repository.commonDirectory)
		);
	}

	private async storage(
		repository: IgnoredRepository,
		create: boolean
	): Promise<HistoryStorage> {
		const directory = join(
			this.repositoryDirectory(repository),
			HistoryStorage.identity(repository.root)
		);

		let existing = false;

		try {
			await stat(join(directory, "history.enc"));
			existing = true;
		} catch (error) {
			if (!missing(error)) throw error;
		}

		if (create && !existing) {
			for (const entry of await readdir(this.repositoryDirectory(repository), {
				withFileTypes: true,
			})) {
				if (!entry.isDirectory() || !/^[a-f0-9]{64}$/u.test(entry.name))
					continue;

				try {
					await stat(
						join(
							this.repositoryDirectory(repository),
							entry.name,
							"history.enc"
						)
					);
					existing = true;
					break;
				} catch (error) {
					if (!missing(error)) throw error;
				}
			}
		}

		const key = await HistoryStorage.key(
			this.vault,
			repository.commonDirectory,
			create && !existing
		);

		return new HistoryStorage(directory, key);
	}

	private async lock<T>(
		repository: IgnoredRepository,
		operation: () => Promise<T>
	): Promise<T> {
		const previous = this.operations.get(repository.commonDirectory);

		const pending = (async () => {
			// A failed capture must not prevent the next explicit retry.
			await previous?.catch(() => undefined);

			return await this.exclusive(repository, operation);
		})();

		this.operations.set(repository.commonDirectory, pending);

		try {
			return await pending;
		} finally {
			if (this.operations.get(repository.commonDirectory) === pending)
				this.operations.delete(repository.commonDirectory);
		}
	}

	private async exclusive<T>(
		repository: IgnoredRepository,
		operation: () => Promise<T>
	): Promise<T> {
		if (!isAbsolute(repository.root))
			throw new Error(
				"Ignored history is currently available for local repositories only."
			);

		const root = await realpath(repository.root);

		await mkdir(this.directory, { recursive: true, mode: 0o700 });

		if (inside(root, await realpath(this.directory)))
			throw new Error("History storage must be outside the repository.");

		const directory = this.repositoryDirectory(repository);

		await mkdir(directory, { recursive: true, mode: 0o700 });
		const path = join(directory, "capture.lock");
		let lock;

		try {
			lock = await open(path, "wx", 0o600);
		} catch (error) {
			if (
				error instanceof Error &&
				"code" in error &&
				error.code === "EEXIST"
			) {
				const pid = Number(await readFile(path, "utf8"));
				let dead = false;

				if (Number.isSafeInteger(pid) && pid > 0) {
					try {
						process.kill(pid, 0);
					} catch (cause) {
						dead =
							cause instanceof Error &&
							"code" in cause &&
							cause.code === "ESRCH";
					}
				}

				if (dead) {
					await rm(path);

					return await this.exclusive(repository, operation);
				}

				throw new Error(
					"History is busy in another operation or window. Try again shortly."
				);
			}

			throw error;
		}

		try {
			await lock.writeFile(String(process.pid));

			return await operation();
		} finally {
			await lock.close();
			await rm(path, { force: true });
		}
	}

	private static parsePreferences(value: unknown): IgnoredPreferences {
		if (
			!value ||
			typeof value !== "object" ||
			!("enabled" in value) ||
			typeof value.enabled !== "boolean" ||
			!("paths" in value) ||
			!Array.isArray(value.paths) ||
			value.paths.length > 100 ||
			!("budgetBytes" in value) ||
			typeof value.budgetBytes !== "number" ||
			!Number.isSafeInteger(value.budgetBytes) ||
			value.budgetBytes < 1024 * 1024 ||
			value.budgetBytes > 100 * 1024 ** 3 ||
			!("maxVersions" in value) ||
			typeof value.maxVersions !== "number" ||
			!Number.isInteger(value.maxVersions) ||
			value.maxVersions < 2 ||
			value.maxVersions > 100
		)
			throw new Error(
				"Choose up to 100 paths, a 1 MiB–100 GiB budget, and 2–100 retained versions."
			);

		return {
			enabled: value.enabled,
			paths: [...new Set(value.paths.map(historyPath))],
			budgetBytes: value.budgetBytes,
			maxVersions: value.maxVersions,
		};
	}
}
