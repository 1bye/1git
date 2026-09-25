import type { RepositorySnapshot } from "@1git/git";

import type {
	RepositorySessionId,
	RepositorySessionRecord,
} from "../../../../../shared/repository-session.js";

export interface SessionSnapshotState {
	readonly sessionId: RepositorySessionId;
	readonly snapshot: RepositorySnapshot;
}

export function snapshotForSession(
	state: SessionSnapshotState | null,
	sessionId: RepositorySessionId | null
): RepositorySnapshot | null {
	return state?.sessionId === sessionId ? state.snapshot : null;
}

export function sessionForSnapshot(
	state: SessionSnapshotState | null,
	sessions: readonly RepositorySessionRecord[]
): RepositorySessionRecord | null {
	if (!state) {
		return null;
	}
	return sessions.find((session) => session.id === state.sessionId) ?? null;
}

export function presentedSession(
	managerActiveSession: RepositorySessionRecord | null,
	snapshotSession: RepositorySessionRecord | null,
	isWorkspaceTransitionPending: boolean
): RepositorySessionRecord | null {
	if (isWorkspaceTransitionPending && snapshotSession) {
		return snapshotSession;
	}
	return managerActiveSession;
}
