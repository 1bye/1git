/** Injectable HTTP boundary; errors never echo provider bodies, prompts or credentials. */
export type AiFetch = (
	input: string | URL | Request,
	init?: RequestInit
) => Promise<Response>;

/** Bounded fixed-destination requests shared by model discovery and OAuth. */
export class AiHttp {
	constructor(readonly fetch: AiFetch = globalThis.fetch) {}

	async json(
		url: string,
		init: RequestInit,
		signal: AbortSignal
	): Promise<unknown> {
		const combined = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
		let response: Response;

		try {
			response = await this.fetch(url, {
				...init,
				signal: combined,
				redirect: "error",
			});
		} catch {
			signal.throwIfAborted();

			throw new Error(
				"Could not reach the AI provider. Check your connection and try again."
			);
		}

		if (!response.ok) {
			await response.body?.cancel();

			throw new Error(AiHttp.error(response.status));
		}

		if (!response.body)
			throw new Error("The AI provider returned an empty response.");

		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let bytes = 0;

		try {
			while (true) {
				const chunk = await reader.read();

				if (chunk.done) break;

				bytes += chunk.value.byteLength;

				if (bytes > 1024 * 1024)
					throw new Error("The AI provider response was too large.");

				chunks.push(chunk.value);
			}

			try {
				return JSON.parse(Buffer.concat(chunks).toString("utf8"));
			} catch {
				throw new Error("The AI provider returned invalid data. Try again.");
			}
		} finally {
			await reader.cancel();
		}
	}

	static error(status: number, anonymous = false): string {
		if (anonymous && (status === 401 || status === 403))
			return "OpenCode rejected anonymous access to this model from 1git. Try an optional API key in Settings → AI.";

		if (anonymous && status === 429)
			return "OpenCode's anonymous usage limit was reached. Try again later, or add an optional API key in Settings → AI.";

		if (status === 401)
			return "AI credentials expired or were rejected. Reconnect in Settings → AI.";

		if (status === 403)
			return "This account cannot use the selected AI model or plan. Check access in Settings → AI.";

		if (status === 429)
			return "AI usage limit reached. Wait and try again, or choose another model in Settings → AI.";

		return `The AI provider could not complete the request (HTTP ${status}). Try again.`;
	}
}
