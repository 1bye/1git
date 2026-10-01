import type { HostingResult, RepositoryRef } from "./contracts.js";
import { repositoryPath } from "./adapter.js";
import { fail, failureResult } from "./result.js";
import { HostingProvider } from "./provider.js";
import { GitHubProvider } from "./providers/github/provider.js";
import { GitLabProvider } from "./providers/gitlab/provider.js";

/** Explicit enterprise/self-managed host mapping; unknown hosts are never guessed. */
export interface RemoteHost {
	readonly provider: HostingProvider;
	readonly webUrl?: string;
	readonly sshHost?: string;
}

/** Parsed remote identity, without userinfo, credentials, or Git side effects. */
export interface RemoteIdentity {
	readonly providerId: string;
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
			{ provider: new GitHubProvider() },
			{ provider: new GitLabProvider() },
		];

		for (const entry of configured) {
			let web: URL;

			try {
				if (!(entry.provider instanceof HostingProvider))
					fail("validation", "Provide a HostingProvider instance.");

				web = new URL(entry.webUrl ?? entry.provider.defaultWebUrl);
			} catch {
				return fail("validation", "Invalid remote host mapping.");
			}

			if (
				web.protocol !== "https:" ||
				web.username ||
				web.password ||
				web.search ||
				web.hash
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

			const decoded = path
				.replace(/\.git$/u, "")
				.split("/")
				.map((part) => {
					const decodedPart = decodeURIComponent(part);

					if (decodedPart.includes("/"))
						fail("validation", "Invalid encoded remote path segment.");

					return decodedPart;
				})
				.join("/");

			const repository = entry.provider.parseRepositoryPath(decoded);
			const encoded = repositoryPath(repository, true);

			return {
				ok: true,
				value: {
					providerId: entry.provider.id,
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
