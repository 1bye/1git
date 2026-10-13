/**
 * Covers: saved stack resolution, selected-profile auth, scoped token lifetime and cleanup.
 * Real: Alchemy local state/profile reader, Cloudflare SDK serialization and credentials derivation.
 * Doubles: isolated profile/state files and intercepted HTTP; no live Cloudflare calls.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import {
	releaseProfileLayer,
	ReleaseStack,
	withReleaseUploadCredentials,
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

it("uses the named Alchemy profile and revokes bucket-only credentials on success or failure", async () => {
	const directory = await mkdtemp(resolve(tmpdir(), "1git-release-profile-"));
	const previousHome = process.env.ALCHEMY_HOME;

	process.env.ALCHEMY_HOME = directory;
	const events: string[] = [];
	const profileDirectory = resolve(directory, "profiles/personal");
	const expires: string[] = [];
	let tokenMode: "normal" | "incomplete" | "denied" = "normal";
	let revokeFails = false;

	const fakeFetch: typeof fetch = Object.assign(
		async (input: string | URL | Request, init?: RequestInit) => {
			const request =
				input instanceof Request
					? new Request(input, init)
					: new Request(String(input), init);

			const url = new URL(request.url);

			expect(url.hostname).toBe("api.cloudflare.com");
			expect(request.headers.get("authorization")).toBe(
				"Bearer synthetic-profile-token"
			);
			events.push(request.method);

			if (request.method === "POST") {
				if (tokenMode === "denied")
					return Response.json(
						{
							success: false,
							errors: [{ code: 7003, message: "synthetic-private-detail" }],
						},
						{ status: 400 }
					);

				const body = await request.json();

				if (
					typeof body !== "object" ||
					body === null ||
					!("policies" in body) ||
					!("expires_on" in body) ||
					typeof body.expires_on !== "string"
				)
					throw new Error("Invalid token request");

				expect(body.policies).toEqual([
					{
						effect: "allow",
						resources: {
							[`com.cloudflare.edge.r2.bucket.${target.accountId}_default_${target.bucket}`]:
								"*",
						},
						permission_groups: [
							{ id: "6a018a9f2fc74eb6b293b0c548f38b39" },
							{ id: "2efd5506f9c8494dacb1fa10a3e7d5b6" },
						],
					},
				]);
				expires.push(body.expires_on);

				return Response.json({
					success: true,
					result: {
						id: "b".repeat(32),
						...(tokenMode === "incomplete"
							? {}
							: { value: "synthetic-upload-token" }),
						status: "active",
					},
					errors: [],
					messages: [],
				});
			}

			if (request.method !== "DELETE")
				throw new Error("Unexpected Cloudflare operation");

			if (revokeFails)
				return Response.json(
					{
						success: false,
						errors: [{ code: 7003, message: "synthetic-private-detail" }],
					},
					{ status: 400 }
				);

			return Response.json({
				success: true,
				result: { id: "b".repeat(32) },
				errors: [],
				messages: [],
			});
		},
		{ preconnect: () => {} }
	);

	try {
		await mkdir(profileDirectory, { recursive: true });
		await writeFile(
			resolve(profileDirectory, "cloudflare.json"),
			JSON.stringify({
				format: "alchemy.profile/v1",
				provider: "Cloudflare",
				metadata: {},
				values: {
					method: "stored",
					credentialType: "apiToken",
					apiToken: "synthetic-profile-token",
					accountId: target.accountId,
				},
			}),
			{ mode: 0o600 }
		);
		const run = (fail: boolean) =>
			Effect.runPromise(
				withReleaseUploadCredentials(target, async (credentials) => {
					events.push("publish");
					expect(credentials).toEqual({
						endpoint: `https://${target.accountId}.r2.cloudflarestorage.com`,
						bucket: target.bucket,
						accessKeyId: "b".repeat(32),
						secretAccessKey: createHash("sha256")
							.update("synthetic-upload-token")
							.digest("hex"),
					});

					if (fail) throw new Error("Publish failed");

					return "published";
				}).pipe(
					Effect.provide(releaseProfileLayer("personal")),
					Effect.provide(FetchHttpClient.layer),
					Effect.provideService(FetchHttpClient.Fetch, fakeFetch)
				)
			);

		expect(await run(false)).toBe("published");
		await expect(run(true)).rejects.toThrow("Publish failed");
		expect(events).toEqual([
			"POST",
			"publish",
			"DELETE",
			"POST",
			"publish",
			"DELETE",
		]);

		for (const expiry of expires) {
			expect(Date.parse(expiry) - Date.now()).toBeGreaterThan(3500000);
			expect(Date.parse(expiry) - Date.now()).toBeLessThanOrEqual(3600000);
		}

		await expect(
			Effect.runPromise(
				withReleaseUploadCredentials(
					{ ...target, accountId: "c".repeat(32) },
					async () => {
						throw new Error("Must not publish");
					}
				).pipe(
					Effect.provide(releaseProfileLayer("personal")),
					Effect.provide(FetchHttpClient.layer),
					Effect.provideService(FetchHttpClient.Fetch, fakeFetch)
				)
			)
		).rejects.toThrow("different account");
		expect(events).toHaveLength(6);

		tokenMode = "incomplete";
		await expect(run(false)).rejects.toThrow("incomplete upload credentials");
		expect(events.slice(6)).toEqual(["POST", "DELETE"]);

		tokenMode = "denied";
		await expect(run(false)).rejects.toThrow("Account API Tokens Write");
		expect(events.slice(8)).toEqual(["POST"]);

		tokenMode = "normal";
		revokeFails = true;
		expect(await run(false)).toBe("published");
		expect(events.slice(9)).toEqual(["POST", "publish", "DELETE"]);
	} finally {
		if (previousHome === undefined) delete process.env.ALCHEMY_HOME;
		else process.env.ALCHEMY_HOME = previousHome;

		await rm(directory, { recursive: true, force: true });
	}
});

it("refreshes OAuth through Alchemy and persists it without using environment credentials", async () => {
	const directory = await mkdtemp(resolve(tmpdir(), "1git-release-oauth-"));
	const previousHome = process.env.ALCHEMY_HOME;
	const previousToken = process.env.CLOUDFLARE_API_TOKEN;
	const previousAccount = process.env.CLOUDFLARE_ACCOUNT_ID;

	process.env.ALCHEMY_HOME = directory;
	process.env.CLOUDFLARE_API_TOKEN = "environment-token-must-not-be-used";
	process.env.CLOUDFLARE_ACCOUNT_ID = "c".repeat(32);
	const file = resolve(directory, "profiles/oauth/cloudflare.json");
	const events: string[] = [];

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
					scope: "workers-r2.write offline_access",
				});
			}

			expect(url.hostname).toBe("api.cloudflare.com");
			expect(request.headers.get("authorization")).toBe("Bearer fresh-oauth");
			events.push(request.method);

			if (request.method === "POST")
				return Response.json({
					success: true,
					result: { id: "b".repeat(32), value: "temporary-upload" },
					errors: [],
					messages: [],
				});

			if (request.method !== "DELETE") throw new Error("Unexpected request");

			return Response.json({
				success: true,
				result: { id: "b".repeat(32) },
				errors: [],
				messages: [],
			});
		},
		{ preconnect: () => {} }
	);

	try {
		await mkdir(resolve(directory, "profiles/oauth"), { recursive: true });
		await writeFile(
			file,
			JSON.stringify({
				format: "alchemy.profile/v1",
				provider: "Cloudflare",
				metadata: {},
				values: {
					method: "oauth",
					accountId: target.accountId,
					clientId: "e7e25ec474419def6ba38d2d2638b122",
					scopes: ["workers-r2.write", "offline_access"],
					access: "expired-oauth",
					refresh: "synthetic-refresh",
					expires: 0,
				},
			}),
			{ mode: 0o600 }
		);
		expect(
			await Effect.runPromise(
				withReleaseUploadCredentials(target, async () => "published").pipe(
					Effect.provide(releaseProfileLayer("oauth")),
					Effect.provide(FetchHttpClient.layer),
					Effect.provideService(FetchHttpClient.Fetch, fakeFetch)
				)
			)
		).toBe("published");
		expect(events).toEqual(["refresh", "POST", "DELETE"]);
		const saved = await Bun.file(file).text();

		expect(saved).toContain("fresh-oauth");
		expect(saved).toContain("rotated-refresh");
		expect(saved).not.toContain("temporary-upload");
		await expect(
			Effect.runPromise(
				withReleaseUploadCredentials(target, async () => {
					throw new Error("Must not publish");
				}).pipe(
					Effect.provide(releaseProfileLayer("missing")),
					Effect.provide(FetchHttpClient.layer),
					Effect.provideService(FetchHttpClient.Fetch, fakeFetch)
				)
			)
		).rejects.toThrow();
		expect(events).toHaveLength(3);
	} finally {
		if (previousHome === undefined) delete process.env.ALCHEMY_HOME;
		else process.env.ALCHEMY_HOME = previousHome;

		if (previousToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
		else process.env.CLOUDFLARE_API_TOKEN = previousToken;

		if (previousAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
		else process.env.CLOUDFLARE_ACCOUNT_ID = previousAccount;

		await rm(directory, { recursive: true, force: true });
	}
});
