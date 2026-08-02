import type { RepositoryOwner } from "@/feature/workspace/lib/repository-owner.js";

const GITHUB_HOST = "github.com";
const avatarDataUrls = new Map<string, string | null>();
const pendingAvatars = new Map<string, Promise<string | null>>();

const avatarKey = (host: string, name: string): string | null =>
	host.toLowerCase() === GITHUB_HOST
		? `${GITHUB_HOST}:${name.toLowerCase()}`
		: null;

export const repositoryOwnerAvatarKey = (
	owner: RepositoryOwner | null
): string | null => (owner ? avatarKey(owner.host, owner.name) : null);

export const peekRepositoryOwnerAvatar = (
	owner: RepositoryOwner | null
): string | null | undefined => {
	const key = repositoryOwnerAvatarKey(owner);
	return key ? avatarDataUrls.get(key) : null;
};

export const loadRepositoryOwnerAvatarByIdentity = async (
	host: string,
	name: string
): Promise<string | null> => {
	const key = avatarKey(host, name);
	if (!key) {
		return null;
	}
	if (avatarDataUrls.has(key)) {
		return avatarDataUrls.get(key) ?? null;
	}

	const pending = pendingAvatars.get(key);
	if (pending) {
		return await pending;
	}

	const request = window.desktop.repositoryOwners
		.avatar({
			host: host.toLowerCase(),
			name,
		})
		.then((result) => (result.status === "available" ? result.dataUrl : null))
		.catch(() => null);
	pendingAvatars.set(key, request);
	try {
		const dataUrl = await request;
		avatarDataUrls.set(key, dataUrl);
		return dataUrl;
	} finally {
		pendingAvatars.delete(key);
	}
};

export const loadRepositoryOwnerAvatar = async (
	owner: RepositoryOwner | null
): Promise<string | null> =>
	owner
		? await loadRepositoryOwnerAvatarByIdentity(owner.host, owner.name)
		: null;

export const preloadRepositoryOwnerAvatar = (
	owner: RepositoryOwner | null
): void => {
	loadRepositoryOwnerAvatar(owner).catch(() => undefined);
};
