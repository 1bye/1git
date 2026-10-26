//! Git CLI execution and repository rules, independent of GPUI and a JavaScript runtime.
//!
//! Execution is blocking: callers must run it on an owned background worker, retain its
//! cancellation handle and observe completion before cleaning up indexes or write locks.

mod failure;
mod output;
mod partial_patch;
mod process;
mod repository;
mod status;
mod validation;

pub use failure::{ErrorCode, Failure, Operation};
pub use partial_patch::{PartialPatch, PartialPatchError};

pub use process::{
    Cancellation, GitCommand, GitError, GitOutput, GitProcess, ToolCommand, execute_tool,
};

pub use repository::{
    Branch, BranchAction, BranchChanges, BranchCollection, BranchComparison, BranchError,
    BranchIdentity, BranchKind, BranchMutation, BranchRequest, CloneOptions, CommitError,
    CommitFile, CommitFiles, CommitInfo, CommitMode, CommitOutcome, CommitPage, CommitResult,
    ConfigScope, ConfigValue, ConflictPreview, ConflictSide, CreateBranch, CreateWorktree,
    DiffOptions, DiffStat, DiffTarget, DiscardError, DiscardFiles, DiscardRecovery, DiscardResult,
    DiscardUndo, FastForward, FileContent, FileData, FileDiff, FileSource, FinishKind,
    FinishOperation, HistoryOptions, Identity, IgnoreFile, IgnoreRule, IntegrationKind,
    IntegrationRequest, MergeOptions, OperationState, PartialCommitFile, PatchOmission,
    RebaseOptions, RecoveryBackup, Remote, Repository, RepositoryCoordinator, RepositoryError,
    RepositoryInfo, ResolveConflict, SavedBranchChanges, Snapshot, Stash, Tag, TagKind,
    UndoCommitResult, Worktree, WorktreeBranch, WorktreeMutation, WorktreeRequest, WriteError,
    WritePhase, ignore_extension, ignore_folders, ignore_pattern,
};

pub use status::{
    FileChange, FileStatus, HeadState, RecordType, Status, StatusParseError, parse_status,
};
