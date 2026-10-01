/**
 * Covers: compiled public exports and consumer-facing result types.
 * Real: package exports, generated JS/declarations and public clients.
 * Doubles: HTTP response.
 * Requires: package build, no network.
 */
import { expect, test } from "bun:test";
import { HostingClient } from "@1git/hosting";
import { HostingOAuth } from "@1git/hosting/oauth";
import { parseRemote } from "@1git/hosting/remote";
import type { HostingResult, Repository } from "@1git/hosting/contracts";

test("a consumer can use every intended entry point", async () => {
	const configured = HostingClient.create({
		provider: "gitlab",
		accessToken: "fixture",
		fetch: async () => Response.json([]),
	});

	expect(configured.ok).toBe(true);

	if (!configured.ok) throw new Error("Configuration failed");

	const response = await configured.value.listRepositories();

	const first: HostingResult<Repository | undefined> = response.ok
		? { ok: true, value: response.value.items[0] }
		: response;

	expect(first).toEqual({ ok: true, value: undefined });
	expect(parseRemote("git@github.com:a/b.git").ok).toBe(true);
	expect(
		HostingOAuth.create({
			provider: "gitlab",
			clientId: "fixture",
			redirectUri: "https://example.invalid/callback",
			scopes: ["api"],
		}).ok
	).toBe(true);
});
