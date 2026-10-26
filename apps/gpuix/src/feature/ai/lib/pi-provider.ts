import { randomUUID } from "node:crypto";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
	getSupportedThinkingLevels,
	type Api,
	type Model,
} from "@earendil-works/pi-ai";
import type { AiPreferences } from "./ai-settings-store";
import { AiHttp, type AiFetch } from "./ai-http";
import { effortLabel, modelEffort, type AiModel } from "./ai-model";
import { CustomApi } from "./custom-api";

function nativeEffort(
	value: string
): value is "minimal" | "low" | "medium" | "high" | "xhigh" | "max" {
	return (
		value === "minimal" ||
		value === "low" ||
		value === "medium" ||
		value === "high" ||
		value === "xhigh" ||
		value === "max"
	);
}

type CommitApi =
	| "openai-responses"
	| "openai-completions"
	| "anthropic-messages";

/** Request-local Pi transport. Credentials and destinations are owned by 1git, never Pi discovery. */
export class PiProvider {
	constructor(private readonly http: AiHttp) {}

	/** Metadata enriches the account's live list; it never adds models to that list. */
	static async catalog(preferences: AiPreferences): Promise<Model<Api>[]> {
		if (preferences.provider === "api") return [];

		const catalog =
			preferences.provider === "chatgpt"
				? (await import("@earendil-works/pi-ai/providers/openai.models"))
						.OPENAI_MODELS
				: preferences.opencodeMode === "go"
					? (await import("@earendil-works/pi-ai/providers/opencode-go.models"))
							.OPENCODE_GO_MODELS
					: (await import("@earendil-works/pi-ai/providers/opencode.models"))
							.OPENCODE_MODELS;

		return Object.values(catalog);
	}

	static capabilities(model: Model<Api> | undefined): Pick<AiModel, "effort"> {
		if (!model) return {};

		if (!model.reasoning) return { effort: { source: "catalog", levels: [] } };

		// Budget-based thinking is not an effort selector. Only expose native effort controls.
		const adaptive =
			model.compat &&
			"forceAdaptiveThinking" in model.compat &&
			model.compat.forceAdaptiveThinking === true;

		if (model.api === "anthropic-messages" && !adaptive) return {};

		if (model.api !== "anthropic-messages" && !model.thinkingLevelMap)
			return {};

		if (
			model.api !== "anthropic-messages" &&
			model.api !== "openai-responses" &&
			model.api !== "openai-completions"
		)
			return {};

		const values = getSupportedThinkingLevels(model)
			.filter((level) => level !== "off")
			.map(
				(level) =>
					model.thinkingLevelMap?.[level] ??
					(model.api === "anthropic-messages" && level === "minimal"
						? "low"
						: level)
			);

		return {
			effort: {
				source: "catalog",
				levels: [...new Set(values)]
					.filter(nativeEffort)
					.map((value) => ({ value, label: effortLabel(value) })),
			},
		};
	}

	static base(preferences: AiPreferences): string {
		if (preferences.provider === "api")
			return CustomApi.configuration(preferences.api).baseUrl;

		if (preferences.provider === "chatgpt") return "https://api.openai.com/v1";

		return preferences.opencodeMode === "go"
			? "https://opencode.ai/zen/go/v1"
			: "https://opencode.ai/zen/v1";
	}

	/** Preserve the existing account catalog and its provider-specific wire routing. */
	static protocol(
		model: string,
		mode: AiPreferences["opencodeMode"]
	): "responses" | "messages" | "chat" | null {
		if (/^(?:gpt-|grok-|muse-spark-)/u.test(model)) return "responses";

		if (
			model.startsWith("claude-") ||
			(mode === "go" && /^(?:minimax-|qwen)/u.test(model)) ||
			/^qwen3\.(?:5-plus|6-plus|7-(?:plus|max)|8-flash)/u.test(model)
		)
			return "messages";

		if (/^(?:gemini-|jev-)/u.test(model)) return null;

		return "chat";
	}

