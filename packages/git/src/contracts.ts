/** A successful value or a structured Git failure suitable for IPC. */
export type GitResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly error: GitError; readonly ok: false };

/** Stable failures callers may branch on without parsing Git output. */
export type GitErrorCode =
	| "aborted"
	| "already-exists"
	| "authentication-required"
	| "bare-repository"
	| "command-failed"
	| "conflict"
	| "dirty-worktree"
	| "git-not-found"
	| "invalid-input"
	| "invalid-path"
	| "invalid-reference"
	| "not-a-repository"
	| "not-found"
	| "output-too-large"
	| "permission-denied"
	| "repository-locked";

/** Public operations used for progress, errors, and application telemetry. */
export type GitOperation =
	| "abort-cherry-pick"
	| "abort-merge"
	| "abort-rebase"
	| "abort-revert"
	| "add-remote"
	| "change-hunk"
	| "apply-stash"
	| "checkout-branch"
	| "cherry-pick"
	| "clone-repository"
	| "commit"
	| "continue-cherry-pick"
	| "continue-merge"
	| "continue-rebase"
	| "continue-revert"
	| "create-branch"
	| "create-tag"
	| "create-worktree"
	| "delete-branch"
	| "delete-tag"
	| "diff"
	| "discard-files"
	| "drop-stash"
	| "fetch"
	| "file-content"
	| "get-branches"
	| "get-commit"
	| "get-config"
	| "get-history"
	| "get-remotes"
	| "get-snapshot"
	| "get-stashes"
	| "get-tags"
	| "get-worktrees"
	| "initialize-repository"
	| "lock-worktree"
	| "merge"
	| "move-worktree"
	| "open-repository"
	| "pop-stash"
	| "prune-worktrees"
	| "pull"
	| "push"
	| "rebase"
	| "remove-remote"
	| "remove-worktree"
	| "rename-branch"
	| "rename-remote"
	| "repair-worktrees"
	| "reset"
	| "restore"
	| "revert"
	| "set-config"
	| "set-remote-url"
	| "set-upstream"
	| "skip-rebase"
	| "stage"
	| "stage-all"
	| "stash"
	| "unstage"
	| "unstage-all"
	| "undo-discard"
	| "unlock-worktree"
	| "unset-config";

/** Safe details about an operation failure. */
export interface GitError {
	readonly code: GitErrorCode;
	readonly details?: string;
	readonly exitCode?: number;
	readonly message: string;
	readonly operation: GitOperation;
	readonly retryable: boolean;
}

/** Shared cancellation option for long-running repository operations. */
export interface GitCallOptions {
	readonly signal?: AbortSignal;
}

/** Git executable and output limits used by a repository session. */
export interface GitRuntimeOptions {
	readonly executable?: string;
	readonly maxOutputBytes?: number;
}

/** Immutable identity and storage paths for one working repository. */
export interface RepositoryInfo {
	readonly commonDirectory: string;
	readonly gitDirectory: string;
	readonly isBare: boolean;
	readonly isShallow: boolean;
	readonly root: string;
}

/** Current HEAD and tracking relationship. */
export interface HeadState {
	readonly ahead: number;
	readonly behind: number;
	readonly branch: string | null;
	readonly detached: boolean;
	readonly oid: string | null;
	readonly unborn: boolean;
	readonly upstream: string | null;
}

/** High-level repository operation currently represented by Git metadata. */
export type RepositoryOperationState =
	| "cherry-pick"
	| "merge"
	| "normal"
	| "rebase"
	| "revert";

/** Normalized index or worktree status for a path. */
export type FileStatus =
	| "added"
	| "copied"
	| "deleted"
	| "ignored"
	| "modified"
	| "renamed"
	| "type-changed"
	| "unmerged"
	| "unmodified"
	| "untracked";

/** One path reported by porcelain status v2. */
export interface FileChange {
	readonly headOid?: string;
	readonly indexOid?: string;
	readonly indexStatus: FileStatus;
	readonly originalPath?: string;
	readonly path: string;
	readonly recordType:
		| "ignored"
		| "ordinary"
		| "renamed"
		| "unmerged"
		| "untracked";
	readonly renameScore?: number;
	readonly submodule: string;
	readonly worktreeStatus: FileStatus;
}

/** Complete state required to render repository controls and change lists. */
export interface RepositorySnapshot {
	readonly files: readonly FileChange[];
	readonly head: HeadState;
	readonly operationState: RepositoryOperationState;
	readonly repository: RepositoryInfo;
	readonly stashCount: number;
}

/** Commit author or committer identity. */
export interface GitIdentity {
	readonly email: string;
	readonly name: string;
}

/** Structured commit metadata. */
export interface CommitInfo {
	readonly author: GitIdentity;
	readonly authoredAt: string;
	readonly body: string;
	readonly committedAt: string;
	readonly committer: GitIdentity;
	readonly oid: string;
	readonly parentOids: readonly string[];
	readonly summary: string;
}

/** One page of commit history. */
export interface CommitPage {
	readonly commits: readonly CommitInfo[];
	readonly hasMore: boolean;
	readonly nextOffset: number | null;
}

