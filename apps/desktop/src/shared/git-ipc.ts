import type {
	AddRemoteInput,
	ChangeHunkInput,
	CheckoutBranchInput,
	CloneRepositoryInput,
	CommitInput,
	CreateBranchInput,
	CreateTagInput,
	CreateWorktreeInput,
	DeleteBranchInput,
	DeleteTagInput,
	DiffInput,
	DiscardFilesInput,
	DropStashInput,
	FetchInput,
	FileContentInput,
	GetConfigInput,
	GitOperation,
	GitRepository,
	GitResult,
	HistoryInput,
	InitializeRepositoryInput,
	LockWorktreeInput,
	MergeInput,
	MoveWorktreeInput,
	PruneWorktreesInput,
	PullInput,
	PushInput,
	RebaseInput,
	RemoveRemoteInput,
	RemoveWorktreeInput,
	RenameBranchInput,
	RenameRemoteInput,
	RepairWorktreesInput,
	ResetInput,
	RestoreInput,
	RevertInput,
	RevisionSequenceInput,
	SetConfigInput,
	SetRemoteUrlInput,
	SetUpstreamInput,
	SnapshotInput,
	StageInput,
	StashInput,
	StashReferenceInput,
	UndoDiscardInput,
	UnsetConfigInput,
	WorktreePathInput,
} from "@1git/git";

import type {
	OpenedRepositorySession,
	RecentRepositoryPreview,
	RepositoryDirectorySelection,
	RepositoryManagerResult,
	RepositoryManagerState,
	RepositorySessionId,
} from "./repository-session.js";

/** Stable channels used only by concrete Git methods. */
export const GIT_IPC_CHANNELS = {
	branches: {
		abortMerge: "git:branches:abort-merge",
		abortRebase: "git:branches:abort-rebase",
		checkout: "git:branches:checkout",
		continueMerge: "git:branches:continue-merge",
		continueRebase: "git:branches:continue-rebase",
		create: "git:branches:create",
		delete: "git:branches:delete",
		list: "git:branches:list",
		merge: "git:branches:merge",
		rebase: "git:branches:rebase",
		rename: "git:branches:rename",
		setUpstream: "git:branches:set-upstream",
		skipRebase: "git:branches:skip-rebase",
	},
	changes: {
		changeHunk: "git:changes:change-hunk",
		commit: "git:changes:commit",
		discardFiles: "git:changes:discard-files",
		reset: "git:changes:reset",
		restore: "git:changes:restore",
		stage: "git:changes:stage",
		stageAll: "git:changes:stage-all",
		undoDiscard: "git:changes:undo-discard",
		unstage: "git:changes:unstage",
		unstageAll: "git:changes:unstage-all",
	},
	config: {
		get: "git:config:get",
		set: "git:config:set",
		unset: "git:config:unset",
	},
	operations: {
		cancel: "git:operations:cancel",
	},
	remotes: {
		add: "git:remotes:add",
		list: "git:remotes:list",
		remove: "git:remotes:remove",
		rename: "git:remotes:rename",
		setUrl: "git:remotes:set-url",
	},
	repository: {
		diff: "git:repository:diff",
		fileContent: "git:repository:file-content",
		getCommit: "git:repository:get-commit",
		history: "git:repository:history",
		snapshot: "git:repository:snapshot",
	},
	sequences: {
		abortCherryPick: "git:sequences:abort-cherry-pick",
		abortRevert: "git:sequences:abort-revert",
		cherryPick: "git:sequences:cherry-pick",
		continueCherryPick: "git:sequences:continue-cherry-pick",
		continueRevert: "git:sequences:continue-revert",
		revert: "git:sequences:revert",
	},
	sessions: {
		activate: "git:sessions:activate",
		clone: "git:sessions:clone",
		close: "git:sessions:close",
		forgetRecent: "git:sessions:forget-recent",
		initialize: "git:sessions:initialize",
		open: "git:sessions:open",
		pickDirectory: "git:sessions:pick-directory",
		preview: "git:sessions:preview",
		state: "git:sessions:state",
	},
	stashes: {
		apply: "git:stashes:apply",
		create: "git:stashes:create",
		drop: "git:stashes:drop",
		list: "git:stashes:list",
		pop: "git:stashes:pop",
	},
	sync: {
		fetch: "git:sync:fetch",
		pull: "git:sync:pull",
		push: "git:sync:push",
	},
	tags: {
		create: "git:tags:create",
		delete: "git:tags:delete",
		list: "git:tags:list",
	},
	worktrees: {
		create: "git:worktrees:create",
		list: "git:worktrees:list",
		lock: "git:worktrees:lock",
		move: "git:worktrees:move",
		prune: "git:worktrees:prune",
		remove: "git:worktrees:remove",
		repair: "git:worktrees:repair",
		unlock: "git:worktrees:unlock",
	},
} as const;

