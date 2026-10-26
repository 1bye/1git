import { createHash, randomUUID } from "node:crypto";
import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { WorkspaceSessionStore } from "../../workspace-tabs/lib/workspace-session-store";
import { isEffort } from "./ai-model";
import { CustomApi, type CustomApiConfiguration } from "./custom-api";

/** Non-secret AI preferences, separate from existing appearance and Git defaults. */
export interface AiPreferences {
	readonly id?: string;
	readonly provider:
		| "opencode"
		| "chatgpt"
		| "claude-code"
		| "codex"
		| "api"
		| null;
	readonly api?: CustomApiConfiguration;
	readonly executable?: string;
	/** Native provider value. Empty inherits provider settings; absent prefers Medium when supported. */
	readonly effort?: string;
	readonly opencodeMode: "zen" | "go" | "free";
	readonly model: string;
	readonly instructions: string;
	readonly hostId?: string;
	readonly chatgpt?: {
		readonly clientId: string;
		readonly subject: string;
		readonly email: string;
	};
}

/** One saved AI connection; its model and instructions travel with this identity. */
export interface AiConnection extends AiPreferences {
	readonly id: string;
	readonly label: string;
	readonly provider: Exclude<AiPreferences["provider"], null>;
}

/** Window-wide connection list and explicit generation default; null keeps AI off. */
export interface AiConfiguration {
	readonly connections: readonly AiConnection[];
	readonly defaultId: string | null;
	readonly hostId?: string;
}

export const emptyAiConfiguration: AiConfiguration = {
	connections: [],
	defaultId: null,
};

/** Starts disconnected, with no implicit paid model or network requests. */
export const emptyAiPreferences: AiPreferences = {
	provider: null,
	opencodeMode: "free",
	model: "",
	instructions: "",
};

const maxBytes = 64 * 1024;

/** Atomic private metadata only; secrets are explicitly excluded from serialization. */
export class AiSettingsStore {
	/** CLI connections own authentication and may use their configured default model. */
	static isCli(
		provider: AiPreferences["provider"]
	): provider is "claude-code" | "codex" {
		return provider === "claude-code" || provider === "codex";
	}

	constructor(
		readonly path = join(
			dirname(WorkspaceSessionStore.defaultPath()),
			"ai.json"
		)
	) {}

	static credentialKey(
		provider: "opencode" | "chatgpt" | "api",
		clientId = "",
		id?: string
	): string {
		if (id && id !== `legacy-${provider}`)
			return `1git-hosting-v1:${createHash("sha256")
				.update(JSON.stringify(["1git-ai-v2", provider, id]))
				.digest("hex")}`;

		// Reuse the native app-only vault namespace; domain separation prevents hosting-key collisions.
		return `1git-hosting-v1:${createHash("sha256")
			.update(
				JSON.stringify([
					"1git-ai-v1",
					provider,
					provider === "chatgpt" ? clientId : "",
				])
			)
			.digest("hex")}`;
	}

	load(): AiConfiguration {
		try {
			if (statSync(this.path).size > maxBytes)
				throw new Error("Oversized AI settings.");

			const value: unknown = JSON.parse(readFileSync(this.path, "utf8"));

			if (
				!value ||
				typeof value !== "object" ||
				!("version" in value) ||
				(value.version !== 1 && value.version !== 2)
			)
				throw new Error("Invalid AI settings.");

			if (value.version === 1 && "preferences" in value)
				return AiSettingsStore.migrate(
					AiSettingsStore.parse(value.preferences)
				);

			return AiSettingsStore.configuration(value);
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT")
				return emptyAiConfiguration;

			throw new Error(
				"Could not read AI settings. The file was left unchanged; repair it and restart the app."
			);
		}
	}

