//! Stable presentation failures. Raw process diagnostics remain inside the execution layer.

use std::sync::LazyLock;

use regex::{Regex, RegexSet};

use crate::output::trim;
use crate::{GitError, RepositoryError};

macro_rules! named_enum {
    ($type:ident, $doc:literal, $( $variant:ident => $name:literal ),+ $(,)?) => {
        #[doc = $doc]
        #[derive(Clone, Copy, Debug, Eq, PartialEq)]
        pub enum $type {
            $(#[doc = $name] $variant),+
        }

        impl $type {
            /// Stable name used by existing application/protocol contracts.
            pub const fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $name),+ }
            }
        }
    };
}

named_enum!(ErrorCode, "Stable failures that callers can match without parsing diagnostics.",
    Aborted => "aborted",
    AlreadyExists => "already-exists",
    AuthenticationRequired => "authentication-required",
    BareRepository => "bare-repository",
    CommandFailed => "command-failed",
    Conflict => "conflict",
    DirtyWorktree => "dirty-worktree",
    GitNotFound => "git-not-found",
    InvalidInput => "invalid-input",
    InvalidPath => "invalid-path",
    InvalidReference => "invalid-reference",
    NotARepository => "not-a-repository",
    NotFound => "not-found",
    OutputTooLarge => "output-too-large",
    PermissionDenied => "permission-denied",
    RepositoryLocked => "repository-locked",
);

named_enum!(Operation, "Operation names preserved from the existing Git API.",
    AbortCherryPick => "abort-cherry-pick", AbortMerge => "abort-merge",
    AbortRebase => "abort-rebase", AbortSquashMerge => "abort-squash-merge",
    AbortRevert => "abort-revert", AddRemote => "add-remote", ChangeHunk => "change-hunk",
    ApplyStash => "apply-stash", CheckoutBranch => "checkout-branch", CherryPick => "cherry-pick",
    CloneRepository => "clone-repository", Commit => "commit",
    ContinueCherryPick => "continue-cherry-pick", ContinueMerge => "continue-merge",
    ContinueRebase => "continue-rebase", ContinueSquashMerge => "continue-squash-merge",
    ContinueRevert => "continue-revert", CreateBranch => "create-branch", CreateTag => "create-tag",
    CreateWorktree => "create-worktree", DeleteBranch => "delete-branch", DeleteTag => "delete-tag",
    Diff => "diff", DiscardFiles => "discard-files", DropStash => "drop-stash", Fetch => "fetch",
    FileContent => "file-content", GetBranches => "get-branches", CompareBranches => "compare-branches",
    GetCommit => "get-commit", GetCommitFiles => "get-commit-files", GetConfig => "get-config",
    GetHistory => "get-history", GetHistoryCount => "get-history-count",
    GetUnpushedCommits => "get-unpushed-commits", GetRemotes => "get-remotes",
    GetSnapshot => "get-snapshot", GetStashes => "get-stashes", GetTags => "get-tags",
    GetWorktrees => "get-worktrees", InitializeRepository => "initialize-repository",
    IgnoreFiles => "ignore-files", LockWorktree => "lock-worktree", Merge => "merge",
    MoveWorktree => "move-worktree", OpenRepository => "open-repository", PopStash => "pop-stash",
    PruneWorktrees => "prune-worktrees", Pull => "pull", Push => "push", PushTag => "push-tag",
    Rebase => "rebase", SquashMerge => "squash-merge", SquashCommits => "squash-commits",
    ReorderCommits => "reorder-commits", RemoveRemote => "remove-remote",
    RemoveWorktree => "remove-worktree", RenameBranch => "rename-branch", RenameRemote => "rename-remote",
    RepairWorktrees => "repair-worktrees", Reset => "reset", Restore => "restore", Revert => "revert",
    SetConfig => "set-config", SetRemoteUrl => "set-remote-url", SetUpstream => "set-upstream",
    SkipRebase => "skip-rebase", Stage => "stage", StageAll => "stage-all", Stash => "stash",
    Unstage => "unstage", UnstageAll => "unstage-all", UndoDiscard => "undo-discard",
    UnlockWorktree => "unlock-worktree", UnsetConfig => "unset-config",
);

const MAX_DETAIL_UTF16_UNITS: usize = 4000;

static URL_PASSWORD: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(https?://[^:/\s]+:)[^@\s]+@").expect("literal credential pattern is valid")
});

// Classification order matches the old API, including authentication before filesystem permission.
static COMMAND_PATTERNS: LazyLock<RegexSet> = LazyLock::new(|| {
    RegexSet::new([
        r"(?i)(authentication failed|could not read username|permission denied|terminal prompts disabled|repository not found)",
        r"(?i)(conflict|needs merge|unmerged files|resolve your current index first)",
        r"(?i)(local changes.*would be overwritten|working tree.*not clean|unstaged changes|would be overwritten by)",
        r"(?i)(invalid reference|not a valid object name|not a valid branch name|unknown revision|bad revision|invalid upstream)",
        r"(?i)(already exists|already checked out)",
        r"(?i)(index\.lock|another git process seems to be running|unable to create .*lock)",
        r"(?i)(permission denied|operation not permitted)",
        r"(?i)not a git repository",
        r"(?i)(not found|no such remote|no stash entries found)",
    ]).expect("literal Git diagnostic patterns are valid")
});

