import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type {
	CallOptions,
	HostingFetch,
	Page,
	PageOptions,
	RateLimit,
} from "./contracts.js";
import { fail, Failure, nonempty } from "./result.js";
import { HostingProvider } from "./provider.js";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MAX_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export class Endpoints {
	readonly web: URL;
	readonly api: URL;
	readonly fetch: HostingFetch;
	readonly timeoutMs: number;
	readonly maxResponseBytes: number;

	private readonly allowLoopbackHttp: boolean;
	private readonly sshHost?: string;

	constructor(readonly provider: HostingProvider) {
		if (!(provider instanceof HostingProvider))
			fail("validation", "Provide a HostingProvider instance.");

		const { options } = provider;

		this.allowLoopbackHttp = options.allowLoopbackHttp ?? false;
		this.sshHost = options.sshHost;
		nonempty(provider.id, "provider ID");

		this.web = this.endpoint(options.webUrl ?? provider.defaultWebUrl);
		this.api = this.endpoint(
			options.apiUrl ?? provider.apiUrl(new URL(this.web)).href
		);

		if (options.sshHost && !/^[a-z\d.-]+$/iu.test(options.sshHost))
			fail("validation", "Invalid SSH hostname.");

		this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
		this.timeoutMs = options.timeoutMs ?? 15_000;
		this.maxResponseBytes = options.maxResponseBytes ?? 4 * 1024 * 1024;

		if (
			!Number.isInteger(this.timeoutMs) ||
			this.timeoutMs < 1 ||
			this.timeoutMs > MAX_TIMEOUT_MS
		)
			fail("validation", "Invalid request deadline.");

		if (
			!Number.isInteger(this.maxResponseBytes) ||
			this.maxResponseBytes < 1 ||
			this.maxResponseBytes > MAX_RESPONSE_BYTES
		)
			fail("validation", "Invalid response size limit.");
	}

	private endpoint(input: string): URL {
		let url: URL;

		try {
			url = new URL(input);
		} catch {
			return fail("validation", "Invalid provider endpoint.");
		}

		if (
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			(url.protocol !== "https:" &&
				!(
					this.allowLoopbackHttp &&
					url.protocol === "http:" &&
					LOOPBACK.has(url.hostname)
				))
		)
			fail(
				"validation",
				"Provider endpoints require credential-free HTTPS URLs."
			);

		if (!url.pathname.endsWith("/")) url.pathname += "/";

		return url;
	}

	browser(value: string): string {
		let url: URL;

		try {
			url = new URL(value);
		} catch {
			return fail("invalid-response", "Invalid repository URL.");
		}

		if (
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			url.origin !== this.web.origin ||
			!url.pathname.startsWith(this.web.pathname)
		)
			fail("invalid-response", "Unexpected repository URL.");

		return url.href;
	}

	/** GitHub clones may use git@host:path or ssh://git@host/path. No token-bearing usernames. */
	ssh(value: unknown): string | null {
		if (value == null) return null;

		if (typeof value !== "string" || /[\s?#]/u.test(value))
			fail("invalid-response", "Invalid SSH clone URL.");

		const scp = /^git@([^:]+):(.+)$/u.exec(value);
		const sshHost = this.sshHost ?? this.web.hostname;

		if (scp && scp[1] === sshHost && scp[2] && !/[\s@:\\]/u.test(scp[2]))
			return value;

		try {
			const url = new URL(value);

			if (
				url.protocol === "ssh:" &&
				url.username === "git" &&
				!url.password &&
				url.hostname === sshHost &&
				!url.search &&
				!url.hash
			)
				return value;
		} catch {
			/* Rejected below without including untrusted URL data. */
		}

		return fail("invalid-response", "Unexpected SSH clone URL.");
	}
}

function headerNumber(headers: Headers, name: string): number | undefined {
	const text = headers.get(name);

	if (text === null || !/^\d+$/u.test(text)) return undefined;

	const value = Number(text);

	return Number.isSafeInteger(value) ? value : undefined;
}

function rateLimit(headers: Headers): RateLimit {
	const limit =
		headerNumber(headers, "x-ratelimit-limit") ??
		headerNumber(headers, "ratelimit-limit");

	const remaining =
		headerNumber(headers, "x-ratelimit-remaining") ??
		headerNumber(headers, "ratelimit-remaining");

	const reset =
		headerNumber(headers, "x-ratelimit-reset") ??
		headerNumber(headers, "ratelimit-reset");

	const retry = headers.get("retry-after");

	const delay =
		retry && /^\d+$/u.test(retry)
			? Number(retry)
			: retry
				? Math.max(0, Math.ceil((Date.parse(retry) - Date.now()) / 1000))
				: undefined;

	return {
		...(limit === undefined ? {} : { limit }),
		...(remaining === undefined ? {} : { remaining }),
		...(reset === undefined ? {} : { resetAt: reset * 1000 }),
		...(delay === undefined || !Number.isFinite(delay)
			? {}
			: { retryAfterSeconds: delay }),
	};
}

function wait<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise((resolve, reject) => {
		const abort = () => reject(signal.reason);

		if (signal.aborted) {
			abort();

			return;
		}

		signal.addEventListener("abort", abort, { once: true });
		promise
			.then(resolve, reject)
			.finally(() => signal.removeEventListener("abort", abort));
	});
}

export interface Reply {
	readonly data: unknown;
	readonly headers: Headers;
	readonly rateLimit: RateLimit;
}

export class Transport {
	private readonly cursorKey = randomBytes(32);

	constructor(
		readonly endpoints: Endpoints,
		private readonly token?:
			| string
			| ((options: CallOptions) => string | Promise<string>)
	) {}

	async request(
		url: URL,
		method: string,
		options: CallOptions = {},
		body?: unknown,
		authorization?: string,
		form = false
	): Promise<Reply> {
		const { endpoints } = this;

		if (
			![endpoints.api, endpoints.web].some(
				(base) =>
					url.origin === base.origin && url.pathname.startsWith(base.pathname)
			) ||
			url.username ||
			url.password ||
			url.hash
		)
			fail("validation", "Request outside the configured provider.");

		const deadline = AbortSignal.timeout(endpoints.timeoutMs);

		const signal = options.signal
			? AbortSignal.any([options.signal, deadline])
			: deadline;

		try {
			if (signal.aborted) throw signal.reason;

			const headers = new Headers({ Accept: "application/json" });

			if (authorization) headers.set("Authorization", authorization);
			else if (this.token !== undefined) {
				const token =
					typeof this.token === "string"
						? this.token
						: await wait(Promise.resolve(this.token({ signal })), signal);

				nonempty(token, "access token");

				if (/\s/u.test(token)) fail("authentication", "Invalid access token.");

				headers.set("Authorization", `Bearer ${token}`);
			}

			if (url.href.startsWith(endpoints.api.href)) {
				for (const [name, value] of Object.entries(
					endpoints.provider.apiHeaders()
				)) {
					if (name.toLowerCase() === "authorization")
						fail(
							"validation",
							"Provider API headers cannot replace account credentials."
						);

					headers.set(name, value);
				}
			}

			if (body !== undefined)
				headers.set(
					"Content-Type",
					form ? "application/x-www-form-urlencoded" : "application/json"
				);

			const response = await wait(
				endpoints.fetch(url, {
					method,
					headers,
					signal,
					redirect: "manual",
					...(body === undefined
						? {}
						: { body: form ? String(body) : JSON.stringify(body) }),
				}),
				signal
			);

			const rate = rateLimit(response.headers);

			if (response.status >= 300 && response.status < 400) {
				await response.body?.cancel();
				fail(
					"invalid-response",
					"Provider redirects are not followed; check the configured endpoint."
				);
			}

			if (!response.ok) {
				await response.body?.cancel();
				const status = response.status;

				const code =
					status === 401
						? "authentication"
						: status === 429 ||
							  (status === 403 &&
									(rate.remaining === 0 ||
										rate.retryAfterSeconds !== undefined))
							? "rate-limit"
							: status === 403
								? "permission"
								: status === 404
									? "not-found"
									: status === 400 || status === 409 || status === 422
										? "validation"
										: "network";

				throw new Failure({
					code,
					message: `Provider request failed (${code}).`,
					status,
					rateLimit: rate,
					retryable:
						method === "GET" && (status >= 500 || code === "rate-limit"),
				});
			}

			const data = await this.read(response, signal);

			return { data, headers: response.headers, rateLimit: rate };
		} catch (error) {
			if (options.signal?.aborted)
				fail("cancelled", "Hosting operation cancelled.");

			if (deadline.aborted)
				fail("timeout", "Hosting request exceeded its deadline.");

			if (error instanceof Failure) throw error;

			throw new Failure({
				code: "network",
				message: "Could not reach the hosting provider.",
				retryable: method === "GET",
			});
		}
	}

	private async read(
		response: Response,
		signal: AbortSignal
	): Promise<unknown> {
		if (!response.body) return null;

		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let size = 0;

		try {
			while (true) {
				const chunk = await wait(reader.read(), signal);

				if (chunk.done) break;

				size += chunk.value.byteLength;

				if (size > this.endpoints.maxResponseBytes)
					fail(
						"invalid-response",
						"Provider response exceeded the size limit."
					);

				chunks.push(chunk.value);
			}
		} finally {
			await reader.cancel().catch(() => undefined);
			reader.releaseLock();
		}

		if (!size) return null;

		try {
			return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
		} catch {
			return fail("invalid-response", "Provider returned malformed JSON.");
		}
	}

	url(path: string): URL {
		return new URL(path, this.endpoints.api);
	}

	async page<T>(
		path: string,
		query: Record<string, string>,
		options: PageOptions,
		decode: (data: unknown) => T[]
	): Promise<Page<T>> {
		const size = options.pageSize ?? 50;

		if (!Number.isInteger(size) || size < 1 || size > 100)
			fail("validation", "Page size must be between 1 and 100.");

		const initial = this.url(path);

		for (const [key, value] of Object.entries(query))
			initial.searchParams.set(key, value);

		initial.searchParams.set("per_page", String(size));
		const current = options.cursor
			? this.decodeCursor(options.cursor, initial)
			: initial;

		const reply = await this.request(current, "GET", options);
		const items = decode(reply.data);
		let nextUrl: URL | null = null;
		const link = reply.headers.get("link");
		const nextLink = link?.match(/<([^>]+)>;\s*rel="next"/u)?.[1];
		const nextPage = reply.headers.get("x-next-page");

		if (nextLink) {
			try {
				nextUrl = new URL(nextLink, current);
			} catch {
				fail("invalid-response", "Invalid pagination URL.");
			}
		} else if (nextPage) {
			if (!/^\d+$/u.test(nextPage))
				fail("invalid-response", "Invalid pagination page.");

			nextUrl = new URL(current);
			nextUrl.searchParams.set("page", nextPage);
		}

		if (nextUrl) this.validateNext(nextUrl, initial, current);

		const next = nextUrl ? this.encodeCursor(nextUrl, initial) : null;

		return { items, next, rateLimit: reply.rateLimit };
	}

	private validateNext(next: URL, initial: URL, current?: URL): void {
		const page = next.searchParams.get("page");

		if (
			!page ||
			!/^\d+$/u.test(page) ||
			!Number.isSafeInteger(Number(page)) ||
			Number(page) <= Number(current?.searchParams.get("page") ?? 1)
		)
			fail("invalid-response", "Invalid pagination progression.");

		const withoutPage = new URL(next);

		withoutPage.searchParams.delete("page");
		withoutPage.searchParams.sort();
		const expected = new URL(initial);

		expected.searchParams.sort();

		if (withoutPage.href !== expected.href)
			fail(
				"invalid-response",
				"Pagination changed the request endpoint or filters."
			);
	}

	private encodeCursor(next: URL, initial: URL): string {
		const payload = Buffer.from(
			JSON.stringify([initial.href, next.href])
		).toString("base64url");

		return `${payload}.${createHmac("sha256", this.cursorKey).update(payload).digest("base64url")}`;
	}

	private decodeCursor(cursor: string, initial: URL): URL {
		try {
			if (cursor.length > 16_384) throw new Error();

			const [payload, signature, extra] = cursor.split(".");

			if (!payload || !signature || extra) throw new Error();

			const expected = createHmac("sha256", this.cursorKey)
				.update(payload)
				.digest();

			const received = Buffer.from(signature, "base64url");

			if (
				received.length !== expected.length ||
				!timingSafeEqual(received, expected)
			)
				throw new Error();

			const data: unknown = JSON.parse(
				Buffer.from(payload, "base64url").toString("utf8")
			);

			if (
				!Array.isArray(data) ||
				data[0] !== initial.href ||
				typeof data[1] !== "string"
			)
				throw new Error();

			const next = new URL(data[1]);

			this.validateNext(next, initial);

			return next;
		} catch {
			return fail(
				"validation",
				"Invalid cursor; use the same client, operation, and filters."
			);
		}
	}
}
