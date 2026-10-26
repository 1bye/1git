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
	| "abort-squash-merge"
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
	| "continue-squash-merge"
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
	| "compare-branches"
	| "get-commit"
	| "get-commit-files"
	| "get-config"
	| "get-history"
	| "get-history-count"
	| "get-unpushed-commits"
	| "get-remotes"
	| "get-snapshot"
	| "get-stashes"
	| "get-tags"
	| "get-worktrees"
	| "initialize-repository"
	| "ignore-files"
	| "lock-worktree"
	| "merge"
	| "move-worktree"
	| "open-repository"
	| "pop-stash"
	| "prune-worktrees"
	| "pull"
	| "push"
	| "push-tag"
	| "rebase"
	| "squash-merge"
	| "squash-commits"
	| "reorder-commits"
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
	| "squash-merge"
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
	/** Fingerprint of active merge/rebase/revert metadata, used to reject stale operation actions. */
	readonly operationToken?: string;
	readonly repository: RepositoryInfo;
	readonly stashCount: number;
}

/** Commit author or committer identity. */
export interface GitIdentity {
	readonly email: string;
	readonly name: string;
}

/** A committed path compared with the commit's first parent (empty tree for roots). */
export interface CommitFileChange {
	readonly path: string;
	readonly originalPath?: string;
	readonly status: "A" | "D" | "M" | "R" | "C" | "T";
	readonly beforeOid: string;
	readonly afterOid: string;
}

/** Immutable, incoming changes since the branches' common ancestor. */
export interface BranchComparison {
	readonly base: string;
	readonly head: string;
	readonly mergeBase: string;
	readonly files: readonly CommitFileChange[];
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
	/** Present only in single-file history; uses the path and blob IDs at this commit, including renames. */
	readonly historyFile?: CommitFileChange;
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
	/** Exact configured destination; do not infer it by splitting the upstream display label. */
	readonly upstreamRemote?: string | null;
	readonly upstreamRef?: string | null;
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
	readonly defaultBranch: string | null;
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
	readonly patchOmittedReason?: "too-large";
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
			readonly mergeBase?: boolean;
	  }
	/** Complete HEAD-to-working-file changes, including additions on an unborn branch. */
	| { readonly kind: "changes" }
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

/** Guarded single-branch sync for an explicit UI action; never forces or auto-stashes. */
export interface SyncBranchInput extends GitCallOptions {
	readonly onProgress?: (progress: GitTransferProgress) => void;
	readonly httpAuthentication?: GitHttpAuthentication;
	readonly kind: "pull" | "push" | "publish";
	readonly expectedHead: string;
	readonly expectedBranch: string;
	readonly remote: string;
	readonly remoteRef: string;
}

/** Transient HTTPS credentials scoped to one freshly checked remote destination. Never persisted. */
export interface GitHttpAuthentication {
	readonly url: string;
	readonly username: string;
	readonly password: string;
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
	/** One-shot HTTPS authentication. Never saved in the remote URL/config or reused by the returned session. */
	readonly httpAuthentication?: {
		readonly username: string;
		readonly password: string;
	};
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
	/** Anchored tips for a multi-branch graph; mutually exclusive with revision and filePath. */
	readonly revisions?: readonly string[];
	/** Keeps every child before its parents, including commits with skewed clocks. */
	readonly topoOrder?: boolean;
	/** Literal single-file history following renames along the first-parent line. Mutually exclusive with paths. */
	readonly filePath?: string;
}

export interface CommitInput extends GitCallOptions {
	readonly allowEmpty?: boolean;
	readonly amend?: boolean;
	readonly description?: string;
	readonly noVerify?: boolean;
	readonly signoff?: boolean;
	readonly summary: string;
}

/** Commit lifecycle and incremental output from Git and its hooks. Output is not persisted. */
export interface GitCommitProgress {
	readonly phase: "preparing" | "committing" | "refreshing";
	readonly output?: string;
}

/** Commits selected contents, preserving excluded files' index entries. */
export interface CommitFilesInput extends GitCallOptions {
	readonly onProgress?: (progress: GitCommitProgress) => void;
	/** Replace only the reviewed unpublished, non-merge tip. Empty paths amend its message without including staged work. */
	readonly amend?: boolean;
	/** Authoritative unfiltered Changes patch and selected old/new line coordinates. */
	readonly partialFiles?: readonly PartialFileSelection[];
	/** Explicitly include all current edits in selected partially staged files. Defaults to rejecting those selections. */
	readonly includePartialStaging?: boolean;
	/** Staged mode commits the current index and ignores checkbox paths. */
	readonly mode?: "files" | "staged";
	readonly paths: readonly string[];
	readonly message: string;
	readonly expectedHead: string | null;
	readonly expectedBranch: string | null;
}

