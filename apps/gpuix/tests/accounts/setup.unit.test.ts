/**
 * Covers: provider setup destinations, least-privilege token prefills and unsafe host rejection.
 * Real: setup URL construction and URL parsing.
 * Doubles: none.
 * Requires: none; no browser, credential vault or live provider.
 */
import { expect, it } from "bun:test";
import { accountSetupUrl } from "../../src/feature/accounts/lib/account-setup";

it("links to each provider's application registration on the chosen host", () => {
	expect(accountSetupUrl("github", "https://github.com/", "browser")).toBe(
		"https://github.com/settings/applications/new"
	);
	expect(accountSetupUrl("gitlab", "https://gitlab.com", "browser")).toBe(
		"https://gitlab.com/user_settings/applications"
	);
	expect(
		accountSetupUrl("github", "https://enterprise.example", "browser")
	).toBe("https://enterprise.example/settings/applications/new");
	expect(
		accountSetupUrl("gitlab", "https://code.example/gitlab/", "browser")
	).toBe("https://code.example/gitlab/user_settings/applications");
});

it("prefills token names and only the permissions needed for current-user verification", () => {
	const github = new URL(
		accountSetupUrl("github", "https://github.com", "token")!
	);

	const gitlab = new URL(
		accountSetupUrl("gitlab", "https://code.example/team", "token")!
	);

	expect(github.pathname).toBe("/settings/personal-access-tokens/new");
	expect([...github.searchParams]).toEqual([
		["name", "1git"],
		["expires_in", "30"],
	]);
	expect(gitlab.pathname).toBe("/team/-/user_settings/personal_access_tokens");
	expect([...gitlab.searchParams]).toEqual([
		["name", "1git"],
		["scopes", "read_user"],
	]);
});

it("never opens a credential-bearing, non-HTTPS, ambiguous or unbounded host", () => {
	for (const host of [
		"",
		"not a URL",
		"http://github.com",
		"file:///tmp/test",
		"https://token@github.com",
		"https://user:password@github.com",
		"https://github.com?token=private",
		"https://github.com/#private",
		"https://github.com\n",
		`https://${"a".repeat(2050)}.example`,
	]) {
		expect(accountSetupUrl("github", host, "browser")).toBeUndefined();
		expect(accountSetupUrl("gitlab", host, "token")).toBeUndefined();
	}
});
