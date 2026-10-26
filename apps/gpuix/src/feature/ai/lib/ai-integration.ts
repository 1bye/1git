import { randomUUID } from "node:crypto";
import type { CredentialVault } from "../../accounts/lib/native-credentials";
import {
	AiSettingsStore,
	emptyAiPreferences,
	type AiPreferences,
	type AiConnection,
	type AiConfiguration,
} from "./ai-settings-store";
import { AiHttp } from "./ai-http";
import { PiProvider } from "./pi-provider";
import { CommitHarness } from "./commit-harness";
import { ChatGptAuthorization } from "./chatgpt-authorization";
import { CliAgent } from "./cli-agent";
import type { AiModel } from "./ai-model";
import { CustomApi } from "./custom-api";

export type { AiModel } from "./ai-model";

/** Window-owned AI boundary; refresh coordination stays local and saved secrets stay in its vault. */
export class AiIntegration {
	private readonly refreshing = new Map<string, Promise<string>>();
	readonly authorization: ChatGptAuthorization;

	constructor(
		readonly store: AiSettingsStore,
		private readonly vault: CredentialVault,
		private readonly http = new AiHttp(),
		authorization?: ChatGptAuthorization,
		readonly cli = new CliAgent()
	) {
		this.authorization = authorization ?? new ChatGptAuthorization(http);
	}

	async hasCredentials(preferences: AiPreferences): Promise<boolean> {
		if (AiSettingsStore.isCli(preferences.provider)) return false;

		return (
			!!preferences.provider && !!(await this.vault.read(this.key(preferences)))
		);
	}

	async connectKey(
		input: AiConnection,
		apiKey: string,
		signal: AbortSignal
	): Promise<void> {
		const connection = AiSettingsStore.connection(input);

		if (
			connection.provider !== "opencode" ||
			!apiKey ||
			apiKey.length > 8192 ||
			/[\s\p{Cc}]/u.test(apiKey)
		)
			throw new Error("Enter a valid OpenCode API key.");

		await this.persistCredential(
			connection,
			apiKey,
			(current) => {
				const existing = current.connections.find(
					(item) => item.id === connection.id
				);

				if (existing) {
					if (existing.provider !== connection.provider)
						throw new Error("An existing connection's provider cannot change.");

					return current;
				}

				return {
					...current,
					connections: [
						...current.connections,
						{
							...emptyAiPreferences,
							id: connection.id,
							label: connection.label,
							provider: connection.provider,
							opencodeMode: connection.opencodeMode,
						},
					],
				};
			},
			signal
		);
	}

	setDefault(id: string | null): void {
		const current = this.store.load();
		const connection = current.connections.find((item) => item.id === id);

		if (
			id &&
			(!connection ||
				(!AiSettingsStore.isCli(connection.provider) && !connection.model) ||
				(connection.provider === "chatgpt" && !connection.chatgpt))
		)
			throw new Error("Configure this connection's sign-in and model first.");

		this.store.save({ ...current, defaultId: id });
	}

	async saveConnection(
		input: AiConnection,
		apiKey: string,
		useDefault: boolean,
		signal: AbortSignal
	): Promise<void> {
		const connection = AiSettingsStore.connection(input);
		const cli = AiSettingsStore.isCli(connection.provider);

		const credential =
			connection.provider === "api"
				? CustomApi.credential(
						apiKey || (await this.vault.read(this.key(connection))) || "[]"
					)
				: apiKey;

		if (!connection.model && !cli)
			throw new Error("Choose a model before saving this connection.");

		if (
			apiKey &&
			connection.provider !== "api" &&
			(connection.provider !== "opencode" ||
				apiKey.length > 8192 ||
				/[\s\p{Cc}]/u.test(apiKey))
		)
			throw new Error("Enter a valid OpenCode API key.");

		if (cli) await this.cli.check(connection, signal);
		else
			await this.refreshing.get(this.key(connection))?.catch(() => undefined);

		signal.throwIfAborted();

		if (
			!cli &&
			connection.provider !== "api" &&
			!apiKey &&
			!(
				connection.provider === "opencode" && connection.opencodeMode === "free"
			) &&
			!(await this.hasCredentials(connection))
		)
			throw new Error("Connect this account before saving its preferences.");

		const update = (current: AiConfiguration): AiConfiguration => {
			const existing = current.connections.find(
				(item) => item.id === connection.id
			);

			if (existing && existing.provider !== connection.provider)
				throw new Error("An existing connection's provider cannot change.");

			return {
				...current,
				connections: existing
					? current.connections.map((item) =>
							item.id === connection.id ? connection : item
						)
					: [...current.connections, connection],
				defaultId: useDefault
					? connection.id
					: current.defaultId === connection.id
						? null
						: current.defaultId,
			};
		};

		if (credential)
			await this.persistCredential(connection, credential, update, signal);
		else {
			signal.throwIfAborted();
			this.store.save(update(this.store.load()));
		}
	}