/** Main-to-renderer notifications; these are not invoke channels. */
export const GIT_IPC_EVENTS = {
	repositoryRefresh: "git:event:repository-refresh",
} as const;

const REPOSITORY_MUTATION_OPERATIONS = new Map<string, GitOperation>([
	[GIT_IPC_CHANNELS.sessions.initialize, "initialize-repository"],
	[GIT_IPC_CHANNELS.sessions.clone, "clone-repository"],
	[GIT_IPC_CHANNELS.changes.changeHunk, "change-hunk"],
	[GIT_IPC_CHANNELS.changes.discardFiles, "discard-files"],
	[GIT_IPC_CHANNELS.changes.stage, "stage"],
	[GIT_IPC_CHANNELS.changes.stageAll, "stage-all"],
	[GIT_IPC_CHANNELS.changes.unstage, "unstage"],
	[GIT_IPC_CHANNELS.changes.unstageAll, "unstage-all"],
	[GIT_IPC_CHANNELS.changes.undoDiscard, "undo-discard"],
	[GIT_IPC_CHANNELS.changes.restore, "restore"],
	[GIT_IPC_CHANNELS.changes.reset, "reset"],
	[GIT_IPC_CHANNELS.changes.commit, "commit"],
	[GIT_IPC_CHANNELS.branches.create, "create-branch"],
	[GIT_IPC_CHANNELS.branches.checkout, "checkout-branch"],
	[GIT_IPC_CHANNELS.branches.rename, "rename-branch"],
	[GIT_IPC_CHANNELS.branches.delete, "delete-branch"],
	[GIT_IPC_CHANNELS.branches.setUpstream, "set-upstream"],
	[GIT_IPC_CHANNELS.branches.merge, "merge"],
	[GIT_IPC_CHANNELS.branches.abortMerge, "abort-merge"],
	[GIT_IPC_CHANNELS.branches.continueMerge, "continue-merge"],
	[GIT_IPC_CHANNELS.branches.rebase, "rebase"],
	[GIT_IPC_CHANNELS.branches.continueRebase, "continue-rebase"],
	[GIT_IPC_CHANNELS.branches.skipRebase, "skip-rebase"],
	[GIT_IPC_CHANNELS.branches.abortRebase, "abort-rebase"],
	[GIT_IPC_CHANNELS.sequences.cherryPick, "cherry-pick"],
	[GIT_IPC_CHANNELS.sequences.continueCherryPick, "continue-cherry-pick"],
	[GIT_IPC_CHANNELS.sequences.abortCherryPick, "abort-cherry-pick"],
	[GIT_IPC_CHANNELS.sequences.revert, "revert"],
	[GIT_IPC_CHANNELS.sequences.continueRevert, "continue-revert"],
	[GIT_IPC_CHANNELS.sequences.abortRevert, "abort-revert"],
	[GIT_IPC_CHANNELS.tags.create, "create-tag"],
	[GIT_IPC_CHANNELS.tags.delete, "delete-tag"],
	[GIT_IPC_CHANNELS.remotes.add, "add-remote"],
	[GIT_IPC_CHANNELS.remotes.rename, "rename-remote"],
	[GIT_IPC_CHANNELS.remotes.setUrl, "set-remote-url"],
	[GIT_IPC_CHANNELS.remotes.remove, "remove-remote"],
	[GIT_IPC_CHANNELS.sync.fetch, "fetch"],
	[GIT_IPC_CHANNELS.sync.pull, "pull"],
	[GIT_IPC_CHANNELS.sync.push, "push"],
	[GIT_IPC_CHANNELS.stashes.create, "stash"],
	[GIT_IPC_CHANNELS.stashes.apply, "apply-stash"],
	[GIT_IPC_CHANNELS.stashes.pop, "pop-stash"],
	[GIT_IPC_CHANNELS.stashes.drop, "drop-stash"],
	[GIT_IPC_CHANNELS.worktrees.create, "create-worktree"],
	[GIT_IPC_CHANNELS.worktrees.move, "move-worktree"],
	[GIT_IPC_CHANNELS.worktrees.remove, "remove-worktree"],
	[GIT_IPC_CHANNELS.worktrees.lock, "lock-worktree"],
	[GIT_IPC_CHANNELS.worktrees.unlock, "unlock-worktree"],
	[GIT_IPC_CHANNELS.worktrees.prune, "prune-worktrees"],
	[GIT_IPC_CHANNELS.worktrees.repair, "repair-worktrees"],
	[GIT_IPC_CHANNELS.config.set, "set-config"],
	[GIT_IPC_CHANNELS.config.unset, "unset-config"],
]);