export interface PartialFileSelection {
	readonly path: string;
	readonly expectedPatch: string;
	readonly includedLines: readonly string[];
}

/** A confirmed write is distinct from a failed refresh or an indeterminate Git process outcome. */
export interface CommitFilesResult {
	readonly outcome: "committed" | "unknown";
	readonly oid: string | null;
	readonly snapshot: RepositorySnapshot | null;
	readonly warning: string | null;
}

/** Captured named branch tip for local recovery; each action validates its publication and history rules. */
export interface CommitRecoveryInput extends GitCallOptions {
	readonly expectedHead: string;
	readonly expectedBranch: string;
}

/** Exact ancestor to retain on the reviewed branch; only unpublished later history may be undone. */
export interface ResetCommitInput extends CommitRecoveryInput {
	readonly target: string;
}

/** Read-only reset review, excluding the target itself from the number of undone commits. */
export interface ResetCommitPlan {
	readonly target: CommitInfo;
	readonly commitCount: number;
}

/** A soft reset retains the index and working files, and saves the old tip for recovery. */
export interface ResetCommitResult {
	readonly recoveryRef: string;
	readonly snapshot: RepositorySnapshot | null;
	readonly warning: string | null;
}

/** Exact consecutive commits, newest first, reviewed against one named branch tip. */
export interface SquashCommitsInput extends CommitRecoveryInput {
	readonly commits: readonly string[];
	readonly message: string;
}

/** Original consecutive range is newest first; desired replay order is oldest first. */
export interface ReorderCommitsInput extends CommitRecoveryInput {
	readonly commits: readonly string[];
	readonly order: readonly string[];
}

/** Local-only review includes later commits whose IDs must also change. */
export interface HistoryRewritePlan {
	readonly commits: readonly CommitInfo[];
	readonly replay: readonly CommitInfo[];
}

export type SquashPlan = HistoryRewritePlan;
export type ReorderPlan = HistoryRewritePlan;

/** Originals remain reachable through a private recovery ref; refresh failures do not undo a completed rewrite. */
export interface HistoryRewriteResult {
	readonly oid: string;
	readonly recoveryRef: string;
	readonly snapshot: RepositorySnapshot | null;
	readonly warning: string | null;
}

export type SquashCommitsResult = HistoryRewriteResult;
export type ReorderCommitsResult = HistoryRewriteResult;

/** Undo never edits the index or working files; a durable ref retains the original commit. */
export interface UndoCommitResult {
	readonly snapshot: RepositorySnapshot | null;
	readonly message: string;
	readonly recoveryRef: string;
	readonly warning: string | null;
}

export interface DiffInput extends GitCallOptions {
	readonly contextLines?: number;
	readonly ignoreWhitespace?: boolean;
	readonly paths?: readonly string[];
	readonly target: DiffTarget;
}

export type FileContentSource =
	| { readonly kind: "object"; readonly objectId: string }
	| { readonly kind: "revision"; readonly revision: string }
	| { readonly kind: "working" };

export interface FileContentInput extends GitCallOptions {
	readonly path: string;
	readonly revision?: string;
	readonly source?: FileContentSource;
}

export interface StageInput extends GitCallOptions {
	readonly paths: readonly string[];
}

/** Explicitly stage a reviewed regular UTF-8 conflict resolution, never continue or commit an operation. */
export interface ResolveConflictInput extends GitCallOptions {
	/** Omit to stage manual edits; choosing a side replaces the whole file after UI confirmation. */
	readonly side?: "ours" | "theirs";
	/** When choosing a displayed indexed version, reject a changed stage before replacing the working file. */
	readonly expectedSideOid?: string;
	readonly path: string;
	readonly expectedHead: string | null;
	readonly expectedBranch: string | null;
	readonly expectedContentHash: string;
}

/** Reviewed operation identity; abort requires a separate explicit user confirmation at the UI boundary. */
export interface FinishOperationInput extends GitCallOptions {
	readonly kind: "continue" | "abort";
	readonly expectedOperation:
		| "merge"
		| "rebase"
		| "revert"
		| "cherry-pick"
		| "squash-merge";
	readonly expectedHead: string | null;
	readonly expectedBranch: string | null;
	readonly expectedToken: string;
}

export type HunkAction = "discard" | "stage" | "unstage";