	async connect(
		input: AiConnection,
		open: (url: string) => Promise<void>,
		signal: AbortSignal
	): Promise<AiConnection> {
		const preferences = AiSettingsStore.connection(input);

		if (preferences.provider !== "chatgpt")
			throw new Error("Select ChatGPT to sign in with your browser.");

		await this.refreshing.get(this.key(preferences))?.catch(() => undefined);

		signal.throwIfAborted();
		const saved = this.store.load();

		const existing = saved.connections.find(
			(item) => item.id === preferences.id
		);

		if (existing && existing.provider !== preferences.provider)
			throw new Error("An existing connection's provider cannot change.");

		const prepared = {
			...preferences,
			hostId: saved.hostId ?? `urn:uuid:${randomUUID()}`,
		};

		// Save host identity before the first registration; cancellation must not create a new host next time.
		this.store.save({ ...saved, hostId: prepared.hostId });
		const result = await this.authorization.connect(prepared, open, signal);

		const next = AiSettingsStore.connection({
			...preferences,
			chatgpt: result.account,
		});

		signal.throwIfAborted();
		await this.persistCredential(
			next,
			JSON.stringify(result.session),
			(current) => {
				const existing = current.connections.find(
					(item) => item.id === next.id
				);

				if (existing && existing.provider !== next.provider)
					throw new Error("An existing connection's provider cannot change.");

				const persisted = {
					...(existing ?? {
						...emptyAiPreferences,
						id: next.id,
						label: next.label,
						provider: next.provider,
					}),
					chatgpt: result.account,
				};

				return {
					...current,
					connections: existing
						? current.connections.map((item) =>
								item.id === next.id ? persisted : item
							)
						: [...current.connections, persisted],
				};
			},
			signal
		);

		return next;
	}

	async disconnect(
		preferences: AiConnection,
		signal: AbortSignal
	): Promise<string> {
		const cli = AiSettingsStore.isCli(preferences.provider);

		if (!cli)
			await this.refreshing.get(this.key(preferences))?.catch(() => undefined);

		signal.throwIfAborted();

		const provider = preferences.provider;

		if (!provider) return "AI is disabled.";

		const key = cli ? null : this.key(preferences);

		let notice =
			"Disconnected. Saved credentials were removed from this device.";

		if (key && provider === "chatgpt" && preferences.chatgpt) {
			const raw = await this.vault.read(key);

			if (raw) {
				try {
					await this.authorization.revoke(
						ChatGptAuthorization.saved(raw, preferences.chatgpt),
						signal
					);
				} catch {
					notice =
						"Disconnected locally. Remote revocation was not confirmed; remove 1git in ChatGPT settings too.";
				}
			}
		}

		if (key) await this.vault.delete(key);
		else notice = "Connection removed. Your agent remains signed in.";

		const current = this.store.load();

		this.store.save({
			...current,
			connections: current.connections.filter(
				(item) => item.id !== preferences.id
			),
			defaultId:
				current.defaultId === preferences.id ? null : current.defaultId,
		});

		return notice;
	}

	async models(
		preferences: AiPreferences,
		signal: AbortSignal
	): Promise<AiModel[]> {
		if (preferences.provider === "api") return [];

		if (AiSettingsStore.isCli(preferences.provider))
			return await this.cli.models(preferences, signal);

		// Free discovery is public even when the OS vault is unavailable.
		const credential =
			preferences.provider === "opencode" && preferences.opencodeMode === "free"
				? undefined
				: await this.credential(preferences, signal);

		const raw = await this.http.json(
			`${PiProvider.base(preferences)}/models`,
			{
				headers: {
					...(credential ? { Authorization: `Bearer ${credential}` } : {}),
					"User-Agent": "1git/0.0.1",
				},
			},
			signal
		);

		const items =
			raw && typeof raw === "object"
				? preferences.provider === "chatgpt" && "models" in raw
					? raw.models
					: "data" in raw
						? raw.data
						: undefined
				: undefined;

		if (!Array.isArray(items) || items.length > 2000)
			throw new Error("The AI provider returned an invalid model list.");

		const models: AiModel[] = [];
		const seen = new Set<string>();
		const catalog = await PiProvider.catalog(preferences);

		for (const item of items) {
			if (!item || typeof item !== "object") continue;

			if (
				preferences.provider === "chatgpt" &&
				(!("visibility" in item) || item.visibility !== "list")
			)
				continue;

			const id: unknown =
				preferences.provider === "chatgpt" ? item.slug : item.id;

			const name: unknown =
				preferences.provider === "chatgpt" ? item.display_name : id;

			if (
				typeof id !== "string" ||
				!/^[a-zA-Z0-9._:-]{1,256}$/u.test(id) ||
				seen.has(id)
			)
				continue;

			if (
				preferences.provider === "opencode" &&
				(!PiProvider.protocol(id, preferences.opencodeMode) ||
					(preferences.opencodeMode === "free" && !PiProvider.free(id)))
			)
				continue;

			seen.add(id);
			models.push({
				value: id,
				label: typeof name === "string" ? name.slice(0, 256) : id,
				...PiProvider.capabilities(catalog.find((model) => model.id === id)),
			});
		}

		if (!models.length)
			throw new Error(
				"No supported text models are available for this account and plan."
			);

		return models;
	}

