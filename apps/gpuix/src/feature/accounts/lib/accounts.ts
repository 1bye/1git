import { HostingClient } from "@1git/hosting";
import { GitHubProvider } from "@1git/hosting/providers/github";
import { GitLabProvider } from "@1git/hosting/providers/gitlab";
import type { AccessToken, HostingFetch } from "@1git/hosting/contracts";
import type { CredentialVault } from "./native-credentials";
import {
	AccountAuthorization,
	type BrowserConnection,
	type AccountRegistration,
} from "./account-authorization";
import {
	decodeCredential,
	encodeCredential,
	type AccountCredential,
} from "./account-credential";
import {
	AccountStore,
	hasControlCharacters,
	type SavedAccount,
} from "./account-store";

/** Token connection input; keep it transient and never include it in session/account metadata. */
export interface ConnectAccount {
	readonly provider: SavedAccount["provider"];
	readonly webUrl: string;
	readonly token: string;
	readonly replacing?: SavedAccount;
	readonly signal?: AbortSignal;
}

/** Per-window account lifecycle. Metadata and OS credentials are separate; mutations roll back on persistence failure. */
export class Accounts {
	private pending: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly store: AccountStore,
		private readonly vault: CredentialVault,
		private readonly fetch?: HostingFetch,
		private readonly authorization = new AccountAuthorization(fetch)
	) {}

	load(): SavedAccount[] {
		return this.store.load();
	}

	async connect(input: ConnectAccount): Promise<SavedAccount[]> {
		if (
			!input.token ||
			Buffer.byteLength(input.token) > 2048 ||
			/\s/.test(input.token) ||
			hasControlCharacters(input.token)
		)
			throw new Error("Enter a valid access token (up to 2048 bytes).");

		return this.saveConnection(input, { token: input.token });
	}

	async connectBrowser(
		input: BrowserConnection & {
			readonly replacing?: SavedAccount;
			readonly onAuthorized?: () => void;
		}
	): Promise<SavedAccount[]> {
		const tokens = await this.authorization.authorize(input);

		input.signal.throwIfAborted();
		input.onAuthorized?.();

		return this.saveConnection(
			{ ...input, token: tokens.accessToken },
			{
				token: tokens.accessToken,
				oauth: { registration: input.registration, tokens },
			}
		);
	}

	/** Only public registration is returned to the form; secret tokens never become renderer props. */
	async registration(
		account: SavedAccount
	): Promise<AccountRegistration | undefined> {
		const saved = await this.vault.read(AccountStore.key(account));

		return saved === null
			? undefined
			: decodeCredential(saved, account.provider).oauth?.registration;
	}

	private async saveConnection(
		input: ConnectAccount,
		credential: AccountCredential
	): Promise<SavedAccount[]> {
		const encoded = encodeCredential(credential);

		const client = this.configure(input.provider, input.webUrl, input.token);
		const identity = await client.getAccount({ signal: input.signal });

		if (!identity.ok) throw new Error(identity.error.message);

		const account: SavedAccount = {
			provider: input.provider,
			webUrl: client.webUrl,
			id: identity.value.id,
			username: identity.value.username,
		};

		if (
			input.replacing &&
			AccountStore.key(input.replacing) !== AccountStore.key(account)
		)
			throw new Error(
				"This token belongs to a different account. Use Add account instead."
			);

		return this.mutate(async () => {
			input.signal?.throwIfAborted();
			const saved = this.store.load();
			const key = AccountStore.key(account);
			const previous = await this.vault.read(key);

			input.signal?.throwIfAborted();

			await this.vault.write(key, encoded);
			const next = [
				...saved.filter((entry) => AccountStore.key(entry) !== key),
				account,
			];

			try {
				this.store.save(next);
			} catch {
				await this.restore(key, previous);

				throw new Error(
					"Could not save the account. The previous credential was restored."
				);
			}

			return next;
		});
	}

	/** Checks access without deleting expired credentials or treating network outages as sign-out. */
	async check(account: SavedAccount, signal?: AbortSignal): Promise<string> {
		return this.mutate(async () => {
			signal?.throwIfAborted();
			const key = AccountStore.key(account);
			const saved = await this.vault.read(key);

			if (saved === null) return "Reconnect — no saved token";

			let credential = decodeCredential(saved, account.provider);
			const oauth = credential.oauth;

			if (
				oauth &&
				oauth.tokens.expiresAt !== null &&
				oauth.tokens.expiresAt <= Date.now() + 60_000
			) {
				if (
					!oauth.tokens.refreshToken ||
					(oauth.tokens.refreshExpiresAt !== null &&
						oauth.tokens.refreshExpiresAt <= Date.now())
				)
					return "Reconnect — token expired or invalid";

				const tokens = await this.authorization.refresh(
					account.provider,
					account.webUrl,
					oauth.registration,
					oauth.tokens.refreshToken,
					signal
				);

				credential = {
					token: tokens.accessToken,
					oauth: { registration: oauth.registration, tokens },
				};
				// Refresh rotates the old pair. Save immediately even if the subsequent identity request fails.
				await this.vault.write(key, encodeCredential(credential));
			}

			const result = await this.configure(
				account.provider,
				account.webUrl,
				credential.token
			).getAccount({ signal });

			if (!result.ok) {
				if (result.error.code === "authentication")
					return "Reconnect — token expired or invalid";

				throw new Error(result.error.message);
			}

			return result.value.id === account.id
				? "Connected"
				: "Reconnect — account identity changed";
		});
	}

	/** Removes this application's saved credential, not the token on the provider or Git's credentials. */
	disconnect(account: SavedAccount): Promise<SavedAccount[]> {
		return this.mutate(async () => {
			const saved = this.store.load();
			const key = AccountStore.key(account);
			const previous = await this.vault.read(key);

			if (previous !== null) await this.vault.delete(key);

			const next = saved.filter((entry) => AccountStore.key(entry) !== key);

			try {
				this.store.save(next);
			} catch {
				if (previous !== null) await this.restore(key, previous);

				throw new Error(
					"Could not remove account metadata. The credential was restored."
				);
			}

			return next;
		});
	}

	private configure(
		provider: SavedAccount["provider"],
		webUrl: string,
		accessToken: AccessToken
	): HostingClient {
		const options = {
			webUrl,
			accessToken,
			fetch: this.fetch,
			timeoutMs: 10_000,
		};

		const configured = HostingClient.create(
			provider === "github"
				? new GitHubProvider(options)
				: new GitLabProvider(options)
		);

		if (!configured.ok) throw new Error(configured.error.message);

		return configured.value;
	}

	private async restore(key: string, previous: string | null): Promise<void> {
		try {
			if (previous === null) await this.vault.delete(key);
			else await this.vault.write(key, previous);
		} catch {
			throw new Error(
				"Account metadata could not be saved and credential rollback failed. Reconnect this account to repair it."
			);
		}
	}

	private mutate<T>(run: () => Promise<T>): Promise<T> {
		// ponytail: one settings writer per window; use a process-wide coordinator if multiple windows are introduced.
		const result = this.pending.then(run, run);

		this.pending = result.then(
			() => undefined,
			() => undefined
		);

		return result;
	}
}