const REPOSITORY_MUTATION_OPERATION_NAMES = new Set<string>(
	REPOSITORY_MUTATION_OPERATIONS.values()
);

export const repositoryMutationOperationForChannel = (
	channel: string
): GitOperation | undefined => REPOSITORY_MUTATION_OPERATIONS.get(channel);

export type IpcGitInput<TInput> = Omit<TInput, "signal">;
export type IpcRepositoryCreationInput<TInput> = Omit<
	TInput,
	"runtime" | "signal"
>;

export type GitOperationId = string;

export interface GitOperationOptions {
	readonly operationId?: GitOperationId;
}

export interface GitOperationCancellationResult {
	readonly operationId: GitOperationId;
	readonly status: "cancelled" | "not-found";
}

export type RepositoryRefreshEvent =
	| {
			readonly occurredAt: string;
			readonly operation: GitOperation;
			readonly operationId?: GitOperationId;
			readonly sessionId: RepositorySessionId;
			readonly source: "mutation";
	  }
	| {
			readonly occurredAt: string;
			readonly sessionId: RepositorySessionId;
			readonly source: "window-focus";
	  };

export type RepositoryRefreshListener = (event: RepositoryRefreshEvent) => void;

const isNonEmptyString = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0;

/** Rejects malformed event payloads before they cross into renderer code. */
export const isRepositoryRefreshEvent = (
	value: unknown
): value is RepositoryRefreshEvent => {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}

	const event = value as Readonly<Record<string, unknown>>;

	if (
		!(isNonEmptyString(event.occurredAt) && isNonEmptyString(event.sessionId))
	) {
		return false;
	}

	if (event.source === "window-focus") {
		return true;
	}

	if (
		event.source !== "mutation" ||
		!isNonEmptyString(event.operation) ||
		!REPOSITORY_MUTATION_OPERATION_NAMES.has(event.operation)
	) {
		return false;
	}

	return event.operationId === undefined || isNonEmptyString(event.operationId);
};

export interface OpenRepositoryIpcInput {
	readonly activate?: boolean;
	readonly path: string;
}

