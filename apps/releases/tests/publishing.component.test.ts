/**
 * Covers: saved destinations, profile-authenticated object requests, OAuth refresh and account isolation.
 * Real: Alchemy local state/profile reader and existing credential resolver.
 * Doubles: isolated profile/state files and captured HTTP; no live Cloudflare calls.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import {
	releaseProfileLayer,
	ReleaseStack,
	withReleaseProfileRequest,
} from "../src/publishing";

const target = {
	accountId: "a".repeat(32),
	bucket: "release-updates",
	jurisdiction: "default",
	feedURL: "https://downloads.example.com/appcast.xml",
};

it("resolves the saved destination without reading profiles or deploying", async () => {
	const directory = await mkdtemp(resolve(tmpdir(), "1git-release-state-"));
	const stage = resolve(directory, "state/1git-releases/prod");

	try {
		const stack = new ReleaseStack(directory);

		await expect(stack.load("prod")).rejects.toThrow(
			"Missing or invalid outputs"
		);
		await expect(stack.load("../bad")).rejects.toThrow("stage");
		await mkdir(stage, { recursive: true });
		await writeFile(
			resolve(stage, "__stack_output__.json"),
			JSON.stringify({
				accountId: target.accountId,
				bucketName: target.bucket,
				jurisdiction: "default",
				workerURL: "https://downloads.example.com/",
			})
		);

		expect(await stack.load("prod")).toEqual(target);
		await writeFile(
			resolve(stage, "__stack_output__.json"),
			JSON.stringify({
				accountId: target.accountId,
				bucketName: target.bucket,
				jurisdiction: "default",
				workerURL: "https://name:secret@downloads.example.com/",
			})
		);
		await expect(stack.load("prod")).rejects.toThrow("HTTPS origin");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

for (const method of ["stored", "oauth"] as const) {
	it(`uses the existing ${method} profile for objects without creating API tokens`, async () => {
		const directory = await mkdtemp(resolve(tmpdir(), "1git-release-profile-"));
		const previousHome = process.env.ALCHEMY_HOME;
		const previousToken = process.env.CLOUDFLARE_API_TOKEN;
		const previousAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
		const file = resolve(directory, "profiles/personal/cloudflare.json");
		const events: string[] = [];
		const requests: Request[] = [];

		const profileValues =
			method === "stored"
				? {
						method,
						credentialType: "apiToken",
						apiToken: "synthetic-profile-token",
						accountId: target.accountId,
					}
				: {
						method,
						accountId: target.accountId,
						clientId: "e7e25ec474419def6ba38d2d2638b122",
						scopes: ["workers-r2.read", "workers-r2.write", "offline_access"],
						access: "expired-oauth",
						refresh: "synthetic-refresh",
						expires: 0,
					};

		const fakeFetch: typeof fetch = Object.assign(
			async (input: string | URL | Request, init?: RequestInit) => {
				const request =
					input instanceof Request
						? new Request(input, init)
						: new Request(String(input), init);

				const url = new URL(request.url);

				if (url.href === "https://dash.cloudflare.com/oauth2/token") {
					events.push("refresh");
					const body = new URLSearchParams(await request.text());

					expect(body.get("grant_type")).toBe("refresh_token");
					expect(body.get("refresh_token")).toBe("synthetic-refresh");

					return Response.json({
						access_token: "fresh-oauth",
						refresh_token: "rotated-refresh",
						expires_in: 3600,
						token_type: "bearer",
						scope: "workers-r2.read workers-r2.write offline_access",
					});
				}

				expect(url.hostname).toBe("api.cloudflare.com");
				expect(url.pathname).toStartWith(
					`/client/v4/accounts/${target.accountId}/r2/buckets/${target.bucket}/objects/`
				);
				expect(url.search).toBe("");
				expect(request.headers.get("authorization")).toBe(
					method === "stored"
						? "Bearer synthetic-profile-token"
						: "Bearer fresh-oauth"
				);
				expect(request.headers.get("cf-r2-jurisdiction")).toBe("eu");
				expect(request.redirect).toBe("error");
				requests.push(request);
				events.push(request.method);

				return new Response("object bytes", { headers: { ETag: '"object"' } });
			},
			{ preconnect: () => {} }
		);

		process.env.ALCHEMY_HOME = directory;
		process.env.CLOUDFLARE_API_TOKEN = "environment-token-must-not-be-used";
		process.env.CLOUDFLARE_ACCOUNT_ID = "c".repeat(32);

		const run = (
			operation: Parameters<typeof withReleaseProfileRequest>[1],
			accountId = target.accountId,
			profile = "personal"
		) =>
			Effect.runPromise(
				withReleaseProfileRequest(
					{ ...target, jurisdiction: "eu", accountId },
					operation
				).pipe(
					Effect.provide(releaseProfileLayer(profile)),
					Effect.provide(FetchHttpClient.layer),
					Effect.provideService(FetchHttpClient.Fetch, fakeFetch)
				)
			);

		try {
			await mkdir(resolve(directory, "profiles/personal"), { recursive: true });
			await writeFile(
				file,
				JSON.stringify({
					format: "alchemy.profile/v1",
					provider: "Cloudflare",
					metadata: {},
					values: profileValues,
				}),
				{ mode: 0o600 }
			);

			expect(
				await run(async (request) => {
					await request("appcast.xml", "GET");
					await request("1git-0.0.2-macos-arm64.zip", "PUT", {
						body: new Blob(["zip bytes"]),
						headers: { "If-None-Match": "*" },
					});
					await request("appcast.xml", "PUT", {
						body: new Blob(["signed feed"]),
						headers: { "If-Match": '"previous"' },
					});

					return "published";
				})
			).toBe("published");
			expect(events).toEqual(
				method === "stored"
					? ["GET", "PUT", "PUT"]
					: ["refresh", "GET", "PUT", "PUT"]
			);
			expect(requests[1]?.headers.get("if-none-match")).toBe("*");
			expect(requests[2]?.headers.get("if-match")).toBe('"previous"');
			expect(await requests[1]?.text()).toBe("zip bytes");
			expect(await requests[2]?.text()).toBe("signed feed");

			await expect(
				run(async () => {
					throw new Error("Must not publish");
				}, "c".repeat(32))
			).rejects.toThrow("different account");
			await expect(
				run(async (request) => await request("../another-bucket/key", "PUT"))
			).rejects.toThrow("Invalid release object key");
			await expect(
				run(async () => {
					throw new Error("Publish failed");
				})
			).rejects.toThrow("Publish failed");
			await expect(
				run(async () => "must not publish", target.accountId, "missing")
			).rejects.toThrow();
			expect(requests).toHaveLength(3);

			const saved = await Bun.file(file).text();

			if (method === "oauth") {
				expect(saved).toContain("fresh-oauth");
				expect(saved).toContain("rotated-refresh");
			}

			expect(saved).not.toContain("temporary-upload");
		} finally {
			if (previousHome === undefined) delete process.env.ALCHEMY_HOME;
			else process.env.ALCHEMY_HOME = previousHome;

			if (previousToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
			else process.env.CLOUDFLARE_API_TOKEN = previousToken;

			if (previousAccount === undefined)
				delete process.env.CLOUDFLARE_ACCOUNT_ID;
			else process.env.CLOUDFLARE_ACCOUNT_ID = previousAccount;

			await rm(directory, { recursive: true, force: true });
		}
	});
}
