import {
	execFile,
	type ExecFileOptionsWithStringEncoding,
} from "node:child_process";
import { homedir } from "node:os";
import { delimiter, isAbsolute } from "node:path";
import { promisify } from "node:util";
import { hasControlCharacters } from "./account-store";

const execute = promisify(execFile);
const hostPattern = /^[a-z0-9][a-z0-9.-]*(?::[0-9]{1,5})?$/iu;
const loginPattern = /^[a-z0-9][a-z0-9_-]{0,99}$/iu;
const legacyLoginPattern = /^\s+\S+ Logged in to (\S+) account (\S+) \(.+\)$/u;
const legacyActivePattern = /^\s+- Active account: (true|false)$/u;

const legacyFailurePattern =
	/^\s+\S+ (?:Failed to log in to|Timeout trying to log in to) /u;

/** Public CLI identity only; credentials never enter picker state or metadata. */
export interface GitHubCliAccount {
	readonly host: string;
	readonly username: string;
	readonly active: boolean;
}

/** Process boundary for offline tests. Output may contain secrets and must never be logged. */
export type GitHubCliRun = (
	args: readonly string[],
	signal?: AbortSignal
) => Promise<string>;

/** Read-only bridge to gh's account store; never switches accounts, logs out, or persists tokens. */
export class GitHubCli {
	constructor(private readonly run: GitHubCliRun = GitHubCli.execute) {}

	async accounts(signal?: AbortSignal): Promise<readonly GitHubCliAccount[]> {
		const output = await this.command(
			["auth", "status", "--json", "hosts"],
			signal
		);

		try {
			const data: unknown = JSON.parse(output);

			if (
				!data ||
				typeof data !== "object" ||
				!("hosts" in data) ||
				!data.hosts ||
				typeof data.hosts !== "object" ||
				Array.isArray(data.hosts)
			)
				throw new Error();

			const accounts: GitHubCliAccount[] = [];
			const seen = new Set<string>();

			for (const [host, entries] of Object.entries(data.hosts)) {
				if (!hostPattern.test(host) || !Array.isArray(entries))
					throw new Error();

				const values: readonly unknown[] = entries;

				for (const entry of values) {
					if (
						!entry ||
						typeof entry !== "object" ||
						!("login" in entry) ||
						typeof entry.login !== "string" ||
						!loginPattern.test(entry.login) ||
						!("state" in entry) ||
						!("active" in entry) ||
						typeof entry.active !== "boolean"
					)
						throw new Error();

					if (entry.state !== "success") continue;

					const key = `${host.toLowerCase()}/${entry.login.toLowerCase()}`;

					if (seen.has(key)) continue;

					seen.add(key);
					accounts.push({
						host: host.toLowerCase(),
						username: entry.login,
						active: entry.active,
					});
				}
			}

			return accounts;
		} catch {
			throw new Error(
				"Could not read GitHub CLI accounts. Update gh and run gh auth status, then try again."
			);
		}
	}

	async token(
		account: Pick<GitHubCliAccount, "host" | "username">,
		signal?: AbortSignal
	): Promise<string> {
		if (!hostPattern.test(account.host) || !loginPattern.test(account.username))
			throw new Error("Invalid GitHub CLI account.");

		const token = (
			await this.command(
				[
					"auth",
					"token",
					"--hostname",
					account.host,
					"--user",
					account.username,
				],
				signal
			)
		).trim();

		if (
			!token ||
			Buffer.byteLength(token) > 2048 ||
			/\s/u.test(token) ||
			hasControlCharacters(token)
		)
			throw new Error(
				"GitHub CLI returned no usable credential. Run gh auth login for this account, then try again."
			);

		return token;
	}