	save(input: AiConfiguration): void {
		const configuration = AiSettingsStore.configuration(input);
		const content = `${JSON.stringify({ version: 2, ...configuration })}\n`;

		if (Buffer.byteLength(content) > maxBytes)
			throw new Error("Too many AI connections or instructions.");

		const temporary = `${this.path}.${randomUUID()}.tmp`;

		mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });

		try {
			writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
			renameSync(temporary, this.path);
		} finally {
			rmSync(temporary, { force: true });
		}
	}

	static parse(value: unknown): AiPreferences {
		if (
			!value ||
			typeof value !== "object" ||
			!("provider" in value) ||
			(value.provider !== null &&
				value.provider !== "opencode" &&
				value.provider !== "chatgpt" &&
				value.provider !== "claude-code" &&
				value.provider !== "codex" &&
				value.provider !== "api") ||
			!("opencodeMode" in value) ||
			(value.opencodeMode !== "zen" &&
				value.opencodeMode !== "go" &&
				value.opencodeMode !== "free") ||
			!("model" in value) ||
			typeof value.model !== "string" ||
			value.model.length > 256 ||
			/[\s\p{Cc}]/u.test(value.model) ||
			!("instructions" in value) ||
			typeof value.instructions !== "string" ||
			value.instructions.length > 8000
		)
			throw new Error("Invalid AI preferences.");

		let hostId: string | undefined;
		let id: string | undefined;
		let chatgpt: AiPreferences["chatgpt"];
		let executable: string | undefined;

		const api =
			value.provider === "api"
				? CustomApi.configuration("api" in value ? value.api : undefined)
				: undefined;

		const effort = "effort" in value ? value.effort : undefined;

		if (effort !== undefined && effort !== "" && !isEffort(effort))
			throw new Error("Invalid AI effort value.");

		if (
			"executable" in value &&
			value.executable !== undefined &&
			value.executable !== ""
		) {
			if (
				typeof value.executable !== "string" ||
				!isAbsolute(value.executable) ||
				value.executable.length > 4096 ||
				/\p{Cc}/u.test(value.executable)
			)
				throw new Error("Enter an absolute path to the agent executable.");

			if (AiSettingsStore.isCli(value.provider)) executable = value.executable;
		}

		if ("id" in value && value.id !== undefined) {
			if (
				typeof value.id !== "string" ||
				!/^(?:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|legacy-(?:opencode|chatgpt))$/u.test(
					value.id
				)
			)
				throw new Error("Invalid AI connection ID.");

			id = value.id;
		}

		if ("hostId" in value && value.hostId !== undefined) {
			if (
				typeof value.hostId !== "string" ||
				!/^urn:uuid:[a-f0-9-]{36}$/u.test(value.hostId)
			)
				throw new Error("Invalid AI host ID.");

			hostId = value.hostId;
		}

		if ("chatgpt" in value && value.chatgpt !== undefined) {
			const account = value.chatgpt;

			if (
				!account ||
				typeof account !== "object" ||
				!("clientId" in account) ||
				typeof account.clientId !== "string" ||
				!/^oaiapp_[a-zA-Z0-9_-]{1,240}$/u.test(account.clientId) ||
				!("subject" in account) ||
				typeof account.subject !== "string" ||
				!account.subject ||
				account.subject.length > 256 ||
				/\p{Cc}/u.test(account.subject) ||
				!("email" in account) ||
				typeof account.email !== "string" ||
				account.email.length > 320 ||
				/\p{Cc}/u.test(account.email)
			)
				throw new Error("Invalid ChatGPT account.");

			chatgpt = {
				clientId: account.clientId,
				subject: account.subject,
				email: account.email,
			};
		}

		return {
			...(id ? { id } : {}),
			provider: value.provider,
			opencodeMode:
				value.opencodeMode === "go"
					? "go"
					: value.opencodeMode === "zen"
						? "zen"
						: "free",
			model: value.model,
			instructions: value.instructions,
			...(hostId ? { hostId } : {}),
			...(chatgpt ? { chatgpt } : {}),
			...(executable ? { executable } : {}),
			...(typeof effort === "string" ? { effort } : {}),
			...(api ? { api } : {}),
		};
	}

	/** Explicit projection keeps keys and tokens out of persisted connection metadata. */
	static connection(value: unknown): AiConnection {
		const preferences = AiSettingsStore.parse(value);

		if (
			!preferences.id ||
			!preferences.provider ||
			!value ||
			typeof value !== "object" ||
			!("label" in value) ||
			typeof value.label !== "string" ||
			!value.label.trim() ||
			value.label.length > 160 ||
			/\p{Cc}/u.test(value.label)
		)
			throw new Error(
				"Enter a name for the AI connection (up to 160 characters)."
			);

		if (
			preferences.id.startsWith("legacy-") &&
			preferences.id !== `legacy-${preferences.provider}`
		)
			throw new Error("Invalid migrated AI connection.");

		return {
			id: preferences.id,
			label: value.label.trim(),
			provider: preferences.provider,
			opencodeMode: preferences.opencodeMode,
			model: preferences.model,
			instructions: preferences.instructions,
			...(preferences.chatgpt ? { chatgpt: preferences.chatgpt } : {}),
			...(preferences.executable ? { executable: preferences.executable } : {}),
			...(preferences.api ? { api: preferences.api } : {}),
			...(preferences.effort !== undefined
				? { effort: preferences.effort }
				: {}),
		};
	}

	static selected(configuration: AiConfiguration): AiPreferences {
		const connection = configuration.connections.find(
			(item) => item.id === configuration.defaultId
		);

		return connection
			? {
					...connection,
					...(configuration.hostId ? { hostId: configuration.hostId } : {}),
				}
			: emptyAiPreferences;
	}

	private static configuration(value: unknown): AiConfiguration {
		if (
			!value ||
			typeof value !== "object" ||
			!("connections" in value) ||
			!Array.isArray(value.connections) ||
			value.connections.length > 100 ||
			!("defaultId" in value) ||
			(value.defaultId !== null && typeof value.defaultId !== "string")
		)
			throw new Error("Invalid AI connections.");

		const connections = value.connections.map((item: unknown) =>
			AiSettingsStore.connection(item)
		);

		const ids = new Set(connections.map((item) => item.id));

		if (
			ids.size !== connections.length ||
			(value.defaultId !== null && !ids.has(value.defaultId))
		)
			throw new Error("Invalid or duplicate AI connection selection.");

		const preferences = AiSettingsStore.parse({
			...emptyAiPreferences,
			...("hostId" in value ? { hostId: value.hostId } : {}),
		});

		return {
			connections,
			defaultId: value.defaultId,
			...(preferences.hostId ? { hostId: preferences.hostId } : {}),
		};
	}

	private static migrate(preferences: AiPreferences): AiConfiguration {
		const connections: AiConnection[] = [
			{
				...emptyAiPreferences,
				id: "legacy-opencode",
				label: "OpenCode",
				provider: "opencode",
				opencodeMode: preferences.opencodeMode,
				model: preferences.provider === "opencode" ? preferences.model : "",
				instructions: preferences.instructions,
			},
		];

		if (preferences.chatgpt || preferences.provider === "chatgpt")
			connections.push({
				...emptyAiPreferences,
				id: "legacy-chatgpt",
				label: preferences.chatgpt?.email || "ChatGPT",
				provider: "chatgpt",
				model: preferences.provider === "chatgpt" ? preferences.model : "",
				instructions: preferences.instructions,
				...(preferences.chatgpt ? { chatgpt: preferences.chatgpt } : {}),
			});

		return {
			connections,
			defaultId: preferences.provider ? `legacy-${preferences.provider}` : null,
			...(preferences.hostId ? { hostId: preferences.hostId } : {}),
		};
	}
}
