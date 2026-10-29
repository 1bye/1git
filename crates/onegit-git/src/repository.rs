//! Owns the identity and read operations of one local working tree.

use std::ffi::OsString;
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use sha2::{Digest, Sha256};

use crate::{
    Cancellation, GitCommand, GitError, GitOutput, GitProcess, Status, StatusParseError,
    parse_status,
};

#[path = "refs.rs"]
mod refs;

#[path = "history.rs"]
mod history;

#[path = "content.rs"]
mod content;

#[path = "diff.rs"]
mod diff;

#[path = "setup.rs"]
mod setup;

#[path = "history_rewrite.rs"]
mod history_rewrite;

pub use history_rewrite::{
    HistoryRange, HistoryRewritePlan, HistoryRewriteResult, ReorderCommits, ResetCommit,
    ResetCommitPlan, ResetCommitResult, SquashCommits,
};

#[path = "network.rs"]
mod network;

pub use network::{
    CreateReleaseTag, FetchOptions, PullOptions, PullStrategy, PushOptions, PushTag, SyncBranch,
    SyncKind, SyncOperation, SyncResult, TagPushResult,
};

#[path = "sequences.rs"]
mod sequences;

pub use sequences::{
    CherryPickCommit, CommitIndex, IndexCommitResult, ReplayCommit, RevertOptions,
};

#[path = "metadata_writes.rs"]
mod metadata_writes;

pub use metadata_writes::{
    AddRemote, CreateTag, ResetMode, ResetOptions, RestoreOptions, SetRemoteUrl, StashOptions,
    StashReference,
};

#[path = "mutations.rs"]
mod mutations;

#[path = "branch_mutations.rs"]
mod branch_mutations;

#[path = "worktree_mutations.rs"]
mod worktree_mutations;

#[path = "integration.rs"]
mod integration;

#[path = "conflicts.rs"]
mod conflicts;

#[path = "ignore.rs"]
mod ignore;

#[path = "discard/mod.rs"]
mod discard;

pub use discard::{ChangeHunk, HunkAction, HunkResult, select_hunk_patch};

#[path = "selected_commit/mod.rs"]
mod selected_commit;

pub use selected_commit::{
    CommitError, CommitFiles, CommitMode, CommitOutcome, CommitResult, PartialCommitFile,
    UndoCommitResult,
};

pub use discard::{
    DiscardError, DiscardFiles, DiscardRecovery, DiscardResult, DiscardUndo, RecoveryBackup,
};

pub use ignore::{IgnoreFile, IgnoreRule, ignore_extension, ignore_folders, ignore_pattern};

pub use conflicts::{ConflictPreview, ConflictSide, ResolveConflict};

pub use integration::{
    FastForward, FinishKind, FinishOperation, IntegrationKind, IntegrationRequest, MergeOptions,
    RebaseOptions,
};

pub use worktree_mutations::{CreateWorktree, WorktreeBranch, WorktreeMutation, WorktreeRequest};

pub use branch_mutations::{
    BranchAction, BranchChanges, BranchError, BranchIdentity, BranchMutation, BranchRequest,
    CreateBranch, SavedBranchChanges,
};

pub use mutations::{RepositoryCoordinator, WriteError, WritePhase};

pub use setup::CloneOptions;

pub use diff::{DiffOptions, DiffStat, DiffTarget, FileDiff, PatchOmission};

pub use content::{FileContent, FileData, FileSource};

pub use history::{BranchComparison, CommitFile, CommitInfo, CommitPage, HistoryOptions, Identity};

pub use refs::{
    Branch, BranchCollection, BranchKind, ConfigScope, ConfigValue, Remote, Stash, Tag, TagKind,
    Worktree,
};

/// Canonical local working-tree identity, distinct from shared repository metadata.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RepositoryInfo {
    /// Canonical working-tree root, even when opened through a file or symlink.
    pub root: PathBuf,
    /// Metadata for this working tree; may be inside the shared repository.
    pub git_directory: PathBuf,
    /// Shared metadata used to coordinate related worktrees.
    pub common_directory: PathBuf,
    /// Whether Git reports an incomplete shallow history.
    pub is_shallow: bool,
}

