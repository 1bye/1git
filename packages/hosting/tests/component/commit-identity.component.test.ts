/**
 * Covers: provider author suggestions, email permissions/privacy, and safe failures.
 * Real: hosting clients, provider adapters, and HTTP normalization.
 * Doubles: captured HTTP responses; no live provider accounts.
 * Requires: none.
 */
import { expect, test } from "bun:test";
import { capture, value } from "../_shared/fixtures.js";

const profile = {
	id: 7,
	login: "alice",
	name: "Alice",
	html_url: "https://github.com/alice",
};

test("GitHub prefers a verified primary email and never suggests an unverified address", async () => {
	const { client, requests } = capture("github", (url) =>
		Response.json(
			url.pathname === "/user"
				? profile
				: [
						{
							email: "unverified@example.invalid",
							primary: true,
							verified: false,
						},
						{
							email: "secondary@example.invalid",
							primary: false,
							verified: true,
						},
						{ email: "primary@example.invalid", primary: true, verified: true },
					]
		)
	);

	expect(value(await client.getCommitIdentity())).toEqual({
		id: "7",
		name: "Alice",
		email: "primary@example.invalid",
	});
	expect(requests.at(-1)?.url.searchParams.get("per_page")).toBe("100");
});

test("GitHub returns no email when permission is unavailable instead of guessing from a public profile", async () => {
	const { client } = capture("github", (url) =>
		url.pathname === "/user"
			? Response.json({ ...profile, email: "public@example.invalid" })
			: Response.json({ message: "secret-response" }, { status: 403 })
	);

	expect(value(await client.getCommitIdentity())).toEqual({
		id: "7",
		name: "Alice",
		email: null,
	});
});

test("GitHub unverified-only email lists stay empty, while authentication failures remain failures", async () => {
	const { client } = capture("github", (url) =>
		Response.json(
			url.pathname === "/user"
				? profile
				: [
						{
							email: "unverified@example.invalid",
							primary: true,
							verified: false,
						},
					]
		)
	);

	const denied = capture("github", (url) =>
		url.pathname === "/user"
			? Response.json(profile)
			: Response.json({ message: "secret-response" }, { status: 401 })
	);

	expect(value(await client.getCommitIdentity()).email).toBeNull();
	expect(await denied.client.getCommitIdentity()).toMatchObject({
		ok: false,
		error: { code: "authentication" },
	});
});

test("GitLab uses the explicit commit email, not the account login email", async () => {
	const { client } = capture("gitlab", () =>
		Response.json({
			id: 7,
			name: "Alice",
			email: "personal@example.invalid",
			commit_email: "commit@example.invalid",
		})
	);

	expect(value(await client.getCommitIdentity())).toEqual({
		id: "7",
		name: "Alice",
		email: "commit@example.invalid",
	});
});

test("GitLab private-email sentinels do not expose the personal address", async () => {
	const { client } = capture("gitlab", () =>
		Response.json({
			id: 7,
			name: null,
			email: "personal@example.invalid",
			commit_email: "_private",
		})
	);

	expect(value(await client.getCommitIdentity())).toEqual({
		id: "7",
		name: null,
		email: null,
	});
});

test("GitLab can use the authenticated email when no commit email is configured", async () => {
	const { client } = capture("gitlab", () =>
		Response.json({
			id: 7,
			name: "Alice",
			email: "alice@example.invalid",
			commit_email: null,
		})
	);

	expect(value(await client.getCommitIdentity()).email).toBe(
		"alice@example.invalid"
	);
});
