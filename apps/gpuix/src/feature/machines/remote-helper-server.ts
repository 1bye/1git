import { GitRepository } from "@1git/git";
import { lstat, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { RepositoryDiscovery } from "../repository-discovery/repository-discovery";
import {
	isRecord,
	remoteGitMethods,
	remoteProtocolVersion,
} from "./remote-protocol";

/** Headless, user-scoped RPC owner. Repository instances retain undo state; linked worktree operations share a queue. */
export class RemoteHelperServer {
	private readonly repositories = new Map<string, Promise<GitRepository>>();
	private readonly queues = new Map<string, Promise<unknown>>();
	private readonly active = new Map<number, AbortController>();
	private readonly tasks = new Set<Promise<void>>();

	constructor(private readonly send: (frame: unknown) => void) {}

	hello(): void {
		this.send({
			kind: "hello",
			protocol: remoteProtocolVersion,
			home: homedir(),
		});
	}

	receive(frame: unknown): void {
		if (
			!isRecord(frame) ||
			!Number.isSafeInteger(frame.id) ||
			typeof frame.id !== "number" ||
			frame.id <= 0
		)
			throw new Error("Invalid remote request.");

		if (frame.kind === "cancel") {
			this.active.get(frame.id)?.abort();

			return;
		}

		if (
			frame.kind !== "request" ||
			this.active.has(frame.id) ||
			this.active.size >= 128
		)
			throw new Error("Invalid or excessive remote requests.");

		const controller = new AbortController();

		this.active.set(frame.id, controller);
		const task = this.respond(frame, frame.id, controller);

		this.tasks.add(task);
		void this.finish(task);
	}

	private async finish(task: Promise<void>): Promise<void> {
		try {
			await task;
		} catch {
			for (const controller of this.active.values()) controller.abort();

			process.exitCode = 1;
		} finally {
			this.tasks.delete(task);
		}
	}

	private async respond(
		frame: Record<string, unknown>,
		id: number,
		controller: AbortController
	): Promise<void> {
		try {
			const result = await this.execute(frame, id, controller.signal);

			this.send({ kind: "result", id, value: result });
		} catch (cause) {
			this.send({
				kind: "error",
				id,
				message:
					cause instanceof Error ? cause.message : "Remote operation failed.",
			});
		} finally {
			this.active.delete(id);
		}
	}

	private async open(path: unknown, limit: unknown): Promise<GitRepository> {
		if (typeof path !== "string" || !isAbsolute(path) || /[\0\r\n]/.test(path))
			throw new Error("Choose an absolute remote repository path.");

		if (
			limit !== undefined &&
			(typeof limit !== "number" ||
				!Number.isInteger(limit) ||
				limit < 1024 ||
				limit > 64 * 1024 * 1024)
		)
			throw new Error("Invalid Git output limit.");

		const key = JSON.stringify([path, limit]);
		const cached = this.repositories.get(key);

		if (cached) return await cached;

		if (this.repositories.size >= 256)
			throw new Error(
				"Too many remote repository sessions. Reconnect the machine."
			);

		const pending = (async (): Promise<GitRepository> => {
			const opened = await GitRepository.open({
				path,
				runtime: {
					maxOutputBytes: typeof limit === "number" ? limit : undefined,
				},
			});

			if (!opened.ok)
				throw new Error(opened.error.details ?? opened.error.message);

			return opened.value;
		})();

		this.repositories.set(key, pending);

		try {
			return await pending;
		} catch (cause) {
			this.repositories.delete(key);

			throw cause;
		}
	}

	private async execute(
		frame: Record<string, unknown>,
		id: number,
		signal: AbortSignal
	): Promise<unknown> {
		const progress = (value: unknown): void =>
			this.send({ kind: "progress", id, value });

		if (frame.operation === "scan") {
			if (
				!Array.isArray(frame.folders) ||
				frame.folders.length > 100 ||
				!frame.folders.every(
					(path) =>
						typeof path === "string" &&
						isAbsolute(path) &&
						!/[\0\r\n]/.test(path)
				)
			)
				throw new Error("Invalid remote scan folders.");

			return await RepositoryDiscovery.scan(
				frame.folders.length ? frame.folders : [homedir()],
				signal,
				progress
			);
		}

		const repository = await this.open(frame.path, frame.maxOutputBytes);

		if (frame.operation === "open") return repository.info;

		if (frame.operation === "symlink") {
			if (typeof frame.file !== "string") throw new Error("Choose a file.");

			const path = join(repository.info.root, frame.file);
			const suffix = relative(repository.info.root, path);

			if (
				!suffix ||
				suffix === ".." ||
				suffix.startsWith("../") ||
				isAbsolute(suffix)
			)
				throw new Error("File must stay inside the repository.");

			return (await lstat(path)).isSymbolicLink();
		}

		const common = repository.info.commonDirectory;
		const previous = this.queues.get(common);

		const run = async (): Promise<unknown> => {
			await previous?.catch(() => undefined);
			signal.throwIfAborted();

			if (frame.operation === "discard") {
				if (!isRecord(frame.input)) throw new Error("Invalid discard request.");

				const parent = join(homedir(), ".local/share/1git/discard-recovery");

				await mkdir(parent, { recursive: true, mode: 0o700 });
				const directory = join(parent, crypto.randomUUID());

				const result = await repository.discardFiles({
					paths: Array.isArray(frame.input.paths) ? frame.input.paths : [],
					allowDestructive: true,
					recovery: {
						directory,
						expectedHead:
							typeof frame.input.expectedHead === "string"
								? frame.input.expectedHead
								: null,
						expectedBranch:
							typeof frame.input.expectedBranch === "string"
								? frame.input.expectedBranch
								: null,
					},
					signal,
				});

				return result.ok
					? {
							ok: true,
							value: result.value.snapshot,
							recoveryDirectory: directory,
						}
					: { ...result, recoveryDirectory: directory };
			}

			const method = remoteGitMethods.find((name) => name === frame.method);

			if (
				frame.operation !== "call" ||
				!method ||
				!Array.isArray(frame.args) ||
				frame.args.length > 3
			)
				throw new Error("Unsupported remote Git operation.");

			const args: unknown[] = frame.args.map((value) =>
				value === null ? undefined : value
			);

			const optionsIndex =
				method === "compareBranches"
					? 2
					: [
								"getCommit",
								"getCommitFiles",
								"getHistoryCount",
								"getUnpushedCommits",
						  ].includes(method)
						? 1
						: 0;

			const last = args[optionsIndex];
			const options = { signal, onProgress: progress };

			args[optionsIndex] = { ...(isRecord(last) ? last : {}), ...options };

			return await Reflect.apply(repository[method], repository, args);
		};

		const task = run();

		this.queues.set(common, task);

		try {
			return await task;
		} finally {
			if (this.queues.get(common) === task) this.queues.delete(common);
		}
	}

	async close(): Promise<void> {
		for (const controller of this.active.values()) controller.abort();

		await Promise.allSettled(this.tasks);
	}
}