	static free(model: string): boolean {
		return model.endsWith("-free") || model === "big-pickle";
	}

	async create(
		preferences: AiPreferences,
		credential: string | undefined,
		signal: AbortSignal
	): Promise<{
		model: Model<CommitApi>;
		stream: StreamFn;
		failure: () => string;
	}> {
		const custom =
			preferences.provider === "api"
				? CustomApi.configuration(preferences.api)
				: undefined;

		const protocol = custom
			? custom.protocol === "anthropic"
				? "messages"
				: custom.protocol === "openai-responses"
					? "responses"
					: "chat"
			: preferences.provider === "chatgpt"
				? "responses"
				: PiProvider.protocol(preferences.model, preferences.opencodeMode);

		if (
			!preferences.provider ||
			!preferences.model ||
			!protocol ||
			(preferences.provider === "opencode" &&
				preferences.opencodeMode === "free" &&
				!PiProvider.free(preferences.model))
		)
			throw new Error("Choose an available AI model in Settings → AI.");

		const anonymous =
			preferences.provider === "opencode" &&
			preferences.opencodeMode === "free" &&
			!credential;

		if (!credential && !anonymous)
			throw new Error("No AI credentials saved. Connect in Settings → AI.");

		const catalog = await PiProvider.catalog(preferences);
		const known = catalog.find((item) => item.id === preferences.model);

		const effort = custom
			? (preferences.effort ?? "")
			: modelEffort(
					{
						value: preferences.model,
						label: preferences.model,
						...PiProvider.capabilities(known),
					},
					preferences.effort
				);

		const reasoning = !custom && nativeEffort(effort) ? effort : undefined;

		const customHeaders = custom
			? CustomApi.headers(credential ?? "[]")
			: undefined;

		const model: Model<CommitApi> = {
			id: preferences.model,
			name: preferences.model,
			provider: custom
				? "1git-api"
				: preferences.provider === "chatgpt"
					? "openai"
					: "opencode",
			api:
				protocol === "responses"
					? "openai-responses"
					: protocol === "messages"
						? "anthropic-messages"
						: "openai-completions",
			baseUrl: PiProvider.base(preferences),
			input: ["text"],
			reasoning: reasoning !== undefined,
			contextWindow: known?.contextWindow ?? 32_768,
			maxTokens: Math.min(known?.maxTokens ?? 2048, 2048),
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		};

		let failure =
			"AI generation failed or was interrupted. Your draft was left unchanged; try again.";

		const sessionId = randomUUID();

		const { getCurrentSystemPrompt } =
			await import("@earendil-works/pi-ai/utils/transcript");

		const responses =
			protocol === "responses"
				? await import("@earendil-works/pi-ai/api/openai-responses")
				: undefined;

		const messages =
			protocol === "messages"
				? await import("@earendil-works/pi-ai/api/anthropic-messages")
				: undefined;

		const chat =
			protocol === "chat"
				? await import("@earendil-works/pi-ai/api/openai-completions")
				: undefined;

		const stream: StreamFn = (_model, context, options) => {
			const combined = AbortSignal.any([
				signal,
				...(options?.signal ? [options.signal] : []),
				AbortSignal.timeout(120_000),
			]);

			const fetch: AiFetch = async (address, init) => {
				combined.throwIfAborted();
				const url =
					typeof address === "string"
						? address
						: address instanceof URL
							? address.href
							: address.url;

				const endpoint = protocol === "chat" ? "chat/completions" : protocol;
				const destination = `${model.baseUrl}/${endpoint}`;

				const sdkDestination =
					protocol === "messages"
						? `${model.baseUrl.replace(/\/v1$/u, "")}/v1/messages`
						: destination;

				if (
					url !== sdkDestination &&
					!(protocol === "messages" && url === `${sdkDestination}?beta=true`)
				)
					throw new Error("Unexpected AI request destination.");

				const headers = new Headers(init?.headers);

				// The SDK requires a key even for anonymous access; only the selected account may authenticate HTTP.
				headers.delete("authorization");
				headers.delete("x-api-key");

				if (customHeaders) {
					for (const [name, value] of customHeaders) headers.set(name, value);
				} else if (credential)
					headers.set("authorization", `Bearer ${credential}`);

				headers.set("user-agent", "1git/0.0.1");

				if (preferences.provider === "opencode")
					headers.set("x-opencode-session", sessionId);

				const response = await this.http.fetch(destination, {
					...init,
					headers,
					signal: combined,
					redirect: "error",
				});

				if (!response.ok) {
					failure = AiHttp.error(response.status, anonymous);

					if (response.status === 400 || response.status === 422)
						failure =
							"The model rejected this generation request. Try a tool-capable model or fewer selected changes.";

					await response.body?.cancel();

					throw new Error(failure);
				}

				if (!response.body) throw new Error(failure);

				let bytes = 0;

				const bounded = response.body.pipeThrough(
					new TransformStream<Uint8Array, Uint8Array>({
						transform(chunk, controller) {
							bytes += chunk.byteLength;

							if (bytes > 2 * 1024 * 1024) {
								failure =
									"AI returned too much output. Your draft was left unchanged.";

								throw new Error(failure);
							}

							controller.enqueue(chunk);
						},
					})
				);

				return new Response(bounded, {
					status: response.status,
					headers: response.headers,
				});
			};

			const request = {
				apiKey: custom ? "1git-custom-api" : (credential ?? "1git-anonymous"),
				fetch: Object.assign(fetch, {
					preconnect: globalThis.fetch.preconnect,
				}),
				signal: combined,
				maxRetries: 0,
				timeoutMs: 120_000,
				maxTokens: model.maxTokens,
				cacheRetention: "none" as const,
				...(custom
					? {
							onPayload: (payload: unknown) =>
								CustomApi.payload(custom, preferences.effort, payload),
						}
					: {}),
			};

			if (responses)
				return responses.stream(
					{ ...model, api: "openai-responses" },
					context,
					{
						...request,
						reasoningEffort: reasoning,
						onPayload: (payload) => {
							if (
								!payload ||
								typeof payload !== "object" ||
								!("input" in payload) ||
								!Array.isArray(payload.input)
							)
								throw new Error("Invalid Responses request.");

							const requestPayload = {
								...payload,
								instructions: getCurrentSystemPrompt(context.messages),
								input: payload.input.filter(
									(item: unknown) =>
										!(
											item &&
											typeof item === "object" &&
											"role" in item &&
											(item.role === "system" || item.role === "developer")
										)
								),
								store: false,
								// Stateless Responses continuations need encrypted reasoning alongside tool results.
								...(custom ? { include: ["reasoning.encrypted_content"] } : {}),
							};

							return custom
								? CustomApi.payload(custom, preferences.effort, requestPayload)
								: requestPayload;
						},
					}
				);

			// Anthropic's SDK appends /v1 itself; retain OpenCode's existing endpoint rather than /v1/v1.
			if (messages)
				return messages.stream(
					{
						...model,
						baseUrl: model.baseUrl.replace(/\/v1$/u, ""),
						api: "anthropic-messages",
						compat: reasoning ? { forceAdaptiveThinking: true } : undefined,
					},
					context,
					{
						...request,
						...(reasoning && reasoning !== "minimal"
							? { thinkingEnabled: true, effort: reasoning }
							: {}),
					}
				);

			// The adapter is selected before the agent starts; this branch always has the chat module.
			if (!chat) throw new Error("Missing Pi transport.");

			return chat.stream(
				{
					...model,
					api: "openai-completions",
					compat: {
						...(known?.api === "openai-completions" ? known.compat : {}),
						supportsDeveloperRole: false,
						supportsStore: false,
					},
				},
				context,
				{ ...request, reasoningEffort: reasoning }
			);
		};

		return { model, stream, failure: () => failure };
	}
}
