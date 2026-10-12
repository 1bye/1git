import { randomUUID } from "node:crypto";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { AiPreferences } from "./ai-settings-store";
import { AiHttp, type AiFetch } from "./ai-http";

type CommitApi =
	| "openai-responses"
	| "openai-completions"
	| "anthropic-messages";

/** Request-local Pi transport. Credentials and destinations are owned by 1git, never Pi discovery. */
export class PiProvider {
	constructor(private readonly http: AiHttp) {}

	static base(preferences: AiPreferences): string {
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
		const protocol =
			preferences.provider === "chatgpt"
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

		const catalog =
			preferences.provider === "chatgpt"
				? (await import("@earendil-works/pi-ai/providers/openai.models"))
						.OPENAI_MODELS
				: preferences.opencodeMode === "go"
					? (await import("@earendil-works/pi-ai/providers/opencode-go.models"))
							.OPENCODE_GO_MODELS
					: (await import("@earendil-works/pi-ai/providers/opencode.models"))
							.OPENCODE_MODELS;

		const known = Object.values(catalog).find(
			(item) => item.id === preferences.model
		);

		const model: Model<CommitApi> = {
			id: preferences.model,
			name: preferences.model,
			provider: preferences.provider === "chatgpt" ? "openai" : "opencode",
			api:
				protocol === "responses"
					? "openai-responses"
					: protocol === "messages"
						? "anthropic-messages"
						: "openai-completions",
			baseUrl: PiProvider.base(preferences),
			input: ["text"],
			// Leave provider reasoning defaults unchanged; do not invent capabilities for dynamic models.
			reasoning: false,
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

				if (
					url !== destination &&
					!(protocol === "messages" && url === `${destination}?beta=true`)
				)
					throw new Error("Unexpected AI request destination.");

				const headers = new Headers(init?.headers);

				// The SDK requires a key even for anonymous access; only the selected account may authenticate HTTP.
				headers.delete("authorization");
				headers.delete("x-api-key");

				if (credential) headers.set("authorization", `Bearer ${credential}`);

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
				apiKey: credential ?? "1git-anonymous",
				fetch: Object.assign(fetch, {
					preconnect: globalThis.fetch.preconnect,
				}),
				signal: combined,
				maxRetries: 0,
				timeoutMs: 120_000,
				maxTokens: model.maxTokens,
				cacheRetention: "none" as const,
			};

			if (responses)
				return responses.stream(
					{ ...model, api: "openai-responses" },
					context,
					{
						...request,
						onPayload: (payload) => {
							if (
								!payload ||
								typeof payload !== "object" ||
								!("input" in payload) ||
								!Array.isArray(payload.input)
							)
								throw new Error("Invalid Responses request.");

							return {
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
							};
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
						compat: undefined,
					},
					context,
					request
				);

			// The adapter is selected before the agent starts; this branch always has the chat module.
			if (!chat) throw new Error("Missing Pi transport.");

			return chat.stream(
				{
					...model,
					api: "openai-completions",
					compat: { supportsDeveloperRole: false, supportsStore: false },
				},
				context,
				request
			);
		};

		return { model, stream, failure: () => failure };
	}
}
