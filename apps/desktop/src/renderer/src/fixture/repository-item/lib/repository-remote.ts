import type { RemoteInfo } from "@1git/git";

const GITHUB_HOST = "github.com";
const GIT_SUFFIX_PATTERN = /\.git$/i;
const LEADING_SLASH_PATTERN = /^\/+/;
const SCP_STYLE_REMOTE_PATTERN = /^[^@/\s]+@([^:/\s]+):(.+)$/;

const getRemoteUrl = (remote: RemoteInfo): string | null =>
	remote.fetchUrls[0] ?? remote.pushUrls[0] ?? null;

export const getPreferredRepositoryRemoteUrl = (
	remotes: readonly RemoteInfo[],
	upstream: string | null
): string | null => {
	const upstreamRemoteName = upstream?.split("/", 1)[0] ?? null;
	const preferredRemoteNames = ["origin", upstreamRemoteName].filter(
		(name): name is string => name !== null
	);
	const visitedNames = new Set<string>();

	for (const name of preferredRemoteNames) {
		if (visitedNames.has(name)) {
			continue;
		}
		visitedNames.add(name);
		const remote = remotes.find((candidate) => candidate.name === name);
		const url = remote ? getRemoteUrl(remote) : null;
		if (url) {
			return url;
		}
	}

	for (const remote of remotes) {
		if (visitedNames.has(remote.name)) {
			continue;
		}
		const url = getRemoteUrl(remote);
		if (url) {
			return url;
		}
	}

	return null;
};

export const getGithubRepositoryUrl = (
	remoteUrl: string | null
): string | null => {
	if (!remoteUrl) {
		return null;
	}

	const scpStyleMatch = SCP_STYLE_REMOTE_PATTERN.exec(remoteUrl);
	if (scpStyleMatch?.[1]?.toLowerCase() === GITHUB_HOST && scpStyleMatch[2]) {
		const path = scpStyleMatch[2].replace(GIT_SUFFIX_PATTERN, "");
		return `https://${GITHUB_HOST}/${path}`;
	}

	try {
		const parsedUrl = new URL(remoteUrl);
		if (parsedUrl.hostname.toLowerCase() !== GITHUB_HOST) {
			return null;
		}
		const path = parsedUrl.pathname
			.replace(LEADING_SLASH_PATTERN, "")
			.replace(GIT_SUFFIX_PATTERN, "");
		if (!path) {
			return null;
		}
		return `https://${GITHUB_HOST}/${path}`;
	} catch {
		return null;
	}
};