const COMMAND_CODES: [ErrorCode; 9] = [
    ErrorCode::AuthenticationRequired,
    ErrorCode::Conflict,
    ErrorCode::DirtyWorktree,
    ErrorCode::InvalidReference,
    ErrorCode::AlreadyExists,
    ErrorCode::RepositoryLocked,
    ErrorCode::PermissionDenied,
    ErrorCode::NotARepository,
    ErrorCode::NotFound,
];

/// Safe owned failure for UI and protocol boundaries. Does not retain raw process output.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Failure {
    /// Stable failure category.
    pub code: ErrorCode,
    /// Operation whose result failed.
    pub operation: Operation,
    /// User-facing summary, free of command output.
    pub message: String,
    /// Sanitized, bounded diagnostics; absent when empty.
    pub details: Option<String>,
    /// Numeric Git exit code; absent for non-command failures or Unix signals.
    pub exit_code: Option<i32>,
    /// Whether the legacy retry contract allows authentication/lock recovery.
    pub retryable: bool,
}

impl Failure {
    /// Translate a repository failure without exposing raw output through `Debug` or `Display`.
    pub fn from_repository(operation: Operation, error: &RepositoryError) -> Self {
        match error {
            RepositoryError::Git(error) => Self::from_process(operation, error),
            RepositoryError::PathOutsideRepository => {
                Self::invalid(operation, ErrorCode::InvalidPath, &error.to_string())
            }
            RepositoryError::InvalidInput(message) => {
                Self::invalid(operation, ErrorCode::InvalidInput, message)
            }
            RepositoryError::Conflict(message) => {
                Self::invalid(operation, ErrorCode::Conflict, message)
            }
            RepositoryError::InvalidPath => {
                Self::invalid(operation, ErrorCode::InvalidInput, &error.to_string())
            }
            RepositoryError::BareRepository => {
                Self::invalid(operation, ErrorCode::BareRepository, &error.to_string())
            }
            _ => Self::new(
                operation,
                ErrorCode::CommandFailed,
                Some(error.to_string()),
                None,
            ),
        }
    }

    /// Translate a process failure; authenticated invocations must first redact at their owner.
    pub fn from_process(operation: Operation, error: &GitError) -> Self {
        match error {
            GitError::CommandFailed { status, output } => {
                let mut diagnostic = String::from_utf8_lossy(&output.stderr).into_owned();

                if !output.stdout.is_empty() {
                    if !diagnostic.is_empty() {
                        diagnostic.push('\n');
                    }

                    diagnostic.push_str(&String::from_utf8_lossy(&output.stdout));
                }

                let details = safe_details(&diagnostic);

                let code = COMMAND_PATTERNS
                    .matches(details.as_deref().unwrap_or(""))
                    .iter()
                    .next()
                    .map_or(ErrorCode::CommandFailed, |index| COMMAND_CODES[index]);

                Self::new(operation, code, details, status.code())
            }
            GitError::Cancelled => Self::process_failure(
                operation,
                ErrorCode::Aborted,
                "Git operation was aborted.".into(),
            ),
            GitError::GitNotFound(_) => {
                Self::process_failure(operation, ErrorCode::GitNotFound, error.to_string())
            }
            GitError::OutputTooLarge { limit } => Self::process_failure(
                operation,
                ErrorCode::OutputTooLarge,
                format!("Git output exceeded {limit} bytes."),
            ),
            GitError::Io(_) | GitError::TimedOut => {
                Self::process_failure(operation, ErrorCode::CommandFailed, error.to_string())
            }
        }
    }

    /// Reject input with an existing structured code and a caller-authored message.
    pub fn invalid(operation: Operation, code: ErrorCode, message: &str) -> Self {
        Self {
            code,
            operation,
            message: message.to_owned(),
            details: None,
            exit_code: None,
            retryable: false,
        }
    }

    fn process_failure(operation: Operation, code: ErrorCode, message: String) -> Self {
        let mut failure = Self::invalid(operation, code, &message);

        failure.details = safe_details(&message);

        failure
    }

    fn new(
        operation: Operation,
        code: ErrorCode,
        details: Option<String>,
        exit_code: Option<i32>,
    ) -> Self {
        let message = match code {
            ErrorCode::AuthenticationRequired => "Git authentication is required.".into(),
            ErrorCode::Conflict => format!(
                "Git operation \"{}\" stopped because of conflicts.",
                operation.as_str()
            ),
            ErrorCode::DirtyWorktree => format!(
                "Git operation \"{}\" requires a clean working tree.",
                operation.as_str()
            ),
            ErrorCode::InvalidReference => format!(
                "Git operation \"{}\" received an invalid revision or ref.",
                operation.as_str()
            ),
            ErrorCode::RepositoryLocked => {
                "The repository is locked by another Git process.".into()
            }
            _ => format!("Git operation \"{}\" failed.", operation.as_str()),
        };

        Self {
            code,
            operation,
            message,
            details: details.and_then(|text| safe_details(&text)),
            exit_code,
            retryable: matches!(
                code,
                ErrorCode::AuthenticationRequired | ErrorCode::RepositoryLocked
            ),
        }
    }
}

impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for Failure {}

fn safe_details(text: &str) -> Option<String> {
    let redacted = URL_PASSWORD.replace_all(text, "$1***@");
    let mut units = 0;

    let result: String = trim(&redacted)
        .chars()
        .take_while(|character| {
            units += character.len_utf16();

            units <= MAX_DETAIL_UTF16_UNITS
        })
        .collect();

    if result.is_empty() {
        None
    } else {
        Some(result)
    }
}
