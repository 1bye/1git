import { constants } from "node:fs";
import type { GitExecutionRuntime } from "@1git/git/runtime";
import {
	GitCommandFailure,
	GitProcessFailure,
	type GitCommandInput,
	type GitCommandOutput,
} from "@1git/git/process";
import { GitProgress } from "@1git/git/progress";
import { isRecord } from "./remote-protocol";

/** Authenticated agent channel; cancellation completes only after the remote child exits. */
export type AgentRequest = (
	input: Record<string, unknown>,
	signal?: AbortSignal,
	progress?: (value: unknown) => void
) => Promise<unknown>;

const data = (value: unknown): string => {
	if (typeof value === "string" || value instanceof Uint8Array)
		return Buffer.from(value).toString("base64");

	throw new Error("Expected text or file bytes.");
};

const buffer = (value: unknown): Buffer => {
	if (typeof value !== "string")
		throw new Error("Invalid agent byte response.");

	return Buffer.from(value, "base64");
};

const encoding = (value: unknown): BufferEncoding | undefined => {
	const name = isRecord(value) ? value.encoding : value;

	if (name === undefined || name === null) return undefined;

	if (typeof name === "string" && Buffer.isEncoding(name)) return name;

	throw new Error("Unsupported file encoding.");
};

const stats = (value: unknown) => {
	if (
		!isRecord(value) ||
		typeof value.size !== "number" ||
		typeof value.mode !== "number" ||
		typeof value.file !== "boolean" ||
		typeof value.directory !== "boolean" ||
		typeof value.symlink !== "boolean"
	)
		throw new Error("Invalid agent file metadata.");

	return {
		...value,
		isFile: () => value.file,
		isDirectory: () => value.directory,
		isSymbolicLink: () => value.symlink,
	};
};

/** Adapts the small Rust execution protocol to the shared Git implementation inside the app. */
export class RustRuntime implements GitExecutionRuntime {
	constructor(
		readonly home: string,
		readonly temporary: string,
		private readonly request: AgentRequest,
		private readonly signal?: AbortSignal
	) {}

	async git(
		input: GitCommandInput,
		maxOutputBytes: number
	): Promise<GitCommandOutput> {
		if (input.httpAuthentication)
			throw new Error(
				"Local account credentials cannot be forwarded to a remote machine."
			);

		const progress = input.onProgress
			? new GitProgress(input.onProgress)
			: undefined;

		let result: unknown;

		try {
			result = await this.request(
				{
					operation: "git",
					args: input.args,
					cwd: input.cwd,
					stdin: input.stdin === undefined ? undefined : data(input.stdin),
					stdoutFile: input.stdoutFile,
					indexFile: input.indexFile,
					maxOutputBytes,
					progress: !!progress || !!input.onOutput,
				},
				input.signal ?? this.signal,
				(value) => {
					const chunk = buffer(value);

					progress?.write(chunk);
					input.onOutput?.(chunk, "stderr");
				}
			);
		} catch (error) {
			if (error instanceof Error && "code" in error) {
				const reason = error.code;

				if (
					reason === "aborted" ||
					reason === "output-too-large" ||
					reason === "git-not-found"
				)
					throw new GitProcessFailure(reason, error.message);
			}

			throw error;
		} finally {
			progress?.finish();
		}

		if (!isRecord(result) || typeof result.exitCode !== "number")
			throw new Error("Invalid agent Git response.");

		const stdout = buffer(result.stdout);
		const stderr = buffer(result.stderr);

		if (stdout.length) input.onOutput?.(stdout, "stdout");

		if (result.exitCode !== 0)
			throw new GitCommandFailure(
				result.exitCode,
				stderr.toString("utf8").trim(),
				stdout.toString("utf8")
			);

		return { stdout, stderr };
	}