/// High-level operation represented by this working tree's Git metadata.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OperationState {
    /// No in-progress operation marker.
    Normal,
    /// Rebase, taking precedence over other operation markers.
    Rebase,
    /// Merge with MERGE_HEAD.
    Merge,
    /// Cherry-pick with CHERRY_PICK_HEAD.
    CherryPick,
    /// Revert with REVERT_HEAD.
    Revert,
    /// Squash merge with SQUASH_MSG.
    SquashMerge,
}

impl OperationState {
    fn name(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Rebase => "rebase",
            Self::Merge => "merge",
            Self::CherryPick => "cherry-pick",
            Self::Revert => "revert",
            Self::SquashMerge => "squash-merge",
        }
    }
}

/// Read-only owned state, invalidated by subsequent repository/filesystem changes.
#[derive(Clone, Debug)]
pub struct Snapshot {
    /// Repository and worktree identity captured by the session.
    pub repository: RepositoryInfo,
    /// Porcelain file and HEAD state.
    pub status: Status,
    /// In-progress operation inferred from Git's per-worktree markers.
    pub operation: OperationState,
    /// Compatible SHA-256 marker token; absent for normal state.
    pub operation_token: Option<String>,
}

/// Read/open failures, kept separate from presentation and public operation error codes.
#[derive(Debug)]
pub enum RepositoryError {
    /// Invalid path at the public boundary.
    InvalidPath,
    /// Absolute or escaping repository-relative path.
    PathOutsideRepository,
    /// A preview source is not a regular file or a Git blob.
    NotAFile,
    /// Rejected operation-specific input.
    InvalidInput(&'static str),
    /// Reviewed state or requested action conflicts with the current repository.
    Conflict(String),
    /// A clean-worktree workflow found local changes; no automatic stash/discard is permitted.
    DirtyWorktree,
    /// An existing Git index lock belongs to another operation.
    RepositoryLocked,
    /// Bare repositories have no usable working tree.
    BareRepository,
    /// Git did not return the expected single path or boolean.
    InvalidOutput,
    /// Git execution failed, including cancellation.
    Git(GitError),
    /// Metadata/path filesystem access failed.
    Io(io::Error),
    /// Status output was incomplete or malformed; never a clean-state result.
    Status(StatusParseError),
}

impl std::fmt::Display for RepositoryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidPath => {
                f.write_str("Repository path must be non-empty and contain no NUL")
            }
            Self::BareRepository => f.write_str("Bare repositories do not have a working tree"),
            Self::InvalidInput(message) => f.write_str(message),
            Self::Conflict(message) => f.write_str(message),
            Self::DirtyWorktree => f.write_str(
                "Commit or stash your changes before pulling. Nothing has been changed.",
            ),
            Self::RepositoryLocked => f.write_str("Another Git process has locked the index."),
            Self::NotAFile => f.write_str("The requested preview source is not a file"),
            Self::PathOutsideRepository => {
                f.write_str("Repository path must stay within the repository")
            }
            Self::InvalidOutput => f.write_str("Git returned malformed repository metadata"),
            Self::Git(error) => error.fmt(f),
            Self::Io(error) => write!(f, "Repository filesystem access failed: {error}"),
            Self::Status(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for RepositoryError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Git(error) => Some(error),
            Self::Io(error) => Some(error),
            Self::Status(error) => Some(error),
            _ => None,
        }
    }
}

impl From<io::Error> for RepositoryError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<GitError> for RepositoryError {
    fn from(error: GitError) -> Self {
        Self::Git(error)
    }
}

