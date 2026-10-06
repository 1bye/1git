import type { GitHttpAuthentication, GitOperation } from "./contracts.js";
import { invalidInput } from "./result.js";

/** Reject stale or ambiguous destinations before exposing a credential to a Git process. */
export function validateHttpAuthentication(
	authentication: GitHttpAuthentication,
	urls: readonly string[],
	operation: GitOperation
): void {
	let url: URL;

	try {
		url = new URL(authentication.url);
	} catch {
		throw invalidInput(
			operation,
			"Account authentication requires a valid HTTPS remote."
		);
	}

	const { username, password } = authentication;

	if (
		urls.length !== 1 ||
		urls[0] !== authentication.url ||
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		!username ||
		username.length > 2048 ||
		username.includes(":") ||
		!password ||
		password.length > 4096 ||
		/[\p{C}\s]/u.test(username + password)
	)
		throw invalidInput(
			operation,
			"The HTTPS destination changed or is ambiguous. Review the remote and account before retrying."
		);
}
