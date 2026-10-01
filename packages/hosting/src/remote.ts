import type { HostingResult, RepositoryRef } from "./contracts.js";
import { repositoryPath } from "./adapter.js";
import { fail, failureResult } from "./result.js";
import { HostingProvider } from "./provider.js";
import { GitHubProvider } from "./providers/github/provider.js";
import { GitLabProvider } from "./providers/gitlab/provider.js";

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
	hosts: readonly HostingProvider[] = []
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

		const configured = [...hosts, new GitHubProvider(), new GitLabProvider()];

		for (const provider of configured) {
			let web: URL;

			try {
				if (!(provider instanceof HostingProvider))
					fail("validation", "Provide a HostingProvider instance.");

				web = new URL(provider.options.webUrl ?? provider.defaultWebUrl);
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
					? url.hostname !== (provider.options.sshHost ?? web.hostname)
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

			const repository = provider.parseRepositoryPath(decoded);
			const encoded = repositoryPath(repository, true);

			return {
				ok: true,
				value: {
					providerId: provider.id,
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