export interface DesktopGitApi {
	readonly branches: {
		readonly abortMerge: (
			sessionId: RepositorySessionId,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["abortMerge"]>;
		readonly abortRebase: (
			sessionId: RepositorySessionId,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["abortRebase"]>;
		readonly checkout: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<CheckoutBranchInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["checkoutBranch"]>;
		readonly continueMerge: (
			sessionId: RepositorySessionId,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["continueMerge"]>;
		readonly continueRebase: (
			sessionId: RepositorySessionId,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["continueRebase"]>;
		readonly create: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<CreateBranchInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["createBranch"]>;
		readonly delete: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<DeleteBranchInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["deleteBranch"]>;
		readonly list: (
			sessionId: RepositorySessionId,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["getBranches"]>;
		readonly merge: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<MergeInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["merge"]>;
		readonly rebase: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<RebaseInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["rebase"]>;
		readonly rename: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<RenameBranchInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["renameBranch"]>;
		readonly setUpstream: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<SetUpstreamInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["setUpstream"]>;
		readonly skipRebase: (
			sessionId: RepositorySessionId,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["skipRebase"]>;
	};
	readonly changes: {
		readonly changeHunk: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<ChangeHunkInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["changeHunk"]>;
		readonly commit: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<CommitInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["commit"]>;
		readonly discardFiles: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<DiscardFilesInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["discardFiles"]>;
		readonly reset: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<ResetInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["reset"]>;
		readonly restore: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<RestoreInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["restore"]>;
		readonly stage: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<StageInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["stage"]>;
		readonly stageAll: (
			sessionId: RepositorySessionId,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["stageAll"]>;
		readonly unstage: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<StageInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["unstage"]>;
		readonly unstageAll: (
			sessionId: RepositorySessionId,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["unstageAll"]>;
		readonly undoDiscard: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<UndoDiscardInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["undoDiscard"]>;
	};
	readonly config: {
		readonly get: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<GetConfigInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["getConfig"]>;
		readonly set: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<SetConfigInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["setConfig"]>;
		readonly unset: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<UnsetConfigInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["unsetConfig"]>;
	};
	readonly events: {
		readonly onRepositoryRefresh: (
			listener: RepositoryRefreshListener
		) => () => void;
	};
	readonly operations: {
		readonly cancel: (
			operationId: GitOperationId
		) => Promise<GitOperationCancellationResult>;
		readonly createId: () => GitOperationId;
	};
	readonly remotes: {
		readonly add: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<AddRemoteInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["addRemote"]>;
		readonly list: (
			sessionId: RepositorySessionId,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["getRemotes"]>;
		readonly remove: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<RemoveRemoteInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["removeRemote"]>;
		readonly rename: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<RenameRemoteInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["renameRemote"]>;
		readonly setUrl: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<SetRemoteUrlInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["setRemoteUrl"]>;
	};
	readonly repository: {
		readonly diff: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<DiffInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["getDiff"]>;
		readonly fileContent: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<FileContentInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["getFileContent"]>;
		readonly getCommit: (
			sessionId: RepositorySessionId,
			revision: string,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["getCommit"]>;
		readonly history: (
			sessionId: RepositorySessionId,
			input?: IpcGitInput<HistoryInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["getHistory"]>;
		readonly snapshot: (
			sessionId: RepositorySessionId,
			input?: IpcGitInput<SnapshotInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["getSnapshot"]>;
	};
	readonly sequences: {
		readonly abortCherryPick: (
			sessionId: RepositorySessionId,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["abortCherryPick"]>;
		readonly abortRevert: (
			sessionId: RepositorySessionId,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["abortRevert"]>;
		readonly cherryPick: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<RevisionSequenceInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["cherryPick"]>;
		readonly continueCherryPick: (
			sessionId: RepositorySessionId,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["continueCherryPick"]>;
		readonly continueRevert: (
			sessionId: RepositorySessionId,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["continueRevert"]>;
		readonly revert: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<RevertInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["revert"]>;
	};
	readonly sessions: {
		readonly activate: (
			sessionId: RepositorySessionId
		) => Promise<RepositoryManagerResult<RepositoryManagerState>>;
		readonly clone: (
			input: IpcRepositoryCreationInput<CloneRepositoryInput>,
			options?: GitOperationOptions
		) => Promise<GitResult<OpenedRepositorySession>>;
		readonly close: (
			sessionId: RepositorySessionId
		) => Promise<RepositoryManagerResult<RepositoryManagerState>>;
		readonly forgetRecent: (path: string) => Promise<RepositoryManagerState>;
		readonly initialize: (
			input: IpcRepositoryCreationInput<InitializeRepositoryInput>,
			options?: GitOperationOptions
		) => Promise<GitResult<OpenedRepositorySession>>;
		readonly open: (
			input: OpenRepositoryIpcInput,
			options?: GitOperationOptions
		) => Promise<GitResult<OpenedRepositorySession>>;
		readonly pickDirectory: () => Promise<RepositoryDirectorySelection>;
		readonly preview: (
			input: OpenRepositoryIpcInput,
			options?: GitOperationOptions
		) => Promise<GitResult<RecentRepositoryPreview>>;
		readonly state: () => Promise<RepositoryManagerState>;
	};
	readonly stashes: {
		readonly apply: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<StashReferenceInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["applyStash"]>;
		readonly create: (
			sessionId: RepositorySessionId,
			input?: IpcGitInput<StashInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["stash"]>;
		readonly drop: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<DropStashInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["dropStash"]>;
		readonly list: (
			sessionId: RepositorySessionId,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["getStashes"]>;
		readonly pop: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<StashReferenceInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["popStash"]>;
	};
	readonly sync: {
		readonly fetch: (
			sessionId: RepositorySessionId,
			input?: IpcGitInput<FetchInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["fetch"]>;
		readonly pull: (
			sessionId: RepositorySessionId,
			input?: IpcGitInput<PullInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["pull"]>;
		readonly push: (
			sessionId: RepositorySessionId,
			input?: IpcGitInput<PushInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["push"]>;
	};
	readonly tags: {
		readonly create: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<CreateTagInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["createTag"]>;
		readonly delete: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<DeleteTagInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["deleteTag"]>;
		readonly list: (
			sessionId: RepositorySessionId,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["getTags"]>;
	};
	readonly worktrees: {
		readonly create: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<CreateWorktreeInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["createWorktree"]>;
		readonly list: (
			sessionId: RepositorySessionId,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["getWorktrees"]>;
		readonly lock: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<LockWorktreeInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["lockWorktree"]>;
		readonly move: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<MoveWorktreeInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["moveWorktree"]>;
		readonly prune: (
			sessionId: RepositorySessionId,
			input?: IpcGitInput<PruneWorktreesInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["pruneWorktrees"]>;
		readonly remove: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<RemoveWorktreeInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["removeWorktree"]>;
		readonly repair: (
			sessionId: RepositorySessionId,
			input?: IpcGitInput<RepairWorktreesInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["repairWorktrees"]>;
		readonly unlock: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<WorktreePathInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["unlockWorktree"]>;
	};
}
