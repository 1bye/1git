import type { RepositorySnapshot } from "@1git/git";
import type { RepositorySessionId } from "../../../../../shared/repository-session.js";

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
