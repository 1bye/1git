/**
 * Covers: remote identity, supported schemes, nested namespaces and rejection boundaries.
 * Real: remote parser and public result structs.
 * Doubles: none.
 * Requires: none.
 */
import { expect, test } from "bun:test";
import { parseRemote } from "../../src/remote.js";
import { value } from "../_shared/fixtures.js";

test.each([
	"https://github.com/alice/demo.git",
	"git@github.com:alice/demo.git",
	"ssh://git@github.com/alice/demo",
])("identifies %s", (remote) => {
	expect(value(parseRemote(remote))).toEqual({
		provider: "github",
		host: "github.com",
		repository: { owner: "alice", name: "demo" },
		browserUrl: "https://github.com/alice/demo",
	});
});

test("supports nested groups and explicit self-managed hosts", () => {
	expect(
		value(parseRemote("git@gitlab.com:team/sub/demo.git")).repository
	).toEqual({ owner: "team/sub", name: "demo" });
	expect(
		value(
			parseRemote("https://code.example/git/team/sub/demo.git", [
				{ provider: "gitlab", webUrl: "https://code.example/git" },
			])
		).browserUrl
	).toBe("https://code.example/git/team/sub/demo");
	expect(
		value(
			parseRemote("git@ssh.example:team/demo.git", [
				{
					provider: "gitlab",
					webUrl: "https://code.example",
					sshHost: "ssh.example",
				},
			])
		).host
	).toBe("code.example");
});

test.each([
	"https://token@github.com/a/b",
	"https://a:secret@github.com/a/b",
	"git://github.com/a/b",
	"file:///tmp/repo",
	"https://github.com/a/b?token=secret",
	"ssh://secret@github.com/a/b",
	"https://github.com/a/b/c",
	"https://github.com/a/%2e%2e",
	"https://github.com/a/b%2fc",
	"https://github.com/a/%ZZ",
	"git@github.com:a/..",
])("rejects unsafe remote %s", (remote) => {
	const result = parseRemote(remote);

	expect(result.ok).toBe(false);
	expect(JSON.stringify(result)).not.toContain("secret");
});

test("unknown hosts are unsupported rather than guessed", () => {
	expect(parseRemote("git@unregistered.example:a/b")).toMatchObject({
		ok: false,
		error: { code: "unsupported", operation: "parse-remote" },
	});
});
