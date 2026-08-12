import type { RemoteInfo } from "@1git/git";

const GITHUB_HOST = "github.com";
const GIT_SUFFIX_PATTERN = /\.git$/i;
const LEADING_SLASH_PATTERN = /^\/+/;
const SCP_STYLE_REMOTE_PATTERN = /^[^@/\s]+@([^:/\s]+):(.+)$/;
const HOSTED_REMOTE_PROTOCOLS = new Set(["git:", "http:", "https:", "ssh:"]);

interface RemoteWebLocation {
	readonly host: string;
	readonly path: string;
}

const getRemoteUrl = (remote: RemoteInfo): string | null =>
	remote.fetchUrls[0] ?? remote.pushUrls[0] ?? null;

const parseRemoteWebLocation = (
	remoteUrl: string | null
): RemoteWebLocation | null => {
	if (!remoteUrl) {
		return null;
	}

	const scpStyleMatch = SCP_STYLE_REMOTE_PATTERN.exec(remoteUrl);
	if (scpStyleMatch?.[1] && scpStyleMatch[2]) {
		return {
			host: scpStyleMatch[1].toLowerCase(),
			path: scpStyleMatch[2],
		};
	}

	try {
		const parsedUrl = new URL(remoteUrl);
		if (
			!HOSTED_REMOTE_PROTOCOLS.has(parsedUrl.protocol) ||
			parsedUrl.hostname === ""
		) {
			return null;
		}
		return {
			host: parsedUrl.hostname.toLowerCase(),
			path: parsedUrl.pathname,
		};
	} catch {
		return null;
	}
};

export const getPreferredRepositoryRemote = (
	remotes: readonly RemoteInfo[],
	upstream: string | null
): RemoteInfo | null => {
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
		if (remote && getRemoteUrl(remote)) {
			return remote;
		}
	}

	return (
		remotes.find(
			(remote) => !visitedNames.has(remote.name) && getRemoteUrl(remote)
		) ?? null
	);
};

export const getPreferredRepositoryRemoteUrl = (
	remotes: readonly RemoteInfo[],
	upstream: string | null
): string | null => {
	const remote = getPreferredRepositoryRemote(remotes, upstream);
	return remote ? getRemoteUrl(remote) : null;
};

export const getRepositoryWebUrl = (
	remoteUrl: string | null
): string | null => {
	const location = parseRemoteWebLocation(remoteUrl);
	if (!location) {
		return null;
	}
	const path = location.path
		.replace(LEADING_SLASH_PATTERN, "")
		.replace(GIT_SUFFIX_PATTERN, "");
	return path ? `https://${location.host}/${path}` : null;
};

export const getGithubRepositoryUrl = (
	remoteUrl: string | null
): string | null => {
	const repositoryUrl = getRepositoryWebUrl(remoteUrl);
	if (!repositoryUrl || new URL(repositoryUrl).hostname !== GITHUB_HOST) {
		return null;
	}
	return repositoryUrl;
};

export const getGithubPullRequestUrl = (
	remoteUrl: string | null,
	baseBranch: string,
	headBranch: string
): string | null => {
	const repositoryUrl = getGithubRepositoryUrl(remoteUrl);
	if (!repositoryUrl) {
		return null;
	}
	const comparison = `${encodeURIComponent(baseBranch)}...${encodeURIComponent(headBranch)}`;
	return `${repositoryUrl}/compare/${comparison}?expand=1`;
};
