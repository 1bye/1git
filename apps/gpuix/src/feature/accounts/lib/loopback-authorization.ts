import type { Authorization } from "@1git/hosting/oauth";

/** Exact registered IPv4 loopback callback; deliberately no wildcard, random port, or public bind. */
export class LoopbackAuthorization {
	static callback(value: string): URL {
		let url: URL;

		try {
			url = new URL(value);
		} catch {
			throw new Error(
				"Use a registered callback such as http://127.0.0.1:8765/oauth/callback."
			);
		}

		if (
			url.protocol !== "http:" ||
			url.hostname !== "127.0.0.1" ||
			!url.port ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		)
			throw new Error(
				"Register an HTTP callback on 127.0.0.1 with an explicit port and no query parameters."
			);

		return url;
	}
	static async wait(
		attempt: Pick<Authorization, "authorizationUrl" | "expiresAt">,
		redirectUri: string,
		open: (url: string) => Promise<void>,
		signal: AbortSignal
	): Promise<string> {
		const redirect = this.callback(redirectUri);

		signal.throwIfAborted();
		const expectedState = new URL(attempt.authorizationUrl).searchParams.get(
			"state"
		);

		if (!expectedState) throw new Error("Invalid pending authorization.");

		const completion = Promise.withResolvers<string>();

		// Attach immediately: cancellation/browser failures must not leave a rejected promise unobserved.
		void completion.promise.catch(() => undefined);
		let received = false;
		let server: ReturnType<typeof Bun.serve>;

		try {
			server = Bun.serve({
				hostname: "127.0.0.1",
				port: Number(redirect.port),
				maxRequestBodySize: 1024,
				fetch(request) {
					const url = new URL(request.url);

					const valid =
						!received &&
						request.method === "GET" &&
						url.origin === redirect.origin &&
						url.pathname === redirect.pathname &&
						url.search.length <= 8192 &&
						url.searchParams.getAll("state").length === 1 &&
						url.searchParams.get("state") === expectedState &&
						((url.searchParams.getAll("code").length === 1 &&
							!!url.searchParams.get("code")) ||
							url.searchParams.has("error"));

					if (!valid)
						return new Response("Invalid authorization callback.", {
							status: 400,
						});

					received = true;
					completion.resolve(url.href);

					return new Response(
						"Return to 1git to finish signing in. You can close this page.",
						{
							headers: {
								"Content-Type": "text/plain; charset=utf-8",
								"Cache-Control": "no-store",
								"Referrer-Policy": "no-referrer",
								"Content-Security-Policy":
									"default-src 'none'; frame-ancestors 'none'",
							},
						}
					);
				},
			});
		} catch {
			throw new Error(
				"Could not open the local sign-in callback port. Close another sign-in attempt or register a different port."
			);
		}

		const cancel = () =>
			completion.reject(new Error("Authorization cancelled."));

		signal.addEventListener("abort", cancel, { once: true });
		const timeout = setTimeout(
			() =>
				completion.reject(new Error("Authorization timed out. Start again.")),
			Math.max(1, attempt.expiresAt - Date.now())
		);

		try {
			signal.throwIfAborted();
			await open(attempt.authorizationUrl);

			return await completion.promise;
		} finally {
			clearTimeout(timeout);
			signal.removeEventListener("abort", cancel);
			await server.stop();
		}
	}
}
