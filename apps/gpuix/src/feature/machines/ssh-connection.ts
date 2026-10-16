import {
	spawn,
	execFile,
	type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { promisify } from "node:util";
import type { SavedMachine } from "./machine-store";
import {
	isRecord,
	RemoteFrames,
	remoteFrameBytes,
	remoteProtocolVersion,
	remoteHelperTargets,
} from "./remote-protocol";

const execute = promisify(execFile);

const targets = new Set<string>(remoteHelperTargets);

const shellQuote = (value: string): string =>
	"'" + value.replaceAll("'", "'\\''") + "'";

const digest = (bytes: Uint8Array): string =>
	createHash("sha256").update(bytes).digest("hex");

/** User-visible machine lifecycle; repository failures never erase a saved connection. */
export type MachineStatus =
	| "Disconnected"
	| "Connecting"
	| "Preparing helper"
	| "Connected";

/** One machine's SSH channel, automatic user-level deployment and bounded multiplexed RPC. */
export class SshConnection {
	private child?: ChildProcessWithoutNullStreams;
	private preparing?: Promise<void>;
	private directory?: string;
	private askpass?: ReturnType<typeof Bun.serve>;
	private readonly controller = new AbortController();
	private nextId = 1;
	private readonly pending = new Map<
		number,
		{
			resolve: (value: unknown) => void;
			reject: (error: Error) => void;
			progress?: (value: unknown) => void;
			cleanup: () => void;
		}
	>();
	private readonly ready = Promise.withResolvers<void>();
	home?: string;

	get busy(): boolean {
		return this.pending.size > 0;
	}

	constructor(
		readonly machine: SavedMachine,
		private readonly secret: () => Promise<string | null>,
		private readonly status: (value: MachineStatus, error?: string) => void,
		private readonly configurationFile?: string
	) {}

	async connect(): Promise<void> {
		if (this.preparing) return await this.preparing;

		this.preparing = this.prepare();

		return await this.preparing;
	}

	private args(): string[] {
		return [
			...(this.configurationFile ? ["-F", this.configurationFile] : []),
			"-T",
			"-a",
			"-o",
			"ForwardAgent=no",
			"-o",
			"ClearAllForwardings=yes",
			"-o",
			"RemoteCommand=none",
			"-o",
			"ConnectTimeout=15",
			"-o",
			"ServerAliveInterval=15",
			"-o",
			"ServerAliveCountMax=2",
			"-o",
			"NumberOfPasswordPrompts=1",
			"-o",
			"StrictHostKeyChecking=ask",
			"-o",
			"ControlMaster=auto",
			"-o",
			"ControlPersist=60",
			"-o",
			`ControlPath=${this.directory}/control`,
			...(this.machine.username ? ["-l", this.machine.username] : []),
			...(this.machine.port ? ["-p", String(this.machine.port)] : []),
			...(this.machine.identityFile ? ["-i", this.machine.identityFile] : []),
			"--",
			this.machine.host,
		];
	}

	private environment(): NodeJS.ProcessEnv {
		return {
			...process.env,
			SSH_ASKPASS: join(this.directory ?? "", "askpass"),
			SSH_ASKPASS_REQUIRE: "force",
			DISPLAY: process.env.DISPLAY ?? "1git",
			ONEGIT_SSH_ASKPASS_SOCKET: join(this.directory ?? "", "askpass.sock"),
		};
	}

	private async prompt(text: string): Promise<string> {
		const confirmation = /yes\/no/.test(text);

		const saved =
			!confirmation && /password|passphrase/i.test(text)
				? await this.secret()
				: null;

		if (saved) return saved;

		const script = confirmation
			? 'on run argv\ndisplay dialog (item 1 of argv) buttons {"Cancel", "Trust host"} default button "Cancel" with title "1git SSH"\nreturn "yes"\nend run'
			: 'on run argv\nset answer to display dialog (item 1 of argv) default answer "" with hidden answer buttons {"Cancel", "Connect"} default button "Connect" with title "1git SSH"\nreturn text returned of answer\nend run';

		const result = await execute("/usr/bin/osascript", ["-e", script, text], {
			signal: this.controller.signal,
			maxBuffer: 16384,
		});

		return result.stdout.replace(/\r?\n$/, "");
	}

	private async prepare(): Promise<void> {
		this.status("Connecting");

		try {
			this.directory = await mkdtemp(join(tmpdir(), "1git-ssh-"));
			await chmod(this.directory, 0o700);
			await writeFile(
				join(this.directory, "askpass"),
				'#!/bin/sh\nexec /usr/bin/curl --silent --fail --max-time 300 --unix-socket "$ONEGIT_SSH_ASKPASS_SOCKET" --get --data-urlencode "prompt=$1" http://localhost/askpass\n',
				{ mode: 0o700 }
			);
			this.askpass = Bun.serve({
				unix: join(this.directory, "askpass.sock"),
				fetch: async (request) => {
					const url = new URL(request.url);
					const prompt = url.searchParams.get("prompt");

					if (
						request.method !== "GET" ||
						url.pathname !== "/askpass" ||
						!prompt ||
						prompt.length > 8192
					)
						return new Response(null, { status: 400 });

					try {
						return new Response(await this.prompt(prompt));
					} catch {
						return new Response(null, { status: 403 });
					}
				},
			});
			const probe = await this.run(
				"sh -s",
				Buffer.from(
					'set -eu\ncommand -v git >/dev/null || { echo "Git is not installed on this machine." >&2; exit 41; }\ncommand -v gzip >/dev/null || { echo "gzip is required to prepare this machine." >&2; exit 41; }\nos=$(uname -s)\narch=$(uname -m)\ncase "$os" in Linux) os=linux;; Darwin) os=darwin;; *) echo "Unsupported remote operating system." >&2; exit 42;; esac\ncase "$arch" in x86_64|amd64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo "Unsupported remote architecture." >&2; exit 42;; esac\nlibc=""\nif [ "$os" = linux ] && ! getconf GNU_LIBC_VERSION >/dev/null 2>&1; then libc=-musl; fi\nprintf "1git-target:%s-%s%s\\n" "$os" "$arch" "$libc"\n'
				)
			);

			const target = probe.trim().match(/^1git-target:(\S+)$/)?.[1];

			if (!target || !targets.has(target))
				throw new Error(
					"Could not identify a supported remote machine. Check SSH startup output."
				);

			this.status("Preparing helper");
			const artifact = await this.artifact(target);
			// shortcut: retain older helpers for other running app versions; add lease-based cleanup if disk usage becomes significant.
			const base = `"$HOME/.local/share/1git/helpers/${artifact.sha256}"`;

			const installed = await this.run(
				`sh -c ${shellQuote(`base=${base}; if [ -x "$base/1git-helper" ]; then if command -v sha256sum >/dev/null 2>&1; then hash=$(sha256sum "$base/1git-helper"); else hash=$(shasum -a 256 "$base/1git-helper"); fi; if [ "\${hash%% *}" = "${artifact.sha256}" ]; then printf installed; fi; fi`)}`
			);

			if (installed !== "installed") {
				// Only fixed commands and validated hex identifiers enter the remote shell; all payload bytes use stdin.
				await this.run(
					`sh -c ${shellQuote(`set -eu; umask 077; base=${base}; mkdir -p "$base"; temporary="$base/.upload-${crypto.randomUUID()}"; trap 'rm -f "$temporary"' 0 1 2 15; gzip -dc > "$temporary"; if command -v sha256sum >/dev/null 2>&1; then hash=$(sha256sum "$temporary"); else hash=$(shasum -a 256 "$temporary"); fi; [ "\${hash%% *}" = "${artifact.sha256}" ] || { echo "Helper checksum verification failed." >&2; exit 43; }; chmod 700 "$temporary"; mv "$temporary" "$base/1git-helper"`)}`,
					artifact.bytes
				);
			}

			const child = spawn(
				"/usr/bin/ssh",
				[...this.args(), `exec ${base}/1git-helper`],
				{ env: this.environment(), cwd: homedir(), stdio: "pipe" }
			);

			this.child = child;
			const frames = new RemoteFrames();

			child.stdout.on("data", (chunk: Buffer) => {
				try {
					for (const frame of frames.push(chunk)) this.receive(frame);
				} catch (cause) {
					this.fail(
						cause instanceof Error
							? cause
							: new Error("Invalid remote response.")
					);
				}
			});
			child.stderr.resume();
			child.stdin.on("error", () =>
				this.fail(
					new Error(
						"The SSH helper stopped accepting requests. Refresh before retrying a write."
					)
				)
			);
			child.on("error", () => this.fail(new Error("Could not start SSH.")));
			child.on("close", () =>
				this.fail(
					new Error(
						"SSH connection closed. Reconnect and refresh before retrying a write; it may have completed."
					)
				)
			);
			const timer = setTimeout(
				() => this.fail(new Error("The SSH helper did not respond.")),
				30_000
			);

			try {
				await this.ready.promise;
			} finally {
				clearTimeout(timer);
			}

			this.status("Connected");
		} catch (cause) {
			this.status(
				"Disconnected",
				cause instanceof Error ? cause.message : "Could not connect."
			);
			await this.dispose();

			throw cause;
		}
	}

	private async artifact(
		target: string
	): Promise<{ bytes: Buffer; sha256: string }> {
		const directory =
			process.env.GPUIX_REMOTE_HELPERS_DIR ??
			resolve(import.meta.dir, "../../../build/remote-helpers");

		const manifest = join(directory, `${target}.json`);

		if (!process.env.GPUIX_REMOTE_HELPERS_DIR) {
			await execute(
				process.execPath,
				[
					"run",
					resolve(import.meta.dir, "../../../native/build-remote-helpers.ts"),
					target,
				],
				{ signal: this.controller.signal, maxBuffer: 1024 * 1024 }
			);
		}

		const metadata: unknown = JSON.parse(await readFile(manifest, "utf8"));
		const bytes = await readFile(join(directory, `${target}.gz`));

		if (
			!isRecord(metadata) ||
			typeof metadata.sha256 !== "string" ||
			!/^[a-f0-9]{64}$/.test(metadata.sha256) ||
			metadata.compressedSha256 !== digest(bytes)
		)
			throw new Error(
				"The bundled SSH helper is missing or damaged. Rebuild or reinstall 1git."
			);

		return { bytes, sha256: metadata.sha256 };
	}

	private async run(command: string, input?: Buffer): Promise<string> {
		const child = spawn("/usr/bin/ssh", [...this.args(), command], {
			env: this.environment(),
			cwd: homedir(),
			stdio: "pipe",
			signal: this.controller.signal,
		});

		return await new Promise<string>((resolveResult, reject) => {
			let stdout = "";
			let stderr = "";

			child.stdout.on("data", (chunk: Buffer) => {
				stdout += chunk.toString("utf8");

				if (stdout.length > 64 * 1024) child.kill();
			});
			child.stderr.on("data", (chunk: Buffer) => {
				stderr = (stderr + chunk.toString("utf8")).slice(-8192);
			});
			child.on("error", reject);
			child.on("close", (code) =>
				code === 0
					? resolveResult(stdout)
					: reject(
							new Error(
								stderr.trim() ||
									"SSH failed. Check the host, credentials and network connection."
							)
						)
			);
			child.stdin.on("error", () => undefined);
			child.stdin.end(input);
		});
	}

	private receive(frame: unknown): void {
		if (!isRecord(frame)) throw new Error("Invalid helper response.");

		if (frame.kind === "hello") {
			if (
				frame.protocol !== remoteProtocolVersion ||
				typeof frame.home !== "string" ||
				!frame.home.startsWith("/") ||
				/[\0\r\n]/.test(frame.home)
			)
				throw new Error("The remote helper is incompatible with this app.");

			this.home = frame.home;
			this.ready.resolve();

			return;
		}

		if (typeof frame.id !== "number")
			throw new Error("Invalid helper response identifier.");

		const pending = this.pending.get(frame.id);

		if (!pending) return;

		if (frame.kind === "progress") {
			try {
				pending.progress?.(frame.value);
			} catch {
				// Observers are advisory; only cancellation may interrupt remote work.
			}

			return;
		}

		this.pending.delete(frame.id);
		pending.cleanup();

		if (frame.kind === "result") pending.resolve(frame.value);
		else
			pending.reject(
				new Error(
					typeof frame.message === "string"
						? frame.message
						: "Remote operation failed."
				)
			);
	}

	async request(
		input: Record<string, unknown>,
		signal?: AbortSignal,
		progress?: (value: unknown) => void
	): Promise<unknown> {
		signal?.throwIfAborted();
		await this.connect();
		signal?.throwIfAborted();

		if (!this.child || this.child.killed || this.child.exitCode !== null)
			throw new Error(
				"The machine is disconnected. Reconnect before trying again."
			);

		if (this.pending.size >= 128)
			throw new Error(
				"Too many remote requests. Wait for current operations to finish."
			);

		const id = this.nextId++;
		const frame = `${JSON.stringify({ ...input, id, kind: "request" })}\n`;

		if (Buffer.byteLength(frame) > remoteFrameBytes)
			throw new Error("Remote request exceeded the size limit.");

		return await new Promise<unknown>((resolveResult, reject) => {
			let cancelling = false;

			let timeout = setTimeout(
				() => cancel(),
				input.operation === "scan" || input.operation === "clone"
					? 600_000
					: 120_000
			);

			const cleanup = (): void => {
				clearTimeout(timeout);
				signal?.removeEventListener("abort", cancel);
			};

			const cancel = (): void => {
				if (cancelling) return;

				if (input.operation === "clone" || input.operation === "initialize") {
					// Keep the form blocked until Git acknowledges cancellation, or the channel stops responding.
					cancelling = true;
					cleanup();
					this.child?.stdin.write(
						`${JSON.stringify({ kind: "cancel", id })}\n`
					);
					timeout = setTimeout(() => {
						this.pending.delete(id);
						reject(
							new Error(
								"The remote setup did not confirm cancellation. Reconnect and check the destination before retrying."
							)
						);
					}, 10_000);

					return;
				}

				this.pending.delete(id);
				cleanup();
				this.child?.stdin.write(`${JSON.stringify({ kind: "cancel", id })}\n`);
				reject(
					new Error(
						"Remote request cancelled or timed out. Refresh before retrying a write; it may have completed."
					)
				);
			};

			this.pending.set(id, {
				resolve: resolveResult,
				reject,
				cleanup,
				progress,
			});
			signal?.addEventListener("abort", cancel, { once: true });
			this.child?.stdin.write(frame, (error) => {
				if (error) this.fail(new Error("Could not send the remote request."));
			});
		});
	}

	private fail(error: Error): void {
		this.child?.kill();
		this.status("Disconnected", error.message);
		this.ready.reject(error);

		for (const pending of this.pending.values()) {
			pending.cleanup();
			pending.reject(error);
		}

		this.pending.clear();
	}

	async dispose(): Promise<void> {
		this.controller.abort();
		this.child?.stdin.end();
		this.child?.kill();
		await this.askpass?.stop(true);

		if (this.directory) {
			try {
				await execute(
					"/usr/bin/ssh",
					[...this.args().slice(0, -2), "-O", "exit", "--", this.machine.host],
					{ timeout: 5000 }
				);
			} catch {
				// The control master may already have exited with its connection.
			}

			await rm(this.directory, { recursive: true, force: true });
		}
	}
}