/** Local or remote-tracking branch metadata. */
export interface BranchInfo {
	readonly ahead: number;
	readonly behind: number;
	readonly checkedOut: boolean;
	readonly committedAt: string | null;
	readonly fullName: string;
	readonly name: string;
	readonly oid: string;
	readonly remote: string | null;
	readonly summary: string;
	readonly type: "local" | "remote";
	readonly upstream: string | null;
	readonly worktreePath: string | null;
}

/** Local and remote-tracking branch collection. */
export interface BranchCollection {
	readonly branches: readonly BranchInfo[];
	readonly current: string | null;
}

/** Lightweight or annotated tag metadata. */
export interface TagInfo {
	readonly createdAt: string | null;
	readonly message: string;
	readonly name: string;
	readonly oid: string;
	readonly targetOid: string;
	readonly type: "annotated" | "lightweight";
}

/** Named remote and all configured fetch/push URLs. */
export interface RemoteInfo {
	readonly fetchUrls: readonly string[];
	readonly name: string;
	readonly pushUrls: readonly string[];
}

/** One stash entry. */
export interface StashInfo {
	readonly createdAt: string;
	readonly oid: string;
	readonly reference: string;
	readonly summary: string;
}

/** Registered worktree metadata. */
export interface WorktreeInfo {
	readonly branch: string | null;
	readonly detached: boolean;
	readonly headOid: string | null;
	readonly locked: boolean;
	readonly lockReason: string | null;
	readonly path: string;
	readonly prunable: boolean;
	readonly pruneReason: string | null;
}

/** Line counts for one path in a diff. Null counts identify binary content. */
export interface DiffFileStat {
	readonly addedLines: number | null;
	readonly deletedLines: number | null;
	readonly originalPath?: string;
	readonly path: string;
}

/** Patch text and structured per-file statistics. */
export interface FileDiff {
	readonly patch: string;
	readonly stats: readonly DiffFileStat[];
	readonly target: DiffTarget;
}

/** Selects the source represented by a diff request. */
export type DiffTarget =
	| { readonly kind: "commit"; readonly revision: string }
	| {
			readonly base: string;
			readonly head: string;
			readonly kind: "range";
	  }
	| { readonly kind: "staged" }
	| { readonly kind: "working" };

/** Revision content encoded safely for process and IPC boundaries. */
export interface FileContent {
	readonly content: string;
	readonly encoding: "base64" | "utf8";
	readonly path: string;
	readonly revision: string;
	readonly sizeBytes: number;
}

/** A commit and the repository state immediately after creating it. */
export interface CommitResult {
	readonly commit: CommitInfo;
	readonly snapshot: RepositorySnapshot;
}

/** Updated branch collection and current repository state. */
export interface BranchMutationResult {
	readonly branches: BranchCollection;
	readonly snapshot: RepositorySnapshot;
}

/** Result of fetch, pull, or push. */
export interface SyncResult {
	readonly branch: string | null;
	readonly operation: "fetch" | "pull" | "push";
	readonly remote: string | null;
	readonly snapshot: RepositorySnapshot;
}

export interface OpenRepositoryInput extends GitCallOptions {
	readonly path: string;
	readonly runtime?: GitRuntimeOptions;
}

export interface InitializeRepositoryInput extends GitCallOptions {
	readonly initialBranch?: string;
	readonly path: string;
	readonly runtime?: GitRuntimeOptions;
}

export interface CloneRepositoryInput extends GitCallOptions {
	readonly branch?: string;
	readonly depth?: number;
	readonly path: string;
	readonly recurseSubmodules?: boolean;
	readonly remoteUrl: string;
	readonly runtime?: GitRuntimeOptions;
}

export interface SnapshotInput extends GitCallOptions {
	readonly includeIgnored?: boolean;
}

export interface HistoryInput extends GitCallOptions {
	readonly limit?: number;
	readonly offset?: number;
	readonly paths?: readonly string[];
	readonly revision?: string;
}

export interface CommitInput extends GitCallOptions {
	readonly allowEmpty?: boolean;
	readonly amend?: boolean;
	readonly description?: string;
	readonly noVerify?: boolean;
	readonly signoff?: boolean;
	readonly summary: string;
}

export interface DiffInput extends GitCallOptions {
	readonly contextLines?: number;
	readonly paths?: readonly string[];
	readonly target: DiffTarget;
}

export interface FileContentInput extends GitCallOptions {
	readonly path: string;
	readonly revision: string;
}

export interface StageInput extends GitCallOptions {
	readonly paths: readonly string[];
}

export type HunkAction = "discard" | "stage" | "unstage";

export interface ChangeHunkInput extends GitCallOptions {
	readonly action: HunkAction;
	readonly allowDestructive?: boolean;
	readonly hunkIndex: number;
	readonly path: string;
}

/** Short-lived capability for restoring one discarded change. */
export interface DiscardUndo {
	readonly expiresAt: string;
	readonly path: string;
	readonly token: string;
}

/** Updated repository state and an optional discard undo capability. */
export interface ChangeHunkResult {
	readonly snapshot: RepositorySnapshot;
	readonly undo: DiscardUndo | null;
}

