import type {
	AddRemoteInput,
	CheckoutBranchInput,
	CloneRepositoryInput,
	CommitInput,
	CreateBranchInput,
	CreateTagInput,
	CreateWorktreeInput,
	DeleteBranchInput,
	DeleteTagInput,
	DiffInput,
	DropStashInput,
	FetchInput,
	FileContentInput,
	GetConfigInput,
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
	WorktreePathInput,
} from "@1git/git";
import type {
	OpenedRepositorySession,
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
		commit: "git:changes:commit",
		reset: "git:changes:reset",
		restore: "git:changes:restore",
		stage: "git:changes:stage",
		stageAll: "git:changes:stage-all",
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

export interface GitSessionIpcRequest {
	readonly operationId?: GitOperationId;
	readonly sessionId: RepositorySessionId;
}

export interface GitSessionInputIpcRequest<TInput>
	extends GitSessionIpcRequest {
	readonly input: TInput;
}

export interface GitSessionRevisionIpcRequest extends GitSessionIpcRequest {
	readonly revision: string;
}

export interface OpenRepositoryIpcInput {
	readonly path: string;
}

export interface GitOperationIpcRequest {
	readonly operationId: GitOperationId;
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
		readonly commit: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<CommitInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["commit"]>;
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
			input: IpcGitInput<GetConfigInput>,
			options?: GitOperationOptions
		) => ReturnType<GitRepository["unsetConfig"]>;
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

export interface DesktopApi {
	readonly git: DesktopGitApi;
	readonly platform: NodeJS.Platform;
}