/// A local repository session, owning its identity and Git execution configuration.
/// Standalone sessions serialize their own writes. Use [`RepositoryCoordinator`] to
/// share FIFO write coordination across reopened aliases and related worktrees.
/// Public queries wait for prior queued writes; this does not exclude external Git
/// or make a multi-command read transactional against subsequent writes.
/// All methods block and belong on an owned background worker.
pub struct Repository {
    info: RepositoryInfo,
    process: GitProcess,
    root_directory: File,
    mutations: Arc<mutations::MutationQueue>,
    pending_discard: Mutex<Option<discard::PendingDiscard>>,
}

impl Repository {
    fn run(
        &self,
        args: impl IntoIterator<Item = impl Into<OsString>>,
        cancellation: Option<&Cancellation>,
    ) -> Result<GitOutput, RepositoryError> {
        let mut command = GitCommand::new(&self.info.root, args);

        command.directory = Some(&self.root_directory);
        command.cancellation = cancellation;

        Ok(self.process.run(command)?)
    }

    /// Open the repository containing an existing directory or file.
    ///
    /// Symlinks resolve to canonical identity. Bare/non-repository/missing paths
    /// return errors; opening never initializes, checks out, fetches or writes config.
    pub fn open(
        path: &Path,
        process: GitProcess,
        cancellation: Option<&Cancellation>,
    ) -> Result<Self, RepositoryError> {
        if path.as_os_str().is_empty()
            || crate::platform::path_to_git_bytes(path.as_os_str())
                .map_err(|_| RepositoryError::InvalidPath)?
                .contains(&0)
        {
            return Err(RepositoryError::InvalidPath);
        }

        check_cancelled(cancellation)?;

        let metadata = fs::metadata(path)?;

        let directory = if metadata.is_dir() {
            path
        } else {
            path.parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .unwrap_or(Path::new("."))
        };

        let cwd = fs::canonicalize(directory)?;

        if read_bool(&process, &cwd, "--is-bare-repository", cancellation)? {
            return Err(RepositoryError::BareRepository);
        }

        let root = read_path(&process, &cwd, "--show-toplevel", cancellation)?;

        let info = RepositoryInfo {
            git_directory: read_path(&process, &root, "--git-dir", cancellation)?,
            common_directory: read_path(&process, &root, "--git-common-dir", cancellation)?,
            is_shallow: read_bool(&process, &root, "--is-shallow-repository", cancellation)?,
            root,
        };

        let root_directory = crate::platform::open_directory_no_follow(&info.root)?;

        Ok(Self {
            info,
            process,
            root_directory,
            mutations: Arc::default(),
            pending_discard: Mutex::default(),
        })
    }

    /// Identity retained for this session. Related worktrees share `common_directory`.
    pub fn info(&self) -> &RepositoryInfo {
        &self.info
    }