export interface DiscardFilesInput extends GitCallOptions {
	readonly allowDestructive?: boolean;
	readonly paths: readonly string[];
}

export interface DiscardFilesResult {
	readonly snapshot: RepositorySnapshot;
	readonly undo: DiscardUndo;
}

export interface UndoDiscardInput extends GitCallOptions {
	readonly token: string;
}

export interface RestoreInput extends GitCallOptions {
	readonly allowDestructive: boolean;
	readonly paths: readonly string[];
	readonly source?: string;
	readonly staged?: boolean;
	readonly worktree?: boolean;
}

export type ResetMode = "hard" | "mixed" | "soft";

export interface ResetInput extends GitCallOptions {
	readonly allowDestructive?: boolean;
	readonly mode: ResetMode;
	readonly target?: string;
}

export interface CreateBranchInput extends GitCallOptions {
	readonly checkout?: boolean;
	readonly force?: boolean;
	readonly name: string;
	readonly startPoint?: string;
}

export interface CheckoutBranchInput extends GitCallOptions {
	readonly force?: boolean;
	readonly name: string;
}

export interface RenameBranchInput extends GitCallOptions {
	readonly currentName?: string;
	readonly force?: boolean;
	readonly newName: string;
}

export interface DeleteBranchInput extends GitCallOptions {
	readonly force?: boolean;
	readonly name: string;
}

export interface SetUpstreamInput extends GitCallOptions {
	readonly branch?: string;
	readonly upstream: string;
}

export interface MergeInput extends GitCallOptions {
	readonly fastForward?: "allow" | "only" | "prevent";
	readonly message?: string;
	readonly revision: string;
	readonly squash?: boolean;
}

export interface RebaseInput extends GitCallOptions {
	readonly autosquash?: boolean;
	readonly branch?: string;
	readonly onto?: string;
	readonly upstream: string;
}

export interface RevisionSequenceInput extends GitCallOptions {
	readonly revisions: readonly string[];
}

export interface RevertInput extends RevisionSequenceInput {
	readonly noCommit?: boolean;
}

export interface CreateTagInput extends GitCallOptions {
	readonly force?: boolean;
	readonly message?: string;
	readonly name: string;
	readonly revision?: string;
}

export interface DeleteTagInput extends GitCallOptions {
	readonly name: string;
}

export interface AddRemoteInput extends GitCallOptions {
	readonly fetch?: boolean;
	readonly name: string;
	readonly url: string;
}

export interface RenameRemoteInput extends GitCallOptions {
	readonly currentName: string;
	readonly newName: string;
}

export interface SetRemoteUrlInput extends GitCallOptions {
	readonly add?: boolean;
	readonly name: string;
	readonly push?: boolean;
	readonly url: string;
}

export interface RemoveRemoteInput extends GitCallOptions {
	readonly name: string;
}

export interface FetchInput extends GitCallOptions {
	readonly prune?: boolean;
	readonly remote?: string;
	readonly tags?: boolean;
}

export interface PullInput extends GitCallOptions {
	readonly branch?: string;
	readonly remote?: string;
	readonly strategy?: "fast-forward-only" | "merge" | "rebase";
}

export interface PushInput extends GitCallOptions {
	readonly branch?: string;
	readonly forceWithLease?: boolean;
	readonly remote?: string;
	readonly setUpstream?: boolean;
	readonly tags?: boolean;
}

export interface StashInput extends GitCallOptions {
	readonly includeUntracked?: boolean;
	readonly keepIndex?: boolean;
	readonly message?: string;
	readonly paths?: readonly string[];
	readonly staged?: boolean;
}

export interface StashReferenceInput extends GitCallOptions {
	readonly reference: string;
	readonly reinstateIndex?: boolean;
}

export interface DropStashInput extends GitCallOptions {
	readonly reference: string;
}

export interface CreateWorktreeInput extends GitCallOptions {
	readonly detach?: boolean;
	readonly force?: boolean;
	readonly lockReason?: string;
	readonly newBranch?: string;
	readonly path: string;
	readonly revision?: string;
}

export interface MoveWorktreeInput extends GitCallOptions {
	readonly newPath: string;
	readonly path: string;
}

export interface RemoveWorktreeInput extends GitCallOptions {
	readonly force?: boolean;
	readonly path: string;
}

export interface LockWorktreeInput extends GitCallOptions {
	readonly path: string;
	readonly reason?: string;
}

export interface WorktreePathInput extends GitCallOptions {
	readonly path: string;
}

export interface PruneWorktreesInput extends GitCallOptions {
	readonly expire?: string;
}

export interface RepairWorktreesInput extends GitCallOptions {
	readonly paths?: readonly string[];
}

export type GitConfigScope = "local" | "worktree";

export interface GetConfigInput extends GitCallOptions {
	readonly key: string;
	readonly scope?: GitConfigScope;
}

export interface SetConfigInput extends GetConfigInput {
	readonly value: string;
}

export interface ConfigValue {
	readonly key: string;
	readonly scope: GitConfigScope;
	readonly value: string | null;
}
