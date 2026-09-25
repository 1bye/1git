import { describe, expect, test } from "bun:test";

import type { GitError, RepositoryOperationState } from "@1git/git";

import {
	getRepositoryRecovery,
	isRepositoryRecoveryActionAllowed,
	repositoryRecoveryErrorMessage,
	shouldStageFilesOnFirstPresentation,
} from "../src/renderer/src/feature/workspace/lib/repository-recovery.js";

const gitError = (code: GitError["code"]): GitError => ({
	code,
	message: "Git could not complete the operation.",
	operation: "continue-rebase",
	retryable: false,
});

describe("repository recovery", () => {
	test.each([
		["normal", null],
		["merge", ["continue", "abort"]],
		["rebase", ["continue", "skip", "abort"]],
		["cherry-pick", ["continue", "abort"]],
		["revert", ["continue", "abort"]],
	] as const)(
		"offers only valid actions for %s",
		(operationState, expectedActions) => {
			expect(getRepositoryRecovery(operationState)?.actions ?? null).toEqual(
				expectedActions
			);
		}
	);

	test("rejects actions outside the current operation", () => {
		expect(isRepositoryRecoveryActionAllowed("merge", "skip")).toBe(false);
		expect(isRepositoryRecoveryActionAllowed("normal", "continue")).toBe(false);
		expect(isRepositoryRecoveryActionAllowed("rebase", "skip")).toBe(true);
	});

	test("does not auto-stage an interrupted operation when it is restored", () => {
		expect(shouldStageFilesOnFirstPresentation("normal")).toBe(true);
		expect(shouldStageFilesOnFirstPresentation("merge")).toBe(false);
		expect(shouldStageFilesOnFirstPresentation("rebase")).toBe(false);
	});

	test.each([
		[
			"conflict",
			"Conflicts remain. Resolve them, stage the files, then continue.",
		],
		[
			"repository-locked",
			"Another Git operation is using this repository. Retry when it finishes.",
		],
	] as const)("turns %s into actionable guidance", (code, expected) => {
		expect(
			repositoryRecoveryErrorMessage(
				gitError(code),
				"rebase" satisfies RepositoryOperationState,
				"continue"
			)
		).toBe(expected);
	});
});