    /// Read fresh status without Git's optional index refresh writes.
    /// Cancellation applies to Git and the streamed operation-token read.
    pub fn snapshot(
        &self,
        include_ignored: bool,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, RepositoryError> {
        self.mutations.wait_for_pending();

        self.snapshot_uncoordinated(include_ignored, cancellation)
    }

    fn snapshot_uncoordinated(
        &self,
        include_ignored: bool,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, RepositoryError> {
        let mut command = GitCommand::new(
            &self.info.root,
            [
                "--no-optional-locks",
                "status",
                "--porcelain=v2",
                "--branch",
                "--show-stash",
                "--untracked-files=all",
                "-z",
            ],
        );

        if include_ignored {
            command.args.push("--ignored=matching".into());
        }

        command.cancellation = cancellation;
        command.directory = Some(&self.root_directory);

        let output = self.process.run(command)?;
        let status = parse_status(&output.stdout).map_err(RepositoryError::Status)?;
        let operation = operation_state(&self.info.git_directory)?;
        let operation_token = operation_token(&self.info.git_directory, operation, cancellation)?;

        Ok(Snapshot {
            repository: self.info.clone(),
            status,
            operation,
            operation_token,
        })
    }
}

fn read_bool(
    process: &GitProcess,
    cwd: &Path,
    flag: &str,
    cancellation: Option<&Cancellation>,
) -> Result<bool, RepositoryError> {
    let mut command = GitCommand::new(cwd, ["rev-parse", flag]);

    command.cancellation = cancellation;

    match process.run(command)?.stdout.as_slice() {
        b"true\n" => Ok(true),
        b"false\n" => Ok(false),
        _ => Err(RepositoryError::InvalidOutput),
    }
}

fn read_path(
    process: &GitProcess,
    cwd: &Path,
    flag: &str,
    cancellation: Option<&Cancellation>,
) -> Result<PathBuf, RepositoryError> {
    let mut command = GitCommand::new(cwd, ["rev-parse", "--path-format=absolute", flag]);

    command.cancellation = cancellation;

    let output = process.run(command)?;

    let bytes = output
        .stdout
        .strip_suffix(b"\n")
        .ok_or(RepositoryError::InvalidOutput)?;

    let path = crate::platform::absolute_path_from_git_bytes(bytes)
        .map_err(|_| RepositoryError::InvalidOutput)?;

    if !path.is_absolute() || bytes.contains(&0) {
        return Err(RepositoryError::InvalidOutput);
    }

    Ok(fs::canonicalize(path)?)
}

fn operation_state(directory: &Path) -> io::Result<OperationState> {
    for (marker, state) in [
        ("rebase-merge", OperationState::Rebase),
        ("rebase-apply", OperationState::Rebase),
        ("MERGE_HEAD", OperationState::Merge),
        ("CHERRY_PICK_HEAD", OperationState::CherryPick),
        ("REVERT_HEAD", OperationState::Revert),
        ("SQUASH_MSG", OperationState::SquashMerge),
    ] {
        if directory.join(marker).try_exists()? {
            return Ok(state);
        }
    }

    Ok(OperationState::Normal)
}

fn operation_token(
    directory: &Path,
    operation: OperationState,
    cancellation: Option<&Cancellation>,
) -> Result<Option<String>, RepositoryError> {
    check_cancelled(cancellation)?;

    if operation == OperationState::Normal {
        return Ok(None);
    }

    let files: Vec<String> = match operation {
        OperationState::Merge => ["MERGE_HEAD", "ORIG_HEAD"].map(str::to_owned).into(),
        OperationState::SquashMerge => ["SQUASH_MSG", "ORIG_HEAD"].map(str::to_owned).into(),
        OperationState::CherryPick | OperationState::Revert => vec![
            if operation == OperationState::CherryPick {
                "CHERRY_PICK_HEAD"
            } else {
                "REVERT_HEAD"
            }
            .into(),
            "sequencer/head".into(),
            "sequencer/todo".into(),
            "sequencer/opts".into(),
        ],
        OperationState::Rebase => ["rebase-merge", "rebase-apply"]
            .into_iter()
            .flat_map(|folder| {
                [
                    "head-name",
                    "orig-head",
                    "onto",
                    "stopped-sha",
                    "msgnum",
                    "next",
                    "last",
                ]
                .map(|name| format!("{folder}/{name}"))
            })
            .collect(),
        OperationState::Normal => unreachable!("normal state returned above"),
    };

    let mut hash = Sha256::new();

    hash.update(operation.name());

    for name in files {
        check_cancelled(cancellation)?;

        let mut file = match File::open(directory.join(&name)) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };

        hash.update(name.as_bytes());

        let mut buffer = [0; 8192];

        loop {
            check_cancelled(cancellation)?;

            let read = file.read(&mut buffer)?;

            if read == 0 {
                break;
            }

            hash.update(&buffer[..read]);
        }
    }

    Ok(Some(format!("{:x}", hash.finalize())))
}

fn check_cancelled(cancellation: Option<&Cancellation>) -> Result<(), GitError> {
    if cancellation.is_some_and(Cancellation::is_cancelled) {
        return Err(GitError::Cancelled);
    }

    Ok(())
}

#[cfg(test)]
#[path = "repository_tests.rs"]
mod tests;
