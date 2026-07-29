import { isAbsolute, normalize, sep } from "node:path";
import type { GitOperation } from "./contracts.js";
import { invalidInput } from "./result.js";

const CONFIG_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)+$/;
const NUL_PATTERN = /\0/;

/** Throws a structured error when a public string is empty or contains NUL. */
export const requireText = (
	value: string,
	label: string,
	operation: GitOperation
): string => {
	if (value.length === 0 || NUL_PATTERN.test(value)) {
		throw invalidInput(
			operation,
			`${label} must be non-empty and contain no NUL.`
		);
	}
	return value;
};

/** Validates a Git revision before it is placed before an option terminator. */
export const requireRevision = (
	value: string,
	label: string,
	operation: GitOperation
): string => {
	requireText(value, label, operation);
	if (value.startsWith("-")) {
		throw invalidInput(operation, `${label} must not begin with "-".`);
	}
	return value;
};

/** Validates repository-relative path inputs and preserves their exact spelling. */
export const requireRepositoryPaths = (
	paths: readonly string[],
	operation: GitOperation
): readonly string[] => {
	if (paths.length === 0) {
		throw invalidInput(operation, "At least one repository path is required.");
	}
	const uniquePaths = new Set<string>();
	for (const path of paths) {
		requireText(path, "Repository path", operation);
		const normalized = normalize(path);
		const segments = normalized.split(sep);
		if (isAbsolute(path) || normalized === ".." || segments.includes("..")) {
			throw invalidInput(
				operation,
				`Repository path "${path}" must stay within the repository.`,
				"invalid-path"
			);
		}
		uniquePaths.add(path);
	}
	return [...uniquePaths];
};

/** Validates a local configuration key. */
export const requireConfigKey = (
	key: string,
	operation: GitOperation
): string => {
	requireText(key, "Configuration key", operation);
	if (!CONFIG_KEY_PATTERN.test(key)) {
		throw invalidInput(
			operation,
			`"${key}" is not a valid Git configuration key.`
		);
	}
	return key;
};

/** Validates positive bounded integer input. */
export const requireIntegerInRange = (
	value: number,
	label: string,
	minimum: number,
	maximum: number,
	operation: GitOperation
): number => {
	if (!Number.isInteger(value) || value < minimum || value > maximum) {
		throw invalidInput(
			operation,
			`${label} must be an integer from ${minimum} to ${maximum}.`
		);
	}
	return value;
};
