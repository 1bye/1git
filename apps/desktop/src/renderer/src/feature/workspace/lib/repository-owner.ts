import type { RemoteInfo } from "@1git/git";

const SCP_STYLE_REMOTE_PATTERN = /^[^@/\s]+@([^:/\s]+):(.+)$/;
const GIT_SUFFIX_PATTERN = /\.git$/i;
const HOSTED_REMOTE_PROTOCOLS = new Set(["git:", "http:", "https:", "ssh:"]);

interface RemoteLocation {
	readonly host: string;
	readonly path: string;
}

export interface RepositoryOwner {
	readonly host: string;
	readonly name: string;
	readonly namespace: string;
	readonly remoteName: string;
}

const parseRemoteLocation = (remoteUrl: string): RemoteLocation | null => {
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

const ownerFromRemote = (remote: RemoteInfo): RepositoryOwner | null => {
	const remoteUrls = [...remote.fetchUrls, ...remote.pushUrls];
	for (const remoteUrl of remoteUrls) {
		const location = parseRemoteLocation(remoteUrl);
		if (!location) {
			continue;
		}

		const pathSegments = location.path.split("/").filter(Boolean);
		const repositoryName = pathSegments.at(-1)?.replace(GIT_SUFFIX_PATTERN, "");
		const namespaceSegments = pathSegments.slice(0, -1);
		const ownerName = namespaceSegments.at(-1);
		if (!(repositoryName && ownerName)) {
			continue;
		}

		return {
			host: location.host,
			name: ownerName,
			namespace: namespaceSegments.join("/"),
			remoteName: remote.name,
		};
	}

	return null;
};

export const getRepositoryOwner = (
	remotes: readonly RemoteInfo[],
	upstream: string | null
): RepositoryOwner | null => {
	const upstreamRemoteName = upstream?.split("/", 1)[0] ?? null;
	const preferredRemoteNames = ["origin", upstreamRemoteName].filter(
		(remoteName): remoteName is string => remoteName !== null
	);
	const visitedRemoteNames = new Set<string>();

	for (const remoteName of preferredRemoteNames) {
		const remote = remotes.find((candidate) => candidate.name === remoteName);
		if (!remote || visitedRemoteNames.has(remote.name)) {
			continue;
		}
		visitedRemoteNames.add(remote.name);
		const owner = ownerFromRemote(remote);
		if (owner) {
			return owner;
		}
	}

	for (const remote of remotes) {
		if (visitedRemoteNames.has(remote.name)) {
			continue;
		}
		const owner = ownerFromRemote(remote);
		if (owner) {
			return owner;
		}
	}

	return null;
};