export interface ChangeHunkInput extends GitCallOptions {
	/** Reject stale previews instead of applying a different hunk at the same index. */
	readonly expectedPatch?: string;
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
	/** Optional app guard and private recovery directory. Patches stream to disk before any change. */
	readonly recovery?: {
		readonly directory: string;
		readonly expectedHead: string | null;
		readonly expectedBranch: string | null;
	};
}

/** Scope selected from a changed file; folder paths must be its ancestors. */
export type IgnoreRule =
	| { readonly kind: "file" }
	| { readonly kind: "folder"; readonly path: string }
	| { readonly kind: "extension" };

/** Adds a root .gitignore rule without changing the index or tracked files. */
export interface IgnoreFileInput extends GitCallOptions {
	readonly path: string;
	readonly rule: IgnoreRule;
	readonly expectedHead: string | null;
	readonly expectedBranch: string | null;
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
	/** Explicitly configure upstream tracking, independent of branch.autoSetupMerge. */
	readonly track?: boolean;
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

/** Integrates one exact branch tip into the reviewed clean branch; rebase refuses known published commits and merge histories. */
export interface BranchIntegrationInput extends GitCallOptions {
	readonly kind: "rebase" | "squash-merge";
	readonly branch: string;
	readonly expectedTarget: string;
	readonly expectedHead: string;
	readonly expectedBranch: string;
	/** Required for squash merge; continuation retains this message and Git hooks/signing. */
	readonly message?: string;
}

export interface RevisionSequenceInput extends GitCallOptions {
	readonly revisions: readonly string[];
}

export interface RevertInput extends RevisionSequenceInput {
	readonly noCommit?: boolean;
}

/** Reverses one exact historical commit on the reviewed, clean branch without rewriting history. */
export interface RevertCommitInput extends GitCallOptions {
	readonly commit: string;
	readonly expectedHead: string;
	readonly expectedBranch: string;
}

/** Copies one historical commit onto a reviewed local branch, switching only from a clean source. */
export interface CherryPickCommitInput extends GitCallOptions {
	readonly commit: string;
	readonly expectedHead: string;
	readonly expectedBranch: string;
	readonly targetBranch: string;
	readonly expectedTarget: string;
}

export interface CreateTagInput extends GitCallOptions {
	readonly force?: boolean;
	readonly message?: string;
	readonly name: string;
	readonly revision?: string;
}

/** Annotated release tag at an exact reviewed historical commit, without changing the index or publishing. */
export interface CreateReleaseTagInput extends GitCallOptions {
	readonly name: string;
	readonly message: string;
	readonly commit: string;
	readonly expectedHead: string;
	readonly expectedBranch: string | null;
}

/** Publishes one exact tag object to one reviewed destination; never pushes branches or other tags. */
export interface PushTagInput extends GitCallOptions {
	readonly name: string;
	readonly expectedOid: string;
	readonly expectedTarget: string;
	readonly remote: string;
	readonly expectedUrl: string;
	readonly expectedHead: string;
	readonly expectedBranch: string | null;
	readonly httpAuthentication?: GitHttpAuthentication;
}

/** Explicit tag push outcome; successful transport does not create a provider release. */
export interface TagPushResult {
	readonly name: string;
	readonly oid: string;
	readonly remote: string;
	readonly snapshot: RepositorySnapshot;
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
	readonly onProgress?: (progress: GitTransferProgress) => void;
	readonly httpAuthentication?: GitHttpAuthentication;
	readonly prune?: boolean;
	readonly remote?: string;
	readonly tags?: boolean;
}

/** Phase-local Git progress, never raw process output or a per-commit completion count. */
export interface GitTransferProgress {
	readonly phase:
		| "connecting"
		| "counting"
		| "compressing"
		| "sending"
		| "receiving"
		| "resolving"
		| "confirming"
		| "refreshing";
	readonly percent: number | null;
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
	/** Track the start revision when creating a new branch. */
	readonly track?: boolean;
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
export type GitConfigReadScope = GitConfigScope | "effective";

export interface GetConfigInput extends GitCallOptions {
	readonly key: string;
	readonly scope?: GitConfigReadScope;
}

export interface SetConfigInput extends GitCallOptions {
	readonly key: string;
	readonly scope?: GitConfigScope;
	readonly value: string;
}

export interface UnsetConfigInput extends GitCallOptions {
	readonly key: string;
	readonly scope?: GitConfigScope;
}

export interface ConfigValue {
	readonly key: string;
	readonly scope: GitConfigReadScope;
	readonly value: string | null;
}
