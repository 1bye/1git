import { describe, expect, test } from "bun:test";
import {
	requireConfigKey,
	requireCredentialFreeRemoteUrl,
	requireIntegerInRange,
	requireRepositoryPaths,
	requireRevision,
	requireText,
} from "../src/validation.js";

describe("public input validation", () => {
	test("accepts normal text", () => {
		expect(requireText("main", "Branch", "create-branch")).toBe("main");
	});

	test("rejects empty text", () => {
		expect(() => requireText("", "Branch", "create-branch")).toThrow();
	});

	test("rejects NUL in text", () => {
		expect(() => requireText("bad\0name", "Branch", "create-branch")).toThrow();
	});

	test("accepts revision expressions", () => {
		expect(requireRevision("HEAD~2", "Revision", "get-commit")).toBe("HEAD~2");
		expect(requireRevision("stash@{0}", "Revision", "get-commit")).toBe(
			"stash@{0}"
		);
	});

	test("rejects option-like revisions", () => {
		expect(() =>
			requireRevision("--upload-pack=tool", "Revision", "get-commit")
		).toThrow();
	});

	test("accepts credential-free remote URL formats", () => {
		expect(
			requireCredentialFreeRemoteUrl(
				"https://example.com/owner/repository.git",
				"clone-repository"
			)
		).toBe("https://example.com/owner/repository.git");
		expect(
			requireCredentialFreeRemoteUrl(
				"git@example.com:owner/repository.git",
				"clone-repository"
			)
		).toBe("git@example.com:owner/repository.git");
		expect(
			requireCredentialFreeRemoteUrl(
				"/local/repository.git",
				"clone-repository"
			)
		).toBe("/local/repository.git");
	});

	test("rejects credentials embedded in HTTP remote URLs", () => {
		expect(() =>
			requireCredentialFreeRemoteUrl(
				"https://user:secret@example.com/repository.git",
				"clone-repository"
			)
		).toThrow(
			"Remote URL must not contain credentials. Configure a Git credential helper instead."
		);
		expect(() =>
			requireCredentialFreeRemoteUrl(
				"https://token@example.com/repository.git",
				"add-remote"
			)
		).toThrow();
	});

	test("rejects malformed HTTP remote URLs before invoking Git", () => {
		expect(() =>
			requireCredentialFreeRemoteUrl("https://[invalid", "clone-repository")
		).toThrow("Remote URL must be a valid HTTP URL.");
	});

	test("accepts repository-relative paths", () => {
		expect(
			requireRepositoryPaths(["src/app.ts", "docs/notes file.md"], "stage")
		).toEqual(["src/app.ts", "docs/notes file.md"]);
	});

	test("deduplicates repository paths without reordering", () => {
		expect(requireRepositoryPaths(["a.ts", "b.ts", "a.ts"], "stage")).toEqual([
			"a.ts",
			"b.ts",
		]);
	});

	test("rejects an empty path list", () => {
		expect(() => requireRepositoryPaths([], "stage")).toThrow();
	});

	test("rejects absolute repository paths", () => {
		expect(() => requireRepositoryPaths(["/tmp/outside"], "stage")).toThrow();
	});

	test("rejects parent traversal", () => {
		expect(() =>
			requireRepositoryPaths(["src/../../outside"], "stage")
		).toThrow();
	});

	test("accepts valid configuration keys", () => {
		expect(requireConfigKey("user.email", "get-config")).toBe("user.email");
		expect(requireConfigKey("remote.origin.url", "get-config")).toBe(
			"remote.origin.url"
		);
	});

	test("rejects invalid configuration keys", () => {
		expect(() => requireConfigKey("user", "get-config")).toThrow();
		expect(() => requireConfigKey(".user.email", "get-config")).toThrow();
	});

	test("accepts integers inside inclusive bounds", () => {
		expect(requireIntegerInRange(1, "Limit", 1, 10, "get-history")).toBe(1);
		expect(requireIntegerInRange(10, "Limit", 1, 10, "get-history")).toBe(10);
	});

	test("rejects fractions and out-of-range integers", () => {
		expect(() =>
			requireIntegerInRange(1.5, "Limit", 1, 10, "get-history")
		).toThrow();
		expect(() =>
			requireIntegerInRange(11, "Limit", 1, 10, "get-history")
		).toThrow();
	});
});
