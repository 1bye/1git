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

export interface GitSessionIpcRequest {
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

export interface DesktopGitApi {
	readonly branches: {
		readonly abortMerge: (
			sessionId: RepositorySessionId
		) => ReturnType<GitRepository["abortMerge"]>;
		readonly abortRebase: (
			sessionId: RepositorySessionId
		) => ReturnType<GitRepository["abortRebase"]>;
		readonly checkout: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<CheckoutBranchInput>
		) => ReturnType<GitRepository["checkoutBranch"]>;
		readonly continueRebase: (
			sessionId: RepositorySessionId
		) => ReturnType<GitRepository["continueRebase"]>;
		readonly create: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<CreateBranchInput>
		) => ReturnType<GitRepository["createBranch"]>;
		readonly delete: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<DeleteBranchInput>
		) => ReturnType<GitRepository["deleteBranch"]>;
		readonly list: (
			sessionId: RepositorySessionId
		) => ReturnType<GitRepository["getBranches"]>;
		readonly merge: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<MergeInput>
		) => ReturnType<GitRepository["merge"]>;
		readonly rebase: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<RebaseInput>
		) => ReturnType<GitRepository["rebase"]>;
		readonly rename: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<RenameBranchInput>
		) => ReturnType<GitRepository["renameBranch"]>;
		readonly setUpstream: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<SetUpstreamInput>
		) => ReturnType<GitRepository["setUpstream"]>;
		readonly skipRebase: (
			sessionId: RepositorySessionId
		) => ReturnType<GitRepository["skipRebase"]>;
	};
	readonly changes: {
		readonly commit: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<CommitInput>
		) => ReturnType<GitRepository["commit"]>;
		readonly reset: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<ResetInput>
		) => ReturnType<GitRepository["reset"]>;
		readonly restore: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<RestoreInput>
		) => ReturnType<GitRepository["restore"]>;
		readonly stage: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<StageInput>
		) => ReturnType<GitRepository["stage"]>;
		readonly stageAll: (
			sessionId: RepositorySessionId
		) => ReturnType<GitRepository["stageAll"]>;
		readonly unstage: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<StageInput>
		) => ReturnType<GitRepository["unstage"]>;
		readonly unstageAll: (
			sessionId: RepositorySessionId
		) => ReturnType<GitRepository["unstageAll"]>;
	};
	readonly config: {
		readonly get: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<GetConfigInput>
		) => ReturnType<GitRepository["getConfig"]>;
		readonly set: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<SetConfigInput>
		) => ReturnType<GitRepository["setConfig"]>;
		readonly unset: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<GetConfigInput>
		) => ReturnType<GitRepository["unsetConfig"]>;
	};
	readonly remotes: {
		readonly add: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<AddRemoteInput>
		) => ReturnType<GitRepository["addRemote"]>;
		readonly list: (
			sessionId: RepositorySessionId
		) => ReturnType<GitRepository["getRemotes"]>;
		readonly remove: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<RemoveRemoteInput>
		) => ReturnType<GitRepository["removeRemote"]>;
		readonly rename: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<RenameRemoteInput>
		) => ReturnType<GitRepository["renameRemote"]>;
		readonly setUrl: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<SetRemoteUrlInput>
		) => ReturnType<GitRepository["setRemoteUrl"]>;
	};
	readonly repository: {
		readonly diff: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<DiffInput>
		) => ReturnType<GitRepository["getDiff"]>;
		readonly fileContent: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<FileContentInput>
		) => ReturnType<GitRepository["getFileContent"]>;
		readonly getCommit: (
			sessionId: RepositorySessionId,
			revision: string
		) => ReturnType<GitRepository["getCommit"]>;
		readonly history: (
			sessionId: RepositorySessionId,
			input?: IpcGitInput<HistoryInput>
		) => ReturnType<GitRepository["getHistory"]>;
		readonly snapshot: (
			sessionId: RepositorySessionId,
			input?: IpcGitInput<SnapshotInput>
		) => ReturnType<GitRepository["getSnapshot"]>;
	};
	readonly sequences: {
		readonly abortCherryPick: (
			sessionId: RepositorySessionId
		) => ReturnType<GitRepository["abortCherryPick"]>;
		readonly abortRevert: (
			sessionId: RepositorySessionId
		) => ReturnType<GitRepository["abortRevert"]>;
		readonly cherryPick: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<RevisionSequenceInput>
		) => ReturnType<GitRepository["cherryPick"]>;
		readonly continueCherryPick: (
			sessionId: RepositorySessionId
		) => ReturnType<GitRepository["continueCherryPick"]>;
		readonly continueRevert: (
			sessionId: RepositorySessionId
		) => ReturnType<GitRepository["continueRevert"]>;
		readonly revert: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<RevertInput>
		) => ReturnType<GitRepository["revert"]>;
	};
	readonly sessions: {
		readonly activate: (
			sessionId: RepositorySessionId
		) => Promise<RepositoryManagerResult<RepositoryManagerState>>;
		readonly clone: (
			input: IpcRepositoryCreationInput<CloneRepositoryInput>
		) => Promise<GitResult<OpenedRepositorySession>>;
		readonly close: (
			sessionId: RepositorySessionId
		) => Promise<RepositoryManagerResult<RepositoryManagerState>>;
		readonly forgetRecent: (path: string) => Promise<RepositoryManagerState>;
		readonly initialize: (
			input: IpcRepositoryCreationInput<InitializeRepositoryInput>
		) => Promise<GitResult<OpenedRepositorySession>>;
		readonly open: (
			input: OpenRepositoryIpcInput
		) => Promise<GitResult<OpenedRepositorySession>>;
		readonly state: () => Promise<RepositoryManagerState>;
	};
	readonly stashes: {
		readonly apply: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<StashReferenceInput>
		) => ReturnType<GitRepository["applyStash"]>;
		readonly create: (
			sessionId: RepositorySessionId,
			input?: IpcGitInput<StashInput>
		) => ReturnType<GitRepository["stash"]>;
		readonly drop: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<DropStashInput>
		) => ReturnType<GitRepository["dropStash"]>;
		readonly list: (
			sessionId: RepositorySessionId
		) => ReturnType<GitRepository["getStashes"]>;
		readonly pop: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<StashReferenceInput>
		) => ReturnType<GitRepository["popStash"]>;
	};
	readonly sync: {
		readonly fetch: (
			sessionId: RepositorySessionId,
			input?: IpcGitInput<FetchInput>
		) => ReturnType<GitRepository["fetch"]>;
		readonly pull: (
			sessionId: RepositorySessionId,
			input?: IpcGitInput<PullInput>
		) => ReturnType<GitRepository["pull"]>;
		readonly push: (
			sessionId: RepositorySessionId,
			input?: IpcGitInput<PushInput>
		) => ReturnType<GitRepository["push"]>;
	};
	readonly tags: {
		readonly create: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<CreateTagInput>
		) => ReturnType<GitRepository["createTag"]>;
		readonly delete: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<DeleteTagInput>
		) => ReturnType<GitRepository["deleteTag"]>;
		readonly list: (
			sessionId: RepositorySessionId
		) => ReturnType<GitRepository["getTags"]>;
	};
	readonly worktrees: {
		readonly create: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<CreateWorktreeInput>
		) => ReturnType<GitRepository["createWorktree"]>;
		readonly list: (
			sessionId: RepositorySessionId
		) => ReturnType<GitRepository["getWorktrees"]>;
		readonly lock: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<LockWorktreeInput>
		) => ReturnType<GitRepository["lockWorktree"]>;
		readonly move: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<MoveWorktreeInput>
		) => ReturnType<GitRepository["moveWorktree"]>;
		readonly prune: (
			sessionId: RepositorySessionId,
			input?: IpcGitInput<PruneWorktreesInput>
		) => ReturnType<GitRepository["pruneWorktrees"]>;
		readonly remove: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<RemoveWorktreeInput>
		) => ReturnType<GitRepository["removeWorktree"]>;
		readonly repair: (
			sessionId: RepositorySessionId,
			input?: IpcGitInput<RepairWorktreesInput>
		) => ReturnType<GitRepository["repairWorktrees"]>;
		readonly unlock: (
			sessionId: RepositorySessionId,
			input: IpcGitInput<WorktreePathInput>
		) => ReturnType<GitRepository["unlockWorktree"]>;
	};
}

export interface DesktopApi {
	readonly git: DesktopGitApi;
	readonly platform: NodeJS.Platform;
}
