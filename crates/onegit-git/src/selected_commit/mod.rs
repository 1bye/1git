//! Owned selected/staged commits and reviewed unpublished-tip recovery.

use super::{BranchIdentity, RepositoryError, Snapshot, WritePhase};
use crate::{ErrorCode, Failure, Operation};
use std::path::PathBuf;

mod review;
mod transaction;
mod undo;

/// Which contents the commit request includes.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum CommitMode {
    /// Current contents of the selected working files/lines.
    #[default]
    Files,
    /// The complete existing Git index, independently of checkbox paths.
    Staged,
}

/// One exact reviewed Changes patch and its selected old/new line coordinates.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PartialCommitFile {
    /// Exact repository-relative spelling of the selected file.
    pub path: PathBuf,
    /// Unfiltered HEAD-to-current patch, rechecked before applying and committing.
    pub expected_patch: String,
    /// Stable coordinates supplied by [`crate::PartialPatch`].
    pub included_lines: Vec<String>,
}

/// Frozen commit intent. Checkbox changes themselves never modify Git staging.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommitFiles {
    /// Selected literal paths; staged mode ignores this array.
    pub paths: Vec<PathBuf>,
    /// Original summary/body; execution applies the Source's whitespace policy.
    pub message: String,
    /// Displayed HEAD/branch, including unborn and detached states.
    pub expected: BranchIdentity,
    /// Working selection or existing index.
    pub mode: CommitMode,
    /// Explicit permission to include complete current contents of partially staged files.
    pub include_partial_staging: bool,
    /// Selected-line requests belonging to the selected paths.
    pub partial_files: Vec<PartialCommitFile>,
    /// Replace only the reviewed unpublished, non-merge branch tip.
    /// Empty paths amend its message without including other staged work.
    pub amend: bool,
}

impl CommitFiles {
    /// Freeze ordinary whole-file intent from an already displayed snapshot.
    /// This constructor performs no I/O; execution still rechecks the review.
    pub fn new(paths: Vec<PathBuf>, message: String, snapshot: &Snapshot) -> Self {
        Self {
            paths,
            message,
            expected: BranchIdentity::from_snapshot(snapshot),
            mode: CommitMode::Files,
            include_partial_staging: false,
            partial_files: Vec::new(),
            amend: false,
        }
    }
}

/// A confirmed write is distinct from an unconfirmed process outcome.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CommitOutcome {
    /// Git acknowledged creating/replacing the commit.
    Committed,
    /// Git failed but HEAD changed, or its result could not be inspected.
    /// Do not automatically recommit; inspect History and retained recovery data.
    Unknown,
}

impl CommitOutcome {
    /// Existing protocol spelling.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Committed => "committed",
            Self::Unknown => "unknown",
        }
    }
}

/// Completed transaction, including a successful write whose refresh/index install failed.
#[derive(Debug)]
pub struct CommitResult {
    /// Confirmed or uncertain Git command outcome.
    pub outcome: CommitOutcome,
    /// Last observed tip; absence is not proof that no write occurred.
    pub oid: Option<String>,
    /// Fresh state when readable; never substitute the old snapshot on failure.
    pub snapshot: Option<Snapshot>,
    /// Source-compatible recovery/review instructions. A warning must not trigger a retry.
    pub warning: Option<String>,
}

/// Acknowledged last-commit undo; the original commit remains reachable in a recovery ref.
/// Working files and the real index are never rewritten by this operation.
#[derive(Debug)]
pub struct UndoCommitResult {
    /// Fresh state, including an unborn named branch when its first commit was undone.
    /// Missing/externally changed state is accompanied by a review warning.
    pub snapshot: Option<Snapshot>,
    /// Original full commit message, ready to restore only into an empty draft.
    pub message: String,
    /// Durable `refs/1git/undo/…` ref created in the same transaction as the branch move.
    pub recovery_ref: String,
    /// An acknowledged undo needing refresh/review; never automatically retry it.
    pub warning: Option<String>,
}

/// Commit/recovery validation or command failure with its original typed cause.
/// Confirmed/uncertain commit creation returns [`CommitResult`]; acknowledged undo
/// returns [`UndoCommitResult`], including warnings when its refresh fails.
#[derive(Debug)]
pub struct CommitError {
    /// Last requested mutation boundary reached.
    pub phase: WritePhase,
    /// Bounded legacy failure for presentation/protocol consumers.
    pub failure: Failure,
    cause: Option<Box<RepositoryError>>,
}

impl CommitError {
    fn invalid(code: ErrorCode, message: &str) -> Self {
        Self {
            phase: WritePhase::BeforeCommand,
            failure: Failure::invalid(Operation::Commit, code, message),
            cause: None,
        }
    }

    fn repository(phase: WritePhase, error: RepositoryError) -> Self {
        Self {
            phase,
            failure: Failure::from_repository(Operation::Commit, &error),
            cause: Some(Box::new(error)),
        }
    }
}

impl std::fmt::Display for CommitError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.failure.fmt(formatter)
    }
}

impl std::error::Error for CommitError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.cause.as_deref().map(|error| error as _)
    }
}
