import { GitRepository } from "@1git/git";
import { readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";

/** Local discovery intent only; found repositories never become saved history automatically. */
export interface RepositoryDiscoveryPreferences {
	readonly folders: readonly string[];
	readonly hidden: readonly string[];
}

/** Batched, cumulative scan results. Skipped folders and safety limits are never reported as a complete scan. */
export interface RepositoryDiscoveryProgress {
	readonly paths: readonly string[];
	readonly scanned: number;
	readonly skipped: number;
	readonly limited: boolean;
}

const excludedFolders = new Set([
	".git",
	".Trash",
	".cache",
	".npm",
	".bun",
	".cargo",
	".rustup",
	".gradle",
	".m2",
	".local",
	"Library",
	"Applications",
	"AppData",
	"node_modules",
	"vendor",
	"target",
	"dist",
	"build",
	".next",
	".nuxt",
	".turbo",
	".venv",
	"venv",
	"__pycache__",
	"Pods",
	"DerivedData",
]);

const concurrency = 4;
const maxDirectories = 100_000;
const maxRepositories = 5_000;
const progressIntervalMs = 500;

/** Read-only, bounded filesystem discovery; follows explicit roots but never descendant symlinks. */
export class RepositoryDiscovery {
	private constructor() {}

	static async resolveFolder(path: string): Promise<string> {
		try {
			return await realpath(path);
		} catch {
			// Keep unavailable roots visible so they can be retried or untracked.
			return normalize(path);
		}
	}

	/** Reads optional session intent without invalidating older sessions. */
	static preferences(value: unknown): RepositoryDiscoveryPreferences {
		const paths = (items: unknown): string[] =>
			Array.isArray(items)
				? [
						...new Set(
							items
								.filter(
									(item): item is string =>
										typeof item === "string" &&
										isAbsolute(item) &&
										!item.includes("\0")
								)
								.map((item) => normalize(item))
						),
					].slice(0, maxRepositories)
				: [];

		if (!value || typeof value !== "object") return { folders: [], hidden: [] };

		return {
			folders: "folders" in value ? paths(value.folders) : [],
			hidden: "hidden" in value ? paths(value.hidden) : [],
		};
	}

	/** Validates Git markers only; emits stable append-order batches without status or network reads. */
	static async scan(
		folders: readonly string[],
		signal: AbortSignal,
		onProgress: (progress: RepositoryDiscoveryProgress) => void
	): Promise<RepositoryDiscoveryProgress> {
		const pending: string[] = [];
		const queued = new Set<string>();
		const found = new Set<string>();
		let scanned = 0;
		let skipped = 0;
		let limited = false;
		let lastProgress = 0;
		let reportedFound = -1;
		let reportedSkipped = -1;

		const snapshot = (): RepositoryDiscoveryProgress => ({
			paths: [...found],
			scanned,
			skipped,
			limited,
		});

		for (const folder of RepositoryDiscovery.preferences({ folders }).folders) {
			signal.throwIfAborted();

			try {
				const root = await realpath(folder);

				if (!queued.has(root)) {
					queued.add(root);
					pending.push(root);
				}
			} catch {
				skipped++;
			}
		}

		const visit = async (path: string): Promise<void> => {
			signal.throwIfAborted();
			let entries;

			try {
				entries = await readdir(path, { withFileTypes: true });
			} catch {
				skipped++;

				return;
			}

			scanned++;
			signal.throwIfAborted();

			if (
				entries.some(
					(entry) =>
						entry.name === ".git" && (entry.isDirectory() || entry.isFile())
				)
			) {
				const result = await GitRepository.open({
					path,
					signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
				});

				signal.throwIfAborted();

				if (result.ok && result.value.info.root === path) {
					if (found.size < maxRepositories) found.add(path);
					else limited = true;
				} else skipped++;
			}

			for (const entry of entries) {
				if (!entry.isDirectory() || excludedFolders.has(entry.name)) continue;

				const child = join(path, entry.name);

				if (queued.has(child)) continue;

				if (queued.size >= maxDirectories) {
					limited = true;

					continue;
				}

				queued.add(child);
				pending.push(child);
			}
		};

		while (pending.length && found.size < maxRepositories) {
			signal.throwIfAborted();
			await Promise.all(pending.splice(-concurrency).map(visit));

			if (
				Date.now() - lastProgress >= progressIntervalMs &&
				(found.size !== reportedFound || skipped !== reportedSkipped)
			) {
				lastProgress = Date.now();
				reportedFound = found.size;
				reportedSkipped = skipped;
				onProgress(snapshot());
			}
		}

		signal.throwIfAborted();
		limited ||= pending.length > 0;

		return snapshot();
	}
}
