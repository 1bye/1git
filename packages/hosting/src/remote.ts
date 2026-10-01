import type {
	HostingProvider,
	HostingResult,
	RepositoryRef,
} from "./contracts.js";
import { repositoryPath } from "./adapter.js";
import { fail, failureResult } from "./result.js";

/** Explicit enterprise/self-managed host mapping; unknown hosts are never guessed. */
export interface RemoteHost {
	readonly provider: HostingProvider;
	readonly webUrl: string;
	readonly sshHost?: string;
}

/** Parsed remote identity, without userinfo, credentials, or Git side effects. */
export interface RemoteIdentity {
	readonly provider: HostingProvider;
	readonly host: string;
	readonly repository: RepositoryRef;
	readonly browserUrl: string;
}

/** Parse supported HTTPS, ssh://, or git@host:path remotes. Credential-bearing URLs are rejected. */
export function parseRemote(
	remote: string,
	hosts: readonly RemoteHost[] = []
): HostingResult<RemoteIdentity> {
	try {
		if (
			typeof remote !== "string" ||
			remote.length > 8192 ||
			/[\s?#]/u.test(remote)
		)
			fail("validation", "Invalid Git remote.");

		const scp = /^git@([^:/]+):(.+)$/u.exec(remote);
		let url: URL;

		try {
			url = new URL(scp ? `ssh://git@${scp[1]}/${scp[2]}` : remote);
		} catch {
			return fail("validation", "Invalid Git remote.");
		}

		const ssh = url.protocol === "ssh:";

		if (
			(!ssh && url.protocol !== "https:") ||
			url.password ||
			(ssh ? url.username !== "git" : !!url.username) ||
			url.search ||
			url.hash
		)
			fail("validation", "Use a credential-free HTTPS or git SSH remote.");

		const configured = [
			...hosts,
			{ provider: "github" as const, webUrl: "https://github.com" },
			{ provider: "gitlab" as const, webUrl: "https://gitlab.com" },
		];

		for (const entry of configured) {
			let web: URL;

			try {
				web = new URL(entry.webUrl);
			} catch {
				return fail("validation", "Invalid remote host mapping.");
			}

			if (
				web.protocol !== "https:" ||
				web.username ||
				web.password ||
				web.search ||
				web.hash ||
				!["github", "gitlab"].includes(entry.provider)
			)
				fail("validation", "Invalid remote host mapping.");

			if (
				ssh
					? url.hostname !== (entry.sshHost ?? web.hostname)
					: url.origin !== web.origin
			)
				continue;

			const prefix = web.pathname.endsWith("/")
				? web.pathname
				: `${web.pathname}/`;

			const path = ssh
				? url.pathname.slice(1)
				: url.pathname.startsWith(prefix)
					? url.pathname.slice(prefix.length)
					: "";

			const parts = path
				.replace(/\.git$/u, "")
				.split("/")
				.map((part) => decodeURIComponent(part));

			const name = parts.pop();

			if (!name || !parts.length)
				fail("validation", "Remote does not identify a repository.");

			const repository = { owner: parts.join("/"), name };
			const encoded = repositoryPath(repository, entry.provider === "gitlab");

			return {
				ok: true,
				value: {
					provider: entry.provider,
					host: web.host,
					repository,
					browserUrl: `${web.origin}${prefix}${encoded}`,
				},
			};
		}

		return fail(
			"unsupported",
			"Unknown hosting provider; configure its host explicitly."
		);
	} catch (error) {
		if (error instanceof URIError)
			return {
				ok: false,
				error: {
					code: "validation",
					operation: "parse-remote",
					message: "Invalid remote path encoding.",
					retryable: false,
				},
			};

		return failureResult("parse-remote", error);
	}
}
