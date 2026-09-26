import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export interface GitCommandInput {
	readonly args: readonly string[];
	readonly cwd: string;
	readonly signal?: AbortSignal;
	readonly stdin?: string | Uint8Array;
	/** Internal per-command index override; never changes the host process environment. */
	readonly indexFile?: string;
}

export interface GitCommandOutput {
	readonly stderr: Buffer;
	readonly stdout: Buffer;
}

export type GitProcessFailureReason =
	| "aborted"
	| "git-not-found"
	| "output-too-large"
	| "spawn-failed";

/** Failure to start or safely collect a Git process. */
export class GitProcessFailure extends Error {
	readonly reason: GitProcessFailureReason;

	constructor(
		reason: GitProcessFailureReason,
		message: string,
		options?: ErrorOptions
	) {
		super(message, options);
		this.name = "GitProcessFailure";
		this.reason = reason;
	}
}

/** Non-zero exit from an otherwise valid Git invocation. */
export class GitCommandFailure extends Error {
	readonly exitCode: number;
	readonly stderr: string;
	readonly stdout: string;

	constructor(exitCode: number, stderr: string, stdout = "") {
		super(`Git exited with code ${exitCode}.`);
		this.name = "GitCommandFailure";
		this.exitCode = exitCode;
		this.stderr = stderr;
		this.stdout = stdout;
	}
}

export interface GitProcessOptions {
	readonly executable?: string;
	readonly maxOutputBytes?: number;
}

/**
 * Executes Git without a shell, preserves configured credential helpers, and
 * collects bounded binary-safe output without allowing terminal prompts.
 */
export class GitProcess {
	private readonly executable: string;
	private readonly maxOutputBytes: number;

	constructor(options: GitProcessOptions = {}) {
		this.executable = options.executable ?? "git";
		this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
	}

	async run(input: GitCommandInput): Promise<GitCommandOutput> {
		if (input.signal?.aborted) {
			throw new GitProcessFailure("aborted", "Git operation was aborted.");
		}

		const child = this.spawn(input);

		return await this.collect(child, input);
	}

	private collect(
		child: ChildProcessWithoutNullStreams,
		input: GitCommandInput
	): Promise<GitCommandOutput> {
		return new Promise<GitCommandOutput>((resolve, reject) => {
			const stdoutChunks: Buffer[] = [];
			const stderrChunks: Buffer[] = [];
			let outputBytes = 0;
			let settled = false;
			let stopped: GitProcessFailure | null = null;

			const cleanup = (): void => {
				input.signal?.removeEventListener("abort", handleAbort);
			};

			const rejectOnce = (error: Error): void => {
				if (settled) {
					return;
				}

				settled = true;
				cleanup();
				reject(error);
			};

			const handleAbort = (): void => {
				stopped ??= new GitProcessFailure(
					"aborted",
					"Git operation was aborted."
				);
				child.kill("SIGTERM");
			};

			const collectChunk = (target: Buffer[], chunk: Buffer): void => {
				if (stopped) return;

				outputBytes += chunk.byteLength;

				if (outputBytes > this.maxOutputBytes) {
					child.kill("SIGTERM");
					stopped = new GitProcessFailure(
						"output-too-large",
						`Git output exceeded ${this.maxOutputBytes} bytes.`
					);

					return;
				}

				target.push(chunk);
			};

			input.signal?.addEventListener("abort", handleAbort, { once: true });
			child.stdout.on("data", (chunk: Buffer) =>
				collectChunk(stdoutChunks, chunk)
			);
			child.stderr.on("data", (chunk: Buffer) =>
				collectChunk(stderrChunks, chunk)
			);
			child.once("error", (error: NodeJS.ErrnoException) => {
				const reason: GitProcessFailureReason =
					error.code === "ENOENT" ? "git-not-found" : "spawn-failed";

				rejectOnce(
					new GitProcessFailure(
						reason,
						reason === "git-not-found"
							? `Git executable "${this.executable}" was not found.`
							: "Git process could not be started.",
						{ cause: error }
					)
				);
			});
			child.once("close", (exitCode) => {
				if (settled) {
					return;
				}

				// Writes must finish exiting before callers clean up locks or temporary indexes.
				if (stopped) {
					rejectOnce(stopped);

					return;
				}

				settled = true;
				cleanup();
				const stdout = Buffer.concat(stdoutChunks);
				const stderr = Buffer.concat(stderrChunks);

				if (exitCode !== 0) {
					reject(
						new GitCommandFailure(
							exitCode ?? 1,
							stderr.toString("utf8").trim(),
							stdout.toString("utf8").trim()
						)
					);

					return;
				}

				resolve({ stderr, stdout });
			});

			if (input.stdin === undefined) {
				child.stdin.end();
			} else {
				child.stdin.end(input.stdin);
			}
		});
	}

	private spawn(input: GitCommandInput): ChildProcessWithoutNullStreams {
		return spawn(
			this.executable,
			["-c", "color.ui=false", "-c", "core.quotepath=false", ...input.args],
			{
				cwd: input.cwd,
				env: {
					...process.env,
					...(input.indexFile ? { GIT_INDEX_FILE: input.indexFile } : {}),
					GIT_EDITOR: "true",
					GIT_PAGER: "cat",
					GIT_SEQUENCE_EDITOR: "true",
					GIT_TERMINAL_PROMPT: "0",
					LANG: "C",
					LC_ALL: "C",
					PAGER: "cat",
				},
				shell: false,
				windowsHide: true,
			}
		);
	}
}
