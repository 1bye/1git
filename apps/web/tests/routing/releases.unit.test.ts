/**
 * Covers: static asset routing, exact release paths, methods and upstream failures.
 * Real: website Worker request handler and Web Request/Response APIs.
 * Doubles: Cloudflare ASSETS binding and release origin fetch.
 * Requires: none.
 */
import { afterEach, expect, spyOn, test } from "bun:test";
import worker from "../../infra/worker";

afterEach(() => {
	spyOn(globalThis, "fetch").mockRestore();
});

test("serves the homepage, assets, and unknown paths through Astro assets", async () => {
	const origin = spyOn(globalThis, "fetch");
	const requests: string[] = [];

	const env = {
		ASSETS: {
			fetch: async (request: Request) => {
				requests.push(new URL(request.url).pathname);

				return new Response("static page");
			},
		},
	};

	for (const path of ["/", "/_astro/site.js", "/missing", "/1git-logo.svg"]) {
		const response = await worker.fetch(
			new Request(`https://preview.test${path}`),
			env
		);

		expect(await response.text()).toBe("static page");
	}

	expect(requests).toEqual([
		"/",
		"/_astro/site.js",
		"/missing",
		"/1git-logo.svg",
	]);
	expect(origin).not.toHaveBeenCalled();
});

test("keeps download redirects and headers intact without following them", async () => {
	const upstream = new Response(null, {
		status: 302,
		headers: {
			Location: "https://git.1bye.dev/1git-0.0.14-macos-arm64.zip",
			"Cache-Control": "no-store",
		},
	});

	const origin = spyOn(globalThis, "fetch").mockResolvedValue(upstream);

	const request = new Request("https://preview.test/download?source=website", {
		headers: { Authorization: "private", Cookie: "private" },
	});

	const response = await worker.fetch(request, {
		ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
	});

	expect(response).toBe(upstream);
	expect(origin).toHaveBeenCalledWith(
		"https://git.1bye.dev/download?source=website",
		{
			method: "GET",
			redirect: "manual",
		}
	);
});

test("serves HEAD requests for the feed and versioned archives through the release origin", async () => {
	const origin = spyOn(globalThis, "fetch").mockResolvedValue(
		new Response(null)
	);

	for (const path of ["/appcast.xml", "/1git-0.0.14-macos-arm64.zip"]) {
		const response = await worker.fetch(
			new Request(`https://preview.test${path}`, { method: "HEAD" }),
			{ ASSETS: { fetch: async () => new Response(null, { status: 404 }) } }
		);

		expect(response.status).toBe(200);
		expect(origin).toHaveBeenLastCalledWith(`https://git.1bye.dev${path}`, {
			method: "HEAD",
			redirect: "manual",
		});
	}
});

test("rejects writes to release URLs without touching the origin", async () => {
	const origin = spyOn(globalThis, "fetch");

	const response = await worker.fetch(
		new Request("https://preview.test/download", { method: "POST" }),
		{ ASSETS: { fetch: async () => new Response("unexpected") } }
	);

	expect(response.status).toBe(405);
	expect(response.headers.get("Allow")).toBe("GET, HEAD");
	expect(origin).not.toHaveBeenCalled();
});

test("does not proxy arbitrary or malformed download paths", async () => {
	const origin = spyOn(globalThis, "fetch");

	for (const path of [
		"/download/extra",
		"/appcast.xml/extra",
		"/1git-01.0.0-macos-arm64.zip",
		"/1git-anything.zip",
		"/%2fdownload",
	]) {
		const response = await worker.fetch(
			new Request(`https://preview.test${path}`),
			{
				ASSETS: {
					fetch: async () => new Response("not found", { status: 404 }),
				},
			}
		);

		expect(response.status).toBe(404);
	}

	expect(origin).not.toHaveBeenCalled();
});

test("reports an unavailable download origin without caching the error", async () => {
	spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
	const response = await worker.fetch(
		new Request("https://preview.test/download"),
		{
			ASSETS: { fetch: async () => new Response("unexpected") },
		}
	);

	expect(response.status).toBe(503);
	expect(response.headers.get("Cache-Control")).toBe("no-store");
	expect(await response.text()).toBe("Download temporarily unavailable");
});