	async files(method: string, args: unknown[]): Promise<unknown> {
		const [path, second, third] = args;

		if (typeof path !== "string")
			throw new Error("Expected an absolute remote path.");

		const options = isRecord(second) ? second : {};
		const input: Record<string, unknown> = { operation: "fs", method, path };

		switch (method) {
			case "mkdir":
			case "rm":
				Object.assign(input, options);
				break;
			case "writeFile": {
				const options = isRecord(third) ? third : {};

				Object.assign(input, {
					data: data(second),
					mode: options.mode,
					exclusive: options.flag === "wx",
				});
				break;
			}
			case "copyFile":
			case "rename":
				input.destination = second;
				break;
			case "opendir":
				input.method = "readdir";
				input.limit = 10_001;
				break;
			case "open":
				Object.assign(input, this.openFlags(second), { mode: third });
				break;
			case "readFile":
			case "readdir":
			case "realpath":
			case "stat":
			case "lstat":
			case "mkdtemp":
				break;
			default:
				throw new Error(`Unsupported remote filesystem operation: ${method}`);
		}

		const result = await this.request(input);

		if (method === "stat" || method === "lstat") return stats(result);

		if (method === "open") {
			if (
				typeof result !== "number" ||
				!Number.isSafeInteger(result) ||
				result < 1
			)
				throw new Error("Invalid remote file handle.");

			return this.handle(result);
		}

		if (method === "readFile") {
			const bytes = buffer(result);
			const format = encoding(second);

			return format ? bytes.toString(format) : bytes;
		}

		if (method === "readdir" || method === "opendir") {
			if (!Array.isArray(result))
				throw new Error("Invalid agent directory listing.");

			const entries = result.map((entry) => {
				if (!isRecord(entry) || typeof entry.name !== "string")
					throw new Error("Invalid agent directory entry.");

				return { ...stats({ ...entry, size: 0, mode: 0 }), name: entry.name };
			});

			if (method === "opendir")
				return {
					async *[Symbol.asyncIterator]() {
						yield* entries;
					},
				};

			return options.withFileTypes
				? entries
				: entries.map((entry) => entry.name);
		}

		return result ?? undefined;
	}

	private handle(id: number) {
		// Handles retain their originating runtime even when a caller leaves the async scope.
		const call = async (method: string, extra: Record<string, unknown> = {}) =>
			await this.request({
				operation: "fs",
				method: `handle-${method}`,
				handle: id,
				...extra,
			});

		return {
			fd: id,
			close: async () => await call("close"),
			sync: async () => await call("sync"),
			stat: async () => stats(await call("stat")),
			readFile: async (options?: unknown) => {
				const bytes = buffer(await call("readFile"));
				const format = encoding(options);

				return format ? bytes.toString(format) : bytes;
			},
			writeFile: async (value: unknown) =>
				await call("writeFile", { data: data(value) }),
		};
	}

	private openFlags(flags: unknown): Record<string, boolean> {
		if (typeof flags === "number")
			return {
				read: (flags & constants.O_WRONLY) === 0,
				write: !!(flags & (constants.O_WRONLY | constants.O_RDWR)),
				append: !!(flags & constants.O_APPEND),
				create: !!(flags & constants.O_CREAT),
				createNew: !!(flags & constants.O_EXCL),
				truncate: !!(flags & constants.O_TRUNC),
				noFollow: !!(flags & constants.O_NOFOLLOW),
				nonBlock: !!(flags & constants.O_NONBLOCK),
			};

		if (
			typeof flags !== "string" ||
			!["r", "r+", "w", "wx", "w+", "a", "a+"].includes(flags)
		)
			throw new Error("Unsupported remote file flags.");

		return {
			read: flags.startsWith("r") || flags.includes("+"),
			write: !flags.startsWith("r") || flags.includes("+"),
			append: flags.startsWith("a"),
			create: !flags.startsWith("r"),
			createNew: flags.includes("x"),
			truncate: flags.startsWith("w"),
		};
	}
}
