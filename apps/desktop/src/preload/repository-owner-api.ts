import type { RepositoryOwnerApi } from "../shared/repository-owner-avatar.js";
import { REPOSITORY_OWNER_IPC_CHANNELS } from "../shared/repository-owner-avatar.js";
import type { DesktopIpcInvoke } from "./git-api.js";

export const createRepositoryOwnerApi = (
	invoke: DesktopIpcInvoke
): RepositoryOwnerApi => ({
	avatar: async (request) =>
		await invoke(REPOSITORY_OWNER_IPC_CHANNELS.avatar, request),
});
