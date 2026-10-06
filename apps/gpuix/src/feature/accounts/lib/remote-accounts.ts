import { createHash, randomUUID } from "node:crypto";
import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { GitHubProvider } from "@1git/hosting/providers/github";
import { GitLabProvider } from "@1git/hosting/providers/gitlab";
import { parseRemote } from "@1git/hosting/remote";
import type { GitHttpAuthentication } from "@1git/git";
import { AccountStore, type SavedAccount } from "./account-store";
import type { Accounts } from "./accounts";

/** A cancellable chooser; null means cancel, not permission to fall back to another identity. */
export type ChooseRemoteAccount = (
	remote: string,
	url: string,
	accounts: readonly SavedAccount[],
	signal: AbortSignal
) => Promise<string | null>;

/** App-only account bindings, shared by linked worktrees and invalidated by remote URL changes. No tokens. */
export class RemoteAccounts {
	constructor(
		readonly accounts: Accounts,
		readonly path = join(
			dirname(AccountStore.defaultPath()),
			"remote-accounts.json"
		)
	) {}

	matching(url: string): SavedAccount[] {
		if (!url.startsWith("https://")) return [];

		return this.accounts.load().filter((account) => {
			const provider =
				account.provider === "github"
					? new GitHubProvider({ webUrl: account.webUrl })
					: new GitLabProvider({ webUrl: account.webUrl });

			const parsed = parseRemote(url, [provider]);

			return (
				parsed.ok &&
				parsed.value.providerId === account.provider &&
				parsed.value.host === new URL(account.webUrl).host &&
				parsed.value.browserUrl.startsWith(account.webUrl)
			);
		});
	}

	choice(directory: string, remote: string, url: string): string {
		return this.load()[this.key(directory, remote, url)] ?? "automatic";
	}

	select(directory: string, remote: string, url: string, choice: string): void {
		if (
			choice !== "automatic" &&
			choice !== "system" &&
			!this.matching(url).some(
				(account) => AccountStore.key(account) === choice
			)
		)
			throw new Error("Choose a connected account that matches this remote.");

		const document = this.load();
		const key = this.key(directory, remote, url);

		if (choice === "automatic") delete document[key];
		else document[key] = choice;

		const content = JSON.stringify({ version: 1, choices: document });

		if (Buffer.byteLength(content) > 256 * 1024)
			throw new Error("Too many saved remote account choices.");

		const temporary = `${this.path}.${randomUUID()}.tmp`;

		mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });

		try {
			writeFileSync(temporary, content, { mode: 0o600, flag: "wx" });
			renameSync(temporary, this.path);
		} finally {
			rmSync(temporary, { force: true });
		}
	}

	async authentication(
		directory: string,
		remote: string,
		url: string,
		signal: AbortSignal,
		choose?: ChooseRemoteAccount
	): Promise<GitHttpAuthentication | undefined> {
		signal.throwIfAborted();

		// SSH, local paths and unsupported transports never read the account vault or preferences.
		if (!url.startsWith("https://")) return undefined;

		let choice = this.choice(directory, remote, url);

		if (choice === "system") return undefined;

		const accounts = this.matching(url);
		const [onlyAccount] = accounts;

		if (choice === "automatic") {
			if (!accounts.length) return undefined;

			if (accounts.length === 1 && onlyAccount)
				choice = AccountStore.key(onlyAccount);
			else {
				const selected = choose
					? await choose(remote, url, accounts, signal)
					: null;

				signal.throwIfAborted();

				if (!selected)
					throw new Error(
						"Choose an account for this remote in Repository → Remotes before synchronizing."
					);

				this.select(directory, remote, url, selected);
				choice = selected;
			}
		}

		if (choice === "system") return undefined;

		const account = accounts.find((item) => AccountStore.key(item) === choice);

		if (!account)
			throw new Error(
				"The saved remote account is unavailable. Choose an account in Repository → Remotes; no other account was used."
			);

		try {
			return await this.accounts.remoteAuthentication(account, url, signal);
		} catch {
			signal.throwIfAborted();

			throw new Error(
				"Could not authenticate this account. Check or reconnect it in Settings; no other account was used."
			);
		}
	}

	private key(directory: string, remote: string, url: string): string {
		return createHash("sha256")
			.update(JSON.stringify([directory, remote, url]))
			.digest("hex");
	}

	private load(): Record<string, string> {
		try {
			if (statSync(this.path).size > 256 * 1024) throw new Error();

			const data: unknown = JSON.parse(readFileSync(this.path, "utf8"));

			if (
				!data ||
				typeof data !== "object" ||
				!("version" in data) ||
				data.version !== 1 ||
				!("choices" in data) ||
				!data.choices ||
				typeof data.choices !== "object" ||
				Array.isArray(data.choices)
			)
				throw new Error();

			const choices: Record<string, string> = {};

			for (const [key, value] of Object.entries(data.choices)) {
				if (
					!/^[a-f0-9]{64}$/u.test(key) ||
					typeof value !== "string" ||
					(value !== "system" && !/^1git-hosting-v1:[a-f0-9]{64}$/u.test(value))
				)
					throw new Error();

				choices[key] = value;
			}

			return choices;
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT")
				return {};

			throw new Error(
				"Could not read remote account choices. The saved file was left unchanged."
			);
		}
	}
}
