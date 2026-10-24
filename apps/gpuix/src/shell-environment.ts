import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

const startMarker = "\0ONEGIT_PATH\0";
const endMarker = "\0ONEGIT_END\0";
const maxShellOutputBytes = 1024 * 1024;
const pathCommand = String.raw`/usr/bin/printf '\0ONEGIT_PATH\0'; /usr/bin/printenv PATH; /usr/bin/printf '\0ONEGIT_END\0'`;

/** Restores GUI-launched Git's executable search path once, without blocking rendering or reading repository startup files. */
export class ShellEnvironment {
	static readonly shared = new ShellEnvironment();
	private pending?: Promise<void>;

	constructor(
		private readonly environment: NodeJS.ProcessEnv = process.env,
		private readonly home: string = homedir(),
		private readonly timeoutMs = 5000
	) {}

	prepare(): Promise<void> {
		return (this.pending ??= this.load());
	}

	private async load(): Promise<void> {
		if (process.platform === "win32") return;

		const shell = this.environment.SHELL;

		const executable =
			shell && isAbsolute(shell) && !shell.includes("\0") ? shell : "/bin/zsh";

		const path = await new Promise<string | undefined>((resolve) => {
			const child = spawn(executable, ["-ilc", pathCommand], {
				cwd: this.home,
				env: this.environment,
				detached: true,
				stdio: ["ignore", "pipe", "ignore"],
			});

			const chunks: Buffer[] = [];
			let outputBytes = 0;

			let settled = false;

			const finish = (value?: string): void => {
				if (settled) return;

				settled = true;
				clearTimeout(timer);
				resolve(value);
			};

			const stop = (): void => {
				try {
					if (child.pid) process.kill(-child.pid, "SIGKILL");
				} catch {
					child.kill("SIGKILL");
				}

				finish();
			};

			const timer = setTimeout(stop, this.timeoutMs);

			child.stdout.on("data", (chunk: Buffer) => {
				if (settled) return;

				outputBytes += chunk.byteLength;

				if (outputBytes > maxShellOutputBytes) stop();
				else chunks.push(chunk);
			});
			child.once("error", () => finish());
			child.once("close", (code) => {
				const output = Buffer.concat(chunks).toString("utf8");
				const start = output.indexOf(startMarker);
				const end = output.indexOf(endMarker, start + startMarker.length);

				finish(
					code === 0 && start !== -1 && end !== -1
						? output
								.slice(start + startMarker.length, end)
								.replace(/\r?\n$/, "")
						: undefined
				);
			});
		});

		this.environment.PATH = [
			...new Set([
				...(path?.split(":") ?? []),
				...(this.environment.PATH?.split(":") ?? []),
				join(this.home, ".bun/bin"),
				"/opt/homebrew/bin",
				"/usr/local/bin",
				"/usr/bin",
				"/bin",
				"/usr/sbin",
				"/sbin",
			]),
		]
			.filter((entry) => isAbsolute(entry))
			.join(":");
	}
}
