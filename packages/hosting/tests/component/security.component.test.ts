/**
 * Covers: endpoint trust, pagination, credentials, cancellation, response bounds and safe errors.
 * Real: HTTP transport and adapter boundaries.
 * Doubles: injected fetch, including malicious responses and stalled requests.
 * Requires: none.
 */
import { expect, test } from "bun:test";
import { HostingClient } from "../../src/hosting.js";
import { GitHubProvider } from "../../src/providers/github/provider.js";
import { capture, githubRepository, value } from "../_shared/fixtures.js";

test("serializing a client does not disclose its credential", () => {
	const { client } = capture("github", () => Response.json([]));

	expect(JSON.stringify(client)).not.toContain("fake-token");
});

test.each([
	"http://github.com",
	"https://secret@github.com",
	"https://github.com?token=secret",
	"file:///tmp",
])("rejects unsafe endpoint %s", (webUrl) => {
	expect(
		HostingClient.create(new GitHubProvider({ accessToken: "fake", webUrl }))
	).toMatchObject({ ok: false, error: { code: "validation" } });
});

test("HTTP opt-in is loopback-only", () => {
	expect(
		HostingClient.create(
			new GitHubProvider({
				accessToken: "fake",
				webUrl: "http://localhost:5000",
				allowLoopbackHttp: true,
			})
		).ok
	).toBe(true);
	expect(
		HostingClient.create(
			new GitHubProvider({
				accessToken: "fake",
				webUrl: "http://example.com",
				allowLoopbackHttp: true,
			})
		).ok
	).toBe(false);
});

test("pagination remains bound to client, operation and original filters", async () => {
	const { client, requests } = capture("github", (url) => {
		const next = new URL(url);

		next.searchParams.set("page", "2");

		return Response.json([githubRepository()], {
			headers: url.searchParams.has("page")
				? {}
				: { Link: `<${next}>; rel="next"` },
		});
	});

	const first = value(await client.listRepositories({ pageSize: 1 }));

	expect(first.next).not.toBeNull();
	const cursor = first.next ?? "";

	expect(
		value(await client.listRepositories({ pageSize: 1, cursor })).next
	).toBeNull();
	expect(requests.at(-1)?.url.searchParams.get("page")).toBe("2");
	expect(await client.listRepositories({ cursor })).toMatchObject({
		ok: false,
		error: { code: "validation" },
	});
	expect(
		await client.listRepositories({ cursor: `${cursor}x`, pageSize: 1 })
	).toMatchObject({ ok: false, error: { code: "validation" } });
	const other = capture("github", () => Response.json([]));

	expect(
		await other.client.listRepositories({ cursor, pageSize: 1 })
	).toMatchObject({ ok: false, error: { code: "validation" } });
	expect(other.requests).toHaveLength(0);
});

test.each([
	"https://evil.example/user/repos?page=2",
	"https://api.github.com/user/repos?page=2&token=secret",
	"https://api.github.com/user?per_page=50&page=2",
])("refuses malicious pagination %s", async (next) => {
	const { client, requests } = capture("github", () =>
		Response.json([], { headers: { Link: `<${next}>; rel="next"` } })
	);

	expect(await client.listRepositories()).toMatchObject({
		ok: false,
		error: { code: "invalid-response" },
	});
	expect(requests).toHaveLength(1);
});

test("GitLab numeric pagination produces a client-bound continuation", async () => {
	const { client, requests } = capture("gitlab", (url) =>
		Response.json([], {
			headers: { "X-Next-Page": url.searchParams.has("page") ? "" : "2" },
		})
	);

	const next = value(await client.listRepositories()).next;

	expect(next).not.toBeNull();
	expect(
		value(await client.listRepositories({ cursor: next ?? "" })).next
	).toBeNull();
	expect(requests.at(-1)?.url.pathname).toBe("/api/v4/projects");
});

test("redirects are never followed with credentials", async () => {
	const { client, requests } = capture(
		"github",
		() =>
			new Response(null, {
				status: 307,
				headers: { Location: "https://evil.example" },
			})
	);

	expect(await client.getAccount()).toMatchObject({
		ok: false,
		error: { code: "invalid-response" },
	});
	expect(requests).toHaveLength(1);
	expect(requests[0]?.init.redirect).toBe("manual");
});

test("accounts and rotating credential callbacks remain isolated", async () => {
	let token = "one";

	const one = capture("github", () => Response.json([]), {
		accessToken: () => token,
	});

	const two = capture("github", () => Response.json([]), {
		accessToken: "two",
	});

	await Promise.all([
		one.client.listRepositories(),
		two.client.listRepositories(),
	]);
	token = "rotated";
	await one.client.listRepositories();
	expect(
		one.requests.map((r) => new Headers(r.init.headers).get("Authorization"))
	).toEqual(["Bearer one", "Bearer rotated"]);
	expect(new Headers(two.requests[0]?.init.headers).get("Authorization")).toBe(
		"Bearer two"
	);
});

