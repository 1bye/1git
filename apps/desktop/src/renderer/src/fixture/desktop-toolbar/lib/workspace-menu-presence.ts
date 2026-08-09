import type { RepositorySessionId } from "../../../../../shared/repository-session.js";

export const updateWorkspaceMenuSurfaceSession = (
	currentSessionId: RepositorySessionId | null,
	sessionId: RepositorySessionId,
	isPresent: boolean
): RepositorySessionId | null => {
	if (isPresent) {
		return sessionId;
	}
	return currentSessionId === sessionId ? null : currentSessionId;
};
