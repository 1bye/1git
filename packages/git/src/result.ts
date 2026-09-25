import type {
	GitError,
	GitErrorCode,
	GitOperation,
	GitResult,
} from "./contracts.js";
import {
	GitCommandFailure,
	GitProcessFailure,
	type GitProcessFailureReason,
} from "./process/git-process.js";

const AUTHENTICATION_PATTERN =
	/(authentication failed|could not read username|permission denied|terminal prompts disabled|repository not found)/i;

const CONFLICT_PATTERN =
	/(conflict|needs merge|unmerged files|resolve your current index first)/i;

const DIRTY_WORKTREE_PATTERN =
	/(local changes.*would be overwritten|working tree.*not clean|unstaged changes|would be overwritten by)/i;

const INVALID_REFERENCE_PATTERN =
	/(invalid reference|not a valid object name|not a valid branch name|unknown revision|bad revision|invalid upstream)/i;

const ALREADY_EXISTS_PATTERN = /(already exists|already checked out)/i;
const NOT_A_REPOSITORY_PATTERN = /not a git repository/i;
const NOT_FOUND_PATTERN = /(not found|no such remote|no stash entries found)/i;

const REPOSITORY_LOCKED_PATTERN =
	/(index\.lock|another git process seems to be running|unable to create .*lock)/i;

const PERMISSION_PATTERN = /(permission denied|operation not permitted)/i;
const URL_CREDENTIAL_PATTERN = /(https?:\/\/[^:/\s]+:)[^@\s]+@/gi;
const MAX_ERROR_DETAIL_LENGTH = 4000;

/** Returns a successful structured result. */
export const succeed = <T>(value: T): GitResult<T> => ({ ok: true, value });

/** Returns a failed structured result. */
export const fail = <T>(error: GitError): GitResult<T> => ({
	error,
	ok: false,
});

const safeDetails = (value: string): string | undefined => {
	const sanitized = value
		.replace(URL_CREDENTIAL_PATTERN, "$1***@")
		.trim()
		.slice(0, MAX_ERROR_DETAIL_LENGTH);

	return sanitized.length > 0 ? sanitized : undefined;
};

const classifyCommandFailure = (details: string): GitErrorCode => {
	if (AUTHENTICATION_PATTERN.test(details)) {
		return "authentication-required";
	}

	if (CONFLICT_PATTERN.test(details)) {
		return "conflict";
	}

	if (DIRTY_WORKTREE_PATTERN.test(details)) {
		return "dirty-worktree";
	}

	if (INVALID_REFERENCE_PATTERN.test(details)) {
		return "invalid-reference";
	}

	if (ALREADY_EXISTS_PATTERN.test(details)) {
		return "already-exists";
	}

	if (REPOSITORY_LOCKED_PATTERN.test(details)) {
		return "repository-locked";
	}

	if (PERMISSION_PATTERN.test(details)) {
		return "permission-denied";
	}

	if (NOT_A_REPOSITORY_PATTERN.test(details)) {
		return "not-a-repository";
	}

	if (NOT_FOUND_PATTERN.test(details)) {
		return "not-found";
	}

	return "command-failed";
};

const retryableCodes = new Set<GitErrorCode>([
	"authentication-required",
	"repository-locked",
]);

const PROCESS_FAILURE_CODES: Readonly<
	Record<GitProcessFailureReason, GitErrorCode>
> = {
	aborted: "aborted",
	"git-not-found": "git-not-found",
	"output-too-large": "output-too-large",
	"spawn-failed": "command-failed",
};

/** Converts process and validation failures to the package's stable error model. */
export const toGitError = (
	operation: GitOperation,
	error: unknown
): GitError => {
	if (isGitError(error)) {
		return error;
	}

	if (error instanceof GitProcessFailure) {
		const code = PROCESS_FAILURE_CODES[error.reason];

		return {
			code,
			details: safeDetails(error.message),
			message: error.message,
			operation,
			retryable: false,
		};
	}

	if (error instanceof GitCommandFailure) {
		const details =
			safeDetails([error.stderr, error.stdout].filter(Boolean).join("\n")) ??
			"";

		const code = classifyCommandFailure(details);

		return {
			code,
			details: details || undefined,
			exitCode: error.exitCode,
			message: operationMessage(operation, code),
			operation,
			retryable: retryableCodes.has(code),
		};
	}

	const message = error instanceof Error ? error.message : String(error);

	return {
		code: "command-failed",
		details: safeDetails(message),
		message: `Git operation "${operation}" failed.`,
		operation,
		retryable: false,
	};
};

/** Creates a package error for rejected public input. */
export const invalidInput = (
	operation: GitOperation,
	message: string,
	code: GitErrorCode = "invalid-input"
): GitError => ({
	code,
	message,
	operation,
	retryable: false,
});

const isGitError = (value: unknown): value is GitError => {
	if (!value || typeof value !== "object") {
		return false;
	}

	return (
		"code" in value &&
		"message" in value &&
		"operation" in value &&
		"retryable" in value
	);
};

const operationMessage = (
	operation: GitOperation,
	code: GitErrorCode
): string => {
	if (code === "authentication-required") {
		return "Git authentication is required.";
	}

	if (code === "conflict") {
		return `Git operation "${operation}" stopped because of conflicts.`;
	}

	if (code === "dirty-worktree") {
		return `Git operation "${operation}" requires a clean working tree.`;
	}

	if (code === "invalid-reference") {
		return `Git operation "${operation}" received an invalid revision or ref.`;
	}

	if (code === "repository-locked") {
		return "The repository is locked by another Git process.";
	}

	return `Git operation "${operation}" failed.`;
};