test.each([
	[401, "authentication"],
	[403, "permission"],
	[404, "not-found"],
	[422, "validation"],
	[429, "rate-limit"],
	[500, "network"],
] as const)("maps HTTP %s safely", async (status, code) => {
	const { client, requests } = capture("github", () =>
		Response.json({ message: "fake-token and server secrets" }, { status })
	);

	const result = await client.listRepositories();

	expect(result).toMatchObject({
		ok: false,
		error: { code, status, operation: "list-repositories" },
	});
	expect(JSON.stringify(result)).not.toContain("fake-token");
	expect(requests).toHaveLength(1);
});

test("rate-limit errors expose actionable metadata", async () => {
	const { client } = capture(
		"github",
		() =>
			new Response(null, {
				status: 403,
				headers: {
					"x-ratelimit-remaining": "0",
					"x-ratelimit-limit": "5000",
					"x-ratelimit-reset": "2000000000",
					"retry-after": "30",
				},
			})
	);

	expect(await client.listRepositories()).toMatchObject({
		ok: false,
		error: {
			code: "rate-limit",
			retryable: true,
			rateLimit: {
				remaining: 0,
				limit: 5000,
				resetAt: 2000000000000,
				retryAfterSeconds: 30,
			},
		},
	});
});

test("writes are not retried or marked automatically retryable", async () => {
	const { client, requests } = capture(
		"github",
		() => new Response(null, { status: 503 })
	);

	expect(
		await client.createPullRequest({
			repository: { owner: "a", name: "b" },
			sourceBranch: "feature",
			targetBranch: "main",
			title: "Change",
		})
	).toMatchObject({ ok: false, error: { retryable: false } });
	expect(requests).toHaveLength(1);
});

test("pre-aborted requests do not obtain credentials or reach fetch", async () => {
	let called = false;

	const { client, requests } = capture("github", () => Response.json([]), {
		accessToken: () => {
			called = true;

			return "fake";
		},
	});

	expect(
		await client.listRepositories({ signal: AbortSignal.abort() })
	).toMatchObject({ ok: false, error: { code: "cancelled" } });
	expect(called).toBe(false);
	expect(requests).toHaveLength(0);
});

test("deadline bounds an uncooperative credential store", async () => {
	const { client } = capture("github", () => Response.json([]), {
		accessToken: () => new Promise<string>(() => {}),
		timeoutMs: 10,
	});

	expect(await client.listRepositories()).toMatchObject({
		ok: false,
		error: { code: "timeout" },
	});
});

test("cancels an in-flight fetch even if the platform ignores its signal", async () => {
	const controller = new AbortController();
	const { client } = capture("github", () => new Promise<Response>(() => {}));
	const pending = client.listRepositories({ signal: controller.signal });

	controller.abort("secret cancellation reason");
	expect(await pending).toMatchObject({
		ok: false,
		error: { code: "cancelled" },
	});
});

test.each([
	new Response("not JSON"),
	Response.json({ unexpected: true }),
	Response.json([{}]),
])("rejects malformed provider responses", async (response) => {
	const { client } = capture("github", () => response);

	expect(await client.listRepositories()).toMatchObject({
		ok: false,
		error: { code: "invalid-response" },
	});
});

test("response byte limits are enforced even without content length", async () => {
	const { client } = capture("github", () => new Response("x".repeat(128)), {
		maxResponseBytes: 16,
	});

	expect(await client.listRepositories()).toMatchObject({
		ok: false,
		error: { code: "invalid-response" },
	});
});

test.each([
	"https://fake-token@github.com/a/b.git",
	"https://evil.example/a/b.git",
	"https://github.com/a/b.git?secret=token",
])("rejects unsafe returned clone URLs %s", async (cloneUrl) => {
	const { client } = capture("github", () =>
		Response.json({ ...githubRepository(), clone_url: cloneUrl })
	);

	const result = await client.getRepository({ owner: "a", name: "b" });

	expect(result).toMatchObject({
		ok: false,
		error: { code: "invalid-response" },
	});
	expect(JSON.stringify(result)).not.toContain("fake-token");
});

test("input validation happens before HTTP", async () => {
	const { client, requests } = capture("github", () => Response.json([]));

	expect((await client.listRepositories({ pageSize: 101 })).ok).toBe(false);
	expect((await client.getRepository({ owner: "..", name: "user" })).ok).toBe(
		false
	);
	expect((await client.getPullRequest({ owner: "a", name: "b" }, -1)).ok).toBe(
		false
	);
	expect((await client.searchRepositories("")).ok).toBe(false);
	expect(requests).toHaveLength(0);
});
