import type { GitError, RepositoryInfo, RepositorySnapshot } from "@1git/git";

/** Opaque identifier for a repository object owned by the main process. */
export type RepositorySessionId = string;

/** Serializable identity for one open repository session. */
export interface RepositorySessionRecord {
	readonly id: RepositorySessionId;
	readonly lastActivatedAt: string;
	readonly openedAt: string;
	readonly repository: RepositoryInfo;
}

/** Serializable result returned when a repository session is opened. */
export interface OpenedRepositorySession {
	readonly session: RepositorySessionRecord;
	readonly snapshot: RepositorySnapshot;
}

/** One repository retained after it was opened or closed. */
export interface RecentRepositoryRecord {
	readonly lastOpenedAt: string;
	readonly path: string;
}

/** Result of the main-process native repository directory picker. */
export type RepositoryDirectorySelection =
	| { readonly status: "cancelled" }
	| { readonly path: string; readonly status: "selected" };

/** Complete serializable state owned by the repository manager. */
export interface RepositoryManagerState {
	readonly activeSessionId: RepositorySessionId | null;
	readonly recentRepositories: readonly RecentRepositoryRecord[];
	readonly sessions: readonly RepositorySessionRecord[];
}

export type RepositoryManagerError =
	| {
			readonly code: "git-error";
			readonly gitError: GitError;
			readonly message: string;
	  }
	| {
			readonly code: "session-not-found";
			readonly message: string;
			readonly sessionId: RepositorySessionId;
	  };

/** Structured manager result that can cross Electron IPC safely. */
export type RepositoryManagerResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly error: RepositoryManagerError; readonly ok: false };
