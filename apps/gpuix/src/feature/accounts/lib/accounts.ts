import { HostingClient } from "@1git/hosting";
import { GitHubProvider } from "@1git/hosting/providers/github";
import { GitLabProvider } from "@1git/hosting/providers/gitlab";
import type { HostingProvider } from "@1git/hosting/provider";
import type {
	AccessToken,
	HostingFetch,
	PageOptions,
	Page,
	Repository,
	RepositoryRef,
	CommitIdentity,
} from "@1git/hosting/contracts";
import { parseRemote } from "@1git/hosting/remote";
import { GitRepository, type GitResult } from "@1git/git";
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
	/** Public host configuration for images; no vault reads or account credentials. */
	async avatarProviders(): Promise<readonly HostingProvider[]> {
		const accounts = await this.load();

		const providers: HostingProvider[] = [
			new GitHubProvider({ fetch: this.fetch }),
			new GitLabProvider({ fetch: this.fetch }),
		];

		const hosts = new Set(
			providers.map((provider) => new URL(provider.defaultWebUrl).href)
		);

		for (const account of accounts) {
			if (hosts.has(account.webUrl)) continue;

			hosts.add(account.webUrl);
			const options = {
				webUrl: account.webUrl,
				fetch: this.fetch,
				timeoutMs: 5000,
			};

			providers.push(
				account.provider === "github"
					? new GitHubProvider(options)
					: new GitLabProvider(options)
			);
		}

		return providers;
	}
	private pending: Promise<unknown> = Promise.resolve();
	/** Client-bound pagination lives only for this window; credentials are looked up per request. */
	private readonly clients = new Map<string, HostingClient>();

	constructor(
		private readonly store: AccountStore,
		private readonly vault: CredentialVault,
		private readonly fetch?: HostingFetch,
		private readonly authorization = new AccountAuthorization(fetch)
	) {}

	load(): SavedAccount[] {
		return this.store.load();
	}

	/** Read a verified account's author suggestions; never persist them or change Git authentication. */
	async commitIdentity(
		account: SavedAccount,
		signal?: AbortSignal
	): Promise<CommitIdentity> {
		return this.mutate(async () => {
			const credential = await this.verifiedCredential(account, signal);

			const result = await this.configure(
				account.provider,
				account.webUrl,
				credential.token
			).getCommitIdentity({ signal });

			signal?.throwIfAborted();

			if (!result.ok || result.value.id !== account.id)
				throw new Error(
					"Could not read this account's identity. Check or reconnect the account in Settings."
				);

			const { name, email } = result.value;

			if (
				(name && (name.length > 256 || hasControlCharacters(name))) ||
				(email &&
					(email.length > 256 ||
						hasControlCharacters(email) ||
						!/^[^\s@<>]+@[^\s@<>]+$/u.test(email)))
			)
				throw new Error(
					"The account returned unusable author details. Enter a custom identity instead."
				);

			return { id: account.id, name: name?.trim() || account.username, email };
		});
	}

	/** Bounded provider search includes accessible public projects as well as account memberships. */
	async repositories(
		account: SavedAccount,
		query: string,
		options: PageOptions = {}
	): Promise<Page<Repository>> {
		if (query.length > 256 || hasControlCharacters(query))
			throw new Error("Use a search of up to 256 characters.");

		const key = AccountStore.key(account);
		let client = this.clients.get(key);

		if (!client) {
			client = this.configure(
				account.provider,
				account.webUrl,
				async ({ signal }) =>
					this.mutate(async () => {
						const credential = await this.verifiedCredential(account, signal);

						return credential.token;
					})
			);
			this.clients.set(key, client);
		}

		const result = query.trim()
			? await client.searchRepositories(query.trim(), options)
			: await client.listRepositories(options);

		if (!result.ok) {
			if (
				["permission", "authentication", "not-found"].includes(
					result.error.code
				)
			)
				throw new Error(
					"Check this account in Settings. Reconnect with repository access if needed; organization SSO may also require approval."
				);

			throw new Error(result.error.message);
		}

		return result.value;
	}

	/** Public permission hint, not a guarantee of access to any particular repository. */
	async repositoryAccess(account: SavedAccount): Promise<boolean | null> {
		const saved = await this.vault.read(AccountStore.key(account));

		if (saved === null) return false;

		const scopes = decodeCredential(saved, account.provider).oauth?.tokens
			.scopes;

		if (!scopes) return null;

		return account.provider === "github"
			? scopes.includes("repo")
			: scopes.includes("api") ||
					(scopes.includes("read_api") &&
						(scopes.includes("read_repository") ||
							scopes.includes("write_repository")));
	}

	/** Re-resolve the repository; never trust a renderer-supplied clone URL or return tokens to the form. */
	clone(
		account: SavedAccount,
		ref: RepositoryRef,
		path: string,
		signal: AbortSignal
	): Promise<GitResult<GitRepository>> {
		return this.mutate(async () => {
			const credential = await this.verifiedCredential(account, signal);

			const repository = await this.configure(
				account.provider,
				account.webUrl,
				credential.token
			).getRepository(ref, { signal });

			if (!repository.ok)
				throw new Error(
					"This repository is unavailable. Check account permissions and organization SSO in Settings."
				);

			if (
				repository.value.ref.owner !== ref.owner ||
				repository.value.ref.name !== ref.name
			)
				throw new Error(
					"The provider returned a different repository. Refresh the list before cloning."
				);

			const provider =
				account.provider === "github"
					? new GitHubProvider({ webUrl: account.webUrl })
					: new GitLabProvider({ webUrl: account.webUrl });

			const remote = repository.value.cloneUrls.https;
			const parsed = parseRemote(remote, [provider]);

			if (
				!parsed.ok ||
				parsed.value.providerId !== account.provider ||
				parsed.value.host !== new URL(account.webUrl).host ||
				parsed.value.repository.owner !== repository.value.ref.owner ||
				parsed.value.repository.name !== repository.value.ref.name
			)
				throw new Error(
					"The provider returned an unexpected clone destination. No credentials were sent to Git."
				);

			signal.throwIfAborted();

			return await GitRepository.clone({
				path,
				remoteUrl: remote,
				signal,
				httpAuthentication: {
					username: account.provider === "github" ? "x-access-token" : "oauth2",
					password: credential.token,
				},
			});
		});
	}

	private async verifiedCredential(
		account: SavedAccount,
		signal?: AbortSignal
	): Promise<AccountCredential> {
		if (
			!this.store
				.load()
				.some((saved) => AccountStore.key(saved) === AccountStore.key(account))
		)
			throw new Error(
				"This account was removed. Choose a connected account in Settings."
			);

		const credential = await this.credential(account, signal);

		if (!credential)
			throw new Error("Reconnect this account in Settings — no saved token.");

		const identity = await this.configure(
			account.provider,
			account.webUrl,
			credential.token
		).getAccount({ signal });

		if (!identity.ok || identity.value.id !== account.id)
			throw new Error(
				"Reconnect this account in Settings — the saved identity could not be verified."
			);

		return credential;
	}

	private async credential(
		account: SavedAccount,
		signal?: AbortSignal
	): Promise<AccountCredential | null> {
		signal?.throwIfAborted();
		const key = AccountStore.key(account);
		const saved = await this.vault.read(key);

		if (saved === null) return null;

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
				throw new Error("Reconnect — token expired or invalid");

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
			// Persist rotated credentials before any subsequent API/Git failure.
			await this.vault.write(key, encodeCredential(credential));
		}

		return credential;
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
			let credential: AccountCredential | null;

			try {
				credential = await this.credential(account, signal);
			} catch (cause) {
				if (
					cause instanceof Error &&
					cause.message === "Reconnect — token expired or invalid"
				)
					return cause.message;

				throw cause;
			}

			if (!credential) return "Reconnect — no saved token";

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

			this.clients.delete(key);

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
