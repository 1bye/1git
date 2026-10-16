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
import { WorkspaceSessionStore } from "../../workspace-tabs/lib/workspace-session-store";

/** Non-secret account identity. Provider IDs are persistence metadata, not provider implementations. */
export interface SavedAccount {
	readonly provider: "github" | "gitlab";
	readonly webUrl: string;
	readonly id: string;
	readonly username: string;
	readonly credentialSource?: "github-cli";
}

const maxBytes = 64 * 1024;

/** Reject control characters in metadata and credential inputs without echoing their contents. */
export function hasControlCharacters(value: string): boolean {
	for (const character of value) {
		const code = character.charCodeAt(0);

		if (code < 32 || code === 127) return true;
	}

	return false;
}

/** Private, versioned account metadata. Never stores tokens or provider configuration objects. */
export class AccountStore {
	constructor(readonly path: string) {}

	static defaultPath(): string {
		return (
			process.env.GPUIX_ACCOUNTS_PATH ??
			join(dirname(WorkspaceSessionStore.defaultPath()), "accounts.json")
		);
	}

	/** Stable application-only key; disambiguates providers, hosts and users. */
	static key(account: SavedAccount): string {
		return `1git-hosting-v1:${createHash("sha256")
			.update(JSON.stringify([account.provider, account.webUrl, account.id]))
			.digest("hex")}`;
	}

	load(): SavedAccount[] {
		try {
			if (statSync(this.path).size > maxBytes)
				throw new Error("Account metadata is too large.");

			return AccountStore.parse(JSON.parse(readFileSync(this.path, "utf8")));
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT")
				return [];

			throw new Error(
				"Could not read saved accounts. The metadata file was left unchanged; repair it and try again."
			);
		}
	}

	save(accounts: readonly SavedAccount[]): void {
		// Explicit projection is essential: callers cannot accidentally serialize an access token.
		const document = {
			version: 1,
			accounts: accounts.map(
				({ provider, webUrl, id, username, credentialSource }) => ({
					provider,
					webUrl,
					id,
					username,
					...(credentialSource ? { credentialSource } : {}),
				})
			),
		};

		AccountStore.parse(document);
		const content = `${JSON.stringify(document)}\n`;

		if (Buffer.byteLength(content) > maxBytes)
			throw new Error("Too many saved accounts.");

		const temporary = `${this.path}.${randomUUID()}.tmp`;

		mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });

		try {
			writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
			renameSync(temporary, this.path);
		} catch {
			throw new Error("Could not save account metadata.");
		} finally {
			rmSync(temporary, { force: true });
		}
	}

	private static parse(document: unknown): SavedAccount[] {
		if (
			!document ||
			typeof document !== "object" ||
			!("version" in document) ||
			document.version !== 1 ||
			!("accounts" in document) ||
			!Array.isArray(document.accounts) ||
			document.accounts.length > 100
		)
			throw new Error("Invalid accounts.");

		const accounts: SavedAccount[] = [];
		const keys = new Set<string>();
		const entries: readonly unknown[] = document.accounts;

		for (const entry of entries) {
			if (
				!entry ||
				typeof entry !== "object" ||
				!("provider" in entry) ||
				(entry.provider !== "github" && entry.provider !== "gitlab") ||
				!("webUrl" in entry) ||
				typeof entry.webUrl !== "string" ||
				!("id" in entry) ||
				typeof entry.id !== "string" ||
				!("username" in entry) ||
				typeof entry.username !== "string"
			)
				throw new Error("Invalid account.");

			const url = new URL(entry.webUrl);

			const credentialSource =
				"credentialSource" in entry ? entry.credentialSource : undefined;

			if (
				credentialSource !== undefined &&
				(credentialSource !== "github-cli" ||
					entry.provider !== "github" ||
					url.pathname !== "/")
			)
				throw new Error("Invalid credential source.");

			if (
				url.protocol !== "https:" ||
				url.username ||
				url.password ||
				url.search ||
				url.hash ||
				url.href !== entry.webUrl ||
				!entry.id ||
				!entry.username ||
				[entry.id, entry.username, entry.webUrl].some(
					(value) => value.length > 2048 || hasControlCharacters(value)
				)
			)
				throw new Error("Invalid account identity.");

			const account: SavedAccount = {
				provider: entry.provider,
				webUrl: entry.webUrl,
				id: entry.id,
				username: entry.username,
				...(credentialSource === "github-cli"
					? ({ credentialSource } as const)
					: {}),
			};

			const key = AccountStore.key(account);

			if (keys.has(key)) throw new Error("Duplicate account.");

			keys.add(key);
			accounts.push(account);
		}

		return accounts;
	}
}
