import type {
	BranchCollection,
	ChangeHunkInput,
	CommitInfo,
	CommitPage,
	DiscardUndo,
	FileChange,
	FileDiff,
	RepositorySnapshot,
	ResetMode,
	StashInfo,
} from "@1git/git";
import type { RepositoryOwner } from "@/feature/workspace/lib/repository-owner.js";
import type { RepositoryRecoveryAction } from "@/feature/workspace/lib/repository-recovery.js";
import type { BranchSwitchResult } from "@/feature/workspace/lib/repository-stash.js";
import type {
	RepositorySyncAction,
	RepositorySyncActionKind,
} from "@/feature/workspace/lib/repository-sync.js";
import type {
	RepositoryManagerState,
	RepositorySessionId,
	RepositorySessionRecord,
} from "../../../../../shared/repository-session.js";

export type RepositoryTab = "changes" | "history" | "stashes";

export interface OpenRepositoryOptions {
	readonly activate?: boolean;
}

export type PendingWorkspaceAction =
	| "branch"
	| "commit"
	| "discard"
	| "fetch"
	| "history"
	| "hunk"
	| "merge"
	| "open"
	| "publish"
	| "pull"
	| "push"
	| "refresh"
	| "recovery"
	| "stage"
	| "stash"
	| "sync"
	| "workspace"
	| null;

export interface WorkspaceTabState {
	readonly branch: string | null;
	readonly changedFiles: number | null;
	readonly owner: RepositoryOwner | null;
	readonly pendingSyncAction: RepositorySyncActionKind | null;
	readonly session: RepositorySessionRecord;
}

export interface WorkspaceDiscardUndo extends DiscardUndo {
	readonly detail: string;
	readonly message: string;
	readonly sessionId: RepositorySessionId;
}

export interface GitWorkspace {
	readonly activateWorkspace: (sessionId: RepositorySessionId) => Promise<void>;
	readonly activeSession: RepositorySessionRecord | null;
	readonly amendCommit: (
		commit: CommitInfo,
		summary: string,
		description: string
	) => Promise<boolean>;
	readonly applyStash: (stash: StashInfo) => Promise<boolean>;
	readonly branches: BranchCollection | null;
	readonly cancelSync: () => Promise<void>;
	readonly canRetrySync: boolean;
	readonly changeHunk: (input: ChangeHunkInput) => Promise<boolean>;
	readonly cherryPickCommit: (
		commit: CommitInfo,
		branchName: string
	) => Promise<boolean>;
	readonly clearError: () => void;
	readonly cloneRepository: (remoteUrl: string) => Promise<boolean>;
	readonly closeWorkspace: (sessionId: RepositorySessionId) => Promise<void>;
	readonly commit: (summary: string, description: string) => Promise<boolean>;
	readonly createBranch: (
		name: string,
		startPoint?: string
	) => Promise<boolean>;
	readonly createRepository: () => Promise<boolean>;
	readonly deleteBranch: (name: string) => Promise<boolean>;
	readonly diffs: readonly FileDiff[];
	readonly discardFiles: (files: readonly FileChange[]) => Promise<boolean>;
	readonly discardUndo: WorkspaceDiscardUndo | null;
	readonly dismissDiscardUndo: (token: string) => void;
	readonly dropStash: (stash: StashInfo) => Promise<boolean>;
	readonly error: string | null;
	readonly forgetRecentRepository: (path: string) => Promise<void>;
	readonly history: CommitPage | null;
	readonly isInitialLoading: boolean;
	readonly manager: RepositoryManagerState;
	readonly mergeBranch: (name: string) => Promise<boolean>;
	readonly openRecentRepository: (
		path: string,
		options?: OpenRepositoryOptions
	) => Promise<void>;
	readonly openRepositoryInEditor: () => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
	readonly pickRepository: () => Promise<void>;
	readonly popStash: (stash: StashInfo) => Promise<boolean>;
	readonly recoverRepository: (
		action: RepositoryRecoveryAction
	) => Promise<boolean>;
	readonly renameBranch: (newName: string) => Promise<boolean>;
	readonly reorderWorkspace: (
		activeSessionId: RepositorySessionId,
		overSessionId: RepositorySessionId
	) => void;
	readonly resetToCommit: (
		commit: CommitInfo,
		mode: ResetMode
	) => Promise<boolean>;
	readonly revertCommit: (commit: CommitInfo) => Promise<boolean>;
	readonly selectCommit: (commit: CommitInfo) => Promise<void>;
	readonly selectedCommitOid: string | null;
	readonly selectedFilePath: string | null;
	readonly selectedStashOid: string | null;
	readonly selectFile: (file: FileChange) => Promise<void>;
	readonly selectRevisionFile: (path: string) => Promise<void>;
	readonly selectStash: (stash: StashInfo) => Promise<void>;
	readonly setBranchUpstream: (upstream: string) => Promise<boolean>;
	readonly setFileStaged: (
		file: FileChange,
		shouldStage: boolean
	) => Promise<boolean>;
	readonly setFilesStaged: (
		files: readonly FileChange[],
		shouldStage: boolean
	) => Promise<boolean>;
	readonly setTab: (tab: RepositoryTab) => Promise<void>;
	readonly snapshot: RepositorySnapshot | null;
	readonly stashAndSwitchBranch: (name: string) => Promise<boolean>;
	readonly stashChanges: () => Promise<boolean>;
	readonly stashes: readonly StashInfo[];
	readonly switchBranch: (name: string) => Promise<BranchSwitchResult>;
	readonly syncAction: RepositorySyncAction | null;
	readonly syncRepository: () => Promise<void>;
	readonly tab: RepositoryTab;
	readonly toggleAllFiles: () => Promise<void>;
	readonly undoDiscard: () => Promise<boolean>;
	readonly workspaces: readonly WorkspaceTabState[];
}
