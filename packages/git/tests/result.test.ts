import { describe, expect, test } from "bun:test";

import {
	GitCommandFailure,
	GitProcessFailure,
} from "../src/process/git-process.js";
import { invalidInput, toGitError } from "../src/result.js";

describe("toGitError", () => {
	test("maps missing executables", () => {
		const error = toGitError(
			"open-repository",
			new GitProcessFailure("git-not-found", "Git was not found.")
		);

		expect(error).toMatchObject({
			code: "git-not-found",
			operation: "open-repository",
			retryable: false,
		});
	});

	test("maps preempted operations", () => {
		expect(
			toGitError(
				"fetch",
				new GitProcessFailure("aborted", "Git operation was aborted.")
			).code
		).toBe("aborted");
	});

	test("maps oversized output", () => {
		expect(
			toGitError(
				"diff",
				new GitProcessFailure("output-too-large", "Output exceeded limit.")
			).code
		).toBe("output-too-large");
	});

	test("classifies authentication failures and redacts URL credentials", () => {
		const error = toGitError(
			"fetch",
			new GitCommandFailure(
				128,
				"Authentication failed for 'https://user:secret@example.com/repo.git'"
			)
		);

		expect(error.code).toBe("authentication-required");
		expect(error.retryable).toBe(true);
		expect(error.details).toContain("user:***@example.com");
		expect(error.details).not.toContain("secret");
	});

	test("classifies conflicts", () => {
		expect(
			toGitError(
				"merge",
				new GitCommandFailure(1, "CONFLICT (content): Merge conflict")
			).code
		).toBe("conflict");
	});

	test("classifies dirty worktrees", () => {
		expect(
			toGitError(
				"checkout-branch",
				new GitCommandFailure(
					1,
					"Your local changes to the following files would be overwritten"
				)
			).code
		).toBe("dirty-worktree");
	});

	test("classifies invalid revisions", () => {
		expect(
			toGitError(
				"get-commit",
				new GitCommandFailure(128, "fatal: bad revision 'missing'")
			).code
		).toBe("invalid-reference");
	});

	test("classifies lock contention as retryable", () => {
		const error = toGitError(
			"stage",
			new GitCommandFailure(128, "fatal: Unable to create '.git/index.lock'")
		);

		expect(error.code).toBe("repository-locked");
		expect(error.retryable).toBe(true);
	});

	test("preserves already structured package errors", () => {
		const original = invalidInput("stage", "Paths are required.");

		expect(toGitError("commit", original)).toBe(original);
	});

	test("normalizes unknown failures", () => {
		const error = toGitError("push", new Error("unexpected"));

		expect(error).toMatchObject({
			code: "command-failed",
			details: "unexpected",
			operation: "push",
		});
	});
});
