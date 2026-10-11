import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { GitTransferProgress } from "../contracts.js";
import { GitProgress } from "./git-progress.js";

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

const AUTHENTICATED_ACCESS_FAILURE_PATTERN =
	/(requested URL returned error: (401|403)\b|authentication failed|repository not found|could not read username)/i;

const authenticatedFailureDetail = (stderr: Buffer): string =>
	AUTHENTICATED_ACCESS_FAILURE_PATTERN.test(stderr.toString("utf8"))
		? "Authentication failed: the HTTPS remote denied access for the selected account. Check account credentials and repository permissions."
		: "Authenticated HTTPS request failed. Check repository permissions, network and certificate settings.";

export interface GitCommandInput {
	readonly onProgress?: (progress: GitTransferProgress) => void;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly signal?: AbortSignal;
	readonly stdin?: string | Uint8Array;
	/** Internal per-command index override; never changes the host process environment. */
	readonly indexFile?: string;
	/** Cloning untrusted URLs ignores inherited Git configuration; existing repositories retain TLS/LFS settings. */
	readonly isolateCloneConfiguration?: boolean;
	/** Internal one-shot auth; scoped to this exact HTTPS remote. */
	readonly httpAuthentication?: {
		readonly url: string;
		readonly username: string;
		readonly password: string;
	};
}

const authenticatedEnvironment = (
	input: NonNullable<GitCommandInput["httpAuthentication"]>,
	isolateCloneConfiguration: boolean
): NodeJS.ProcessEnv => {
	// Never inherit tracing or process-level credentials. Remote URLs are freshly validated after Git rewrites.
	const env = Object.fromEntries(
		Object.entries(process.env).filter(
			([key]) => !key.startsWith("GIT_") && !key.startsWith("GCM_")
		)
	);

	const nullFile = process.platform === "win32" ? "NUL" : "/dev/null";

	const settings = [
		["credential.helper", ""],
		["core.askPass", ""],
		...(isolateCloneConfiguration
			? [
					["core.hooksPath", nullFile],
					["init.templateDir", ""],
				]
			: []),
		["http.followRedirects", "false"],
		["http.sslVerify", "true"],
		["protocol.allow", "never"],
		["protocol.https.allow", "always"],
		["http.extraHeader", ""],
		[
			`http.${input.url}.extraHeader`,
			`Authorization: Basic ${Buffer.from(`${input.username}:${input.password}`).toString("base64")}`,
		],
	];

	if (isolateCloneConfiguration) {
		env.GIT_CONFIG_GLOBAL = nullFile;
		env.GIT_CONFIG_NOSYSTEM = "1";
	}

	env.GIT_CONFIG_COUNT = String(settings.length);

	for (const [index, [key, value]] of settings.entries()) {
		env[`GIT_CONFIG_KEY_${index}`] = key;
		env[`GIT_CONFIG_VALUE_${index}`] = value;
	}

	return env;
};

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

			const progress = input.onProgress
				? new GitProgress(input.onProgress)
				: undefined;

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
			child.stderr.on("data", (chunk: Buffer) => {
				collectChunk(stderrChunks, chunk);

				if (!stopped) progress?.write(chunk);
			});
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
				progress?.finish();
				const stdout = Buffer.concat(stdoutChunks);
				const stderr = Buffer.concat(stderrChunks);

				if (exitCode !== 0) {
					reject(
						new GitCommandFailure(
							exitCode ?? 1,
							input.httpAuthentication
								? authenticatedFailureDetail(stderr)
								: stderr.toString("utf8").trim(),
							input.httpAuthentication ? "" : stdout.toString("utf8")
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
					...(input.httpAuthentication
						? authenticatedEnvironment(
								input.httpAuthentication,
								input.isolateCloneConfiguration ?? false
							)
						: process.env),
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
