/** Non-secret configuration for a user-selected API endpoint. */
export interface CustomApiConfiguration {
	readonly protocol: "openai-chat" | "openai-responses" | "anthropic";
	readonly baseUrl: string;
}

/** Validates custom destinations and vault-only header values without echoing secrets. */
export class CustomApi {
	/** Origin comparisons allow paths and API formats to change without transferring headers to another server. */
	static origin(baseUrl: string | undefined): string | null {
		return baseUrl && URL.canParse(baseUrl) ? new URL(baseUrl).origin : null;
	}

	/** New vault entries bind headers to their destination, independently of mutable connection metadata. */
	static bindCredential(raw: string, baseUrl: string): string {
		const origin = CustomApi.origin(baseUrl);

		if (!origin) throw new Error("Enter a valid API base URL.");

		return JSON.stringify({
			origin,
			headers: JSON.parse(CustomApi.credential(raw)),
		});
	}

	/** Legacy header arrays can only be reused for the origin saved before the vault read began. */
	static readCredential(
		raw: string,
		baseUrl: string,
		legacyBaseUrl?: string
	): string {
		let value: unknown;

		try {
			value = raw.length <= 65_536 ? JSON.parse(raw) : null;
		} catch {
			value = null;
		}

		const legacy = Array.isArray(value);

		const origin = legacy
			? CustomApi.origin(legacyBaseUrl)
			: value && typeof value === "object" && "origin" in value
				? value.origin
				: null;

		const headers = legacy
			? value
			: value && typeof value === "object" && "headers" in value
				? value.headers
				: null;

		if (!Array.isArray(headers))
			throw new Error(
				"Invalid saved API headers. Replace them in Settings → AI."
			);

		const credential = CustomApi.credential(JSON.stringify(headers));

		if (headers.length && origin !== CustomApi.origin(baseUrl))
			throw new Error(
				"The API server changed. Enter headers for this server, or remove all headers for anonymous access."
			);

		return credential;
	}

	static configuration(value: unknown): CustomApiConfiguration {
		if (
			!value ||
			typeof value !== "object" ||
			!("protocol" in value) ||
			(value.protocol !== "openai-chat" &&
				value.protocol !== "openai-responses" &&
				value.protocol !== "anthropic") ||
			!("baseUrl" in value) ||
			typeof value.baseUrl !== "string" ||
			value.baseUrl.length > 2048 ||
			/[\s\p{Cc}]/u.test(value.baseUrl)
		)
			throw new Error(
				"Choose an API format and enter a valid HTTP or HTTPS base URL."
			);

		let url: URL;

		try {
			url = new URL(value.baseUrl);
		} catch {
			throw new Error("Enter a valid HTTP or HTTPS base URL.");
		}

		if (
			(url.protocol !== "https:" && url.protocol !== "http:") ||
			!url.hostname ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		)
			throw new Error(
				"Use an HTTP or HTTPS base URL without credentials, query parameters or fragments."
			);

		return { protocol: value.protocol, baseUrl: url.href.replace(/\/+$/u, "") };
	}

	static headers(raw: string): Headers {
		const failure = () =>
			new Error(
				"Enter valid, unique auth header names and values. Transport headers cannot be overridden."
			);

		let value: unknown;

		try {
			value = raw.length <= 32_768 ? JSON.parse(raw) : null;
		} catch {
			throw failure();
		}

		if (!Array.isArray(value) || value.length > 16) throw failure();

		const headers = new Headers();

		for (const item of value) {
			if (
				!item ||
				typeof item !== "object" ||
				!("name" in item) ||
				typeof item.name !== "string" ||
				!("value" in item) ||
				typeof item.value !== "string" ||
				!/^[!#$%&'*+.^_`|~a-zA-Z0-9-]{1,128}$/u.test(item.name) ||
				!item.value.trim() ||
				item.value.length > 8192 ||
				/\p{Cc}/u.test(item.value) ||
				/^(?:host|content-length|content-type|connection|transfer-encoding|accept-encoding|upgrade)$/iu.test(
					item.name
				) ||
				headers.has(item.name)
			)
				throw failure();

			try {
				headers.set(item.name, item.value);
			} catch {
				throw failure();
			}
		}

		return headers;
	}

	static credential(raw: string): string {
		return JSON.stringify(
			[...CustomApi.headers(raw)].map(([name, value]) => ({ name, value }))
		);
	}

	/** Preserve explicitly entered native effort values rather than guessing a model's capabilities. */
	static payload(
		configuration: CustomApiConfiguration,
		effort: string | undefined,
		payload: unknown
	): unknown {
		if (!effort) return payload;

		if (!payload || typeof payload !== "object")
			throw new Error("Invalid API request.");

		if (configuration.protocol === "openai-chat")
			return { ...payload, reasoning_effort: effort };

		if (configuration.protocol === "openai-responses")
			return { ...payload, reasoning: { effort } };

		return { ...payload, output_config: { effort } };
	}
}