	async generate(
		preferences: AiPreferences,
		patch: string,
		signal: AbortSignal,
		onProgress?: (status: string) => void
	): Promise<string> {
		if (!patch.trim() || Buffer.byteLength(patch) > 16 * 1024 * 1024)
			throw new Error(
				"Select nonempty changes within the local 16 MiB collection limit."
			);

		const checked = AiSettingsStore.parse(preferences);

		if (AiSettingsStore.isCli(checked.provider)) {
			onProgress?.("Waiting for your local agent…");

			return await this.cli.generate(checked, patch, signal);
		}

		const credential = await this.credential(checked, signal);

		return await new CommitHarness(new PiProvider(this.http)).generate(
			checked,
			credential,
			patch,
			signal,
			onProgress
		);
	}

	private async credential(
		preferences: AiPreferences,
		signal: AbortSignal
	): Promise<string | undefined> {
		signal.throwIfAborted();

		if (!preferences.provider)
			throw new Error("Connect an AI provider in Settings → AI.");

		const key = this.key(preferences);

		const raw = await this.vault.read(key);

		if (
			!raw &&
			preferences.provider === "opencode" &&
			preferences.opencodeMode === "free"
		)
			return undefined;

		if (!raw)
			throw new Error("No AI credentials saved. Connect in Settings → AI.");

		if (preferences.provider === "api") return CustomApi.credential(raw);

		if (preferences.provider === "opencode") {
			if (raw.length > 8192 || /[\s\p{Cc}]/u.test(raw))
				throw new Error(
					"Invalid saved OpenCode key. Reconnect in Settings → AI."
				);

			return raw;
		}

		if (!preferences.chatgpt)
			throw new Error("Continue with ChatGPT in Settings → AI first.");

		const session = ChatGptAuthorization.saved(raw, preferences.chatgpt);

		if (session.expiresAt > Date.now() + 60_000) return session.accessToken;

		if (!this.refreshing.has(key)) {
			this.refreshing.set(
				key,
				(async () => {
					// Rotation belongs to the shared session, not a cancelled generation or Settings page.
					const refreshed = await this.authorization.refresh(
						session,
						AbortSignal.timeout(20_000)
					);

					await this.vault.write(key, JSON.stringify(refreshed));

					return refreshed.accessToken;
				})()
			);
		}

		const pending = this.refreshing.get(key)!;

		try {
			const credential = await pending;

			signal.throwIfAborted();

			return credential;
		} finally {
			if (this.refreshing.get(key) === pending) this.refreshing.delete(key);
		}
	}

	private key(preferences: AiPreferences): string {
		if (!preferences.provider || AiSettingsStore.isCli(preferences.provider))
			throw new Error("Select an AI connection in Settings → AI.");

		return AiSettingsStore.credentialKey(
			preferences.provider,
			preferences.chatgpt?.clientId,
			preferences.id
		);
	}

	private async persistCredential(
		preferences: AiPreferences,
		raw: string,
		update: (current: AiConfiguration) => AiConfiguration,
		signal: AbortSignal
	): Promise<void> {
		const key = this.key(preferences);
		const previous = await this.vault.read(key);

		signal.throwIfAborted();
		await this.vault.write(key, raw);

		try {
			signal.throwIfAborted();
			this.store.save(update(this.store.load()));
		} catch (error) {
			if (previous === null) await this.vault.delete(key);
			else await this.vault.write(key, previous);

			throw error;
		}
	}
}
