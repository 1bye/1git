//! Git CLI execution and repository rules, independent of GPUI and a JavaScript runtime.
//!
//! Repository-relative names use [`GitPath`] with exact Git bytes; repository roots and
//! destinations remain native filesystem paths.
//!
//! Execution is blocking: callers must run it on an owned background worker, retain its
//! cancellation handle and observe completion before cleaning up indexes or write locks.

mod authentication;
mod failure;
mod git_path;
mod output;
mod partial_patch;
mod platform;
mod process;
mod progress;
mod repository;
mod status;
mod validation;

pub use authentication::HttpAuthentication;

pub use progress::{
    CommitObserver, CommitPhase, CommitProgress, OutputObserver, OutputStream, TransferPhase,
    TransferProgress,
};

pub use failure::{ErrorCode, Failure, Operation};
pub use git_path::{GitPath, GitPathError};
pub use partial_patch::{PartialPatch, PartialPatchError};

pub use process::{
    Cancellation, GitCommand, GitError, GitOutput, GitProcess, ToolCommand, execute_tool,
};

pub use repository::{
    AddRemote, Branch, BranchAction, BranchChanges, BranchCollection, BranchComparison,
    BranchError, BranchIdentity, BranchKind, BranchMutation, BranchRequest, ChangeHunk,
    CherryPickCommit, CloneOptions, CommitError, CommitFile, CommitFiles, CommitIndex, CommitInfo,
    CommitMode, CommitOutcome, CommitPage, CommitResult, ConfigScope, ConfigValue, ConflictPreview,
    ConflictSide, CreateBranch, CreateReleaseTag, CreateTag, CreateWorktree, DiffOptions, DiffStat,
    DiffTarget, DiscardError, DiscardFiles, DiscardRecovery, DiscardResult, DiscardScope,
    DiscardUndo, FastForward, FetchOptions, FileContent, FileData, FileDiff, FileSource,
    FinishKind, FinishOperation, HistoryOptions, HistoryRange, HistoryRewritePlan,
    HistoryRewriteResult, HunkAction, HunkResult, Identity, IgnoreFile, IgnoreRule,
    IndexCommitResult, IntegrationKind, IntegrationRequest, MergeOptions, OperationState,
    PartialCommitFile, PatchOmission, PullOptions, PullStrategy, PushOptions, PushTag,
    RebaseOptions, RecoveryBackup, Remote, ReorderCommits, ReplayCommit, Repository,
    RepositoryCoordinator, RepositoryError, RepositoryInfo, ResetCommit, ResetCommitPlan,
    ResetCommitResult, ResetMode, ResetOptions, ResolveConflict, RestoreOptions, RevertOptions,
    SavedBranchChanges, SetRemoteUrl, Snapshot, SquashCommits, Stash, StashAction, StashOptions,
    StashReference, StashRequest, SyncBranch, SyncKind, SyncOperation, SyncResult, Tag, TagKind,
    TagPushResult, UndoCommitResult, Worktree, WorktreeBranch, WorktreeMutation, WorktreeRequest,
    WriteError, WritePhase, ignore_extension, ignore_folders, ignore_pattern, select_hunk_patch,
};

pub use status::{
    FileChange, FileStatus, HeadState, RecordType, Status, StatusParseError, parse_status,
};