	private async command(
		args: readonly string[],
		signal?: AbortSignal
	): Promise<string> {
		signal?.throwIfAborted();

		try {
			const output = await this.run(args, signal);

			signal?.throwIfAborted();

			return output;
		} catch {
			signal?.throwIfAborted();

			throw new Error(
				"GitHub CLI is unavailable or could not read its credentials. Install or update gh, run gh auth login, then try again."
			);
		}
	}

	private static async execute(
		args: readonly string[],
		signal?: AbortSignal
	): Promise<string> {
		// Finder launches have a minimal PATH; include the standard macOS package-manager locations.
		const path = [
			...(process.env.PATH ?? "").split(delimiter).filter(isAbsolute),
			"/opt/homebrew/bin",
			"/usr/local/bin",
		].join(delimiter);

		const executable = Bun.which("gh", { PATH: path });

		if (!executable) throw new Error("GitHub CLI is not installed.");

		const env: NodeJS.ProcessEnv = {
			...process.env,
			PATH: path,
			GH_PROMPT_DISABLED: "1",
			GH_NO_UPDATE_NOTIFIER: "1",
			NO_COLOR: "1",
			CLICOLOR: "0",
		};

		// Environment tokens override gh's account selection, so use only gh-managed credentials.
		for (const key of [
			"GH_TOKEN",
			"GITHUB_TOKEN",
			"GH_ENTERPRISE_TOKEN",
			"GITHUB_ENTERPRISE_TOKEN",
			"GH_FORCE_TTY",
			"CLICOLOR_FORCE",
		])
			delete env[key];

		const options: ExecFileOptionsWithStringEncoding = {
			cwd: homedir(),
			env,
			signal,
			timeout: 15_000,
			maxBuffer: 1024 * 1024,
			encoding: "utf8",
			windowsHide: true,
		};

		try {
			const { stdout } = await execute(executable, [...args], options);

			return stdout;
		} catch (error) {
			if (
				args.join(" ") !== "auth status --json hosts" ||
				!error ||
				typeof error !== "object" ||
				!("stderr" in error) ||
				typeof error.stderr !== "string" ||
				!error.stderr.includes("unknown flag: --json")
			)
				throw error;

			// Older gh releases expose account discovery only as masked text on stderr.
			let output: string;

			try {
				const result = await execute(executable, ["auth", "status"], options);

				output = `${result.stdout}\n${result.stderr}`;
			} catch (failure) {
				if (
					!failure ||
					typeof failure !== "object" ||
					!("code" in failure) ||
					failure.code !== 1 ||
					!("stderr" in failure) ||
					typeof failure.stderr !== "string"
				)
					throw failure;

				// Exit 1 can mean one expired account among otherwise valid accounts.
				output = failure.stderr;
			}

			return GitHubCli.legacyStatus(output);
		}
	}

	private static legacyStatus(output: string): string {
		const hosts = new Map<
			string,
			{ login: string; active: boolean; state: "success" }[]
		>();

		let pending: { host: string; login: string } | undefined;

		let recognized = output.includes(
			"You are not logged into any GitHub hosts."
		);

		for (const line of output.split(/\r?\n/u)) {
			const login = legacyLoginPattern.exec(line);

			if (login) {
				const [, host, username] = login;

				if (
					!host ||
					!username ||
					!hostPattern.test(host) ||
					!loginPattern.test(username)
				)
					throw new Error("Unrecognized GitHub CLI account status.");

				pending = { host, login: username };
				recognized = true;

				continue;
			}

			if (legacyFailurePattern.test(line)) {
				pending = undefined;
				recognized = true;

				continue;
			}

			const active = legacyActivePattern.exec(line);

			if (pending && active) {
				const entries = hosts.get(pending.host) ?? [];

				entries.push({
					login: pending.login,
					active: active[1] === "true",
					state: "success",
				});
				hosts.set(pending.host, entries);
				pending = undefined;
			}
		}

		if (!recognized || pending)
			throw new Error("Unrecognized GitHub CLI account status.");

		return JSON.stringify({ hosts: Object.fromEntries(hosts) });
	}
}
