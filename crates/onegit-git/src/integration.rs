//! Git merge/rebase primitives and reviewed continuation of existing operation state.

use super::{
    BranchIdentity, OperationState, Repository, RepositoryError, Snapshot, WriteError, WritePhase,
    check_cancelled,
};

use crate::validation::require_revision;
use crate::{Cancellation, FileStatus, GitCommand, RecordType};
use std::ffi::OsString;
use std::fs;

#[path = "integration/reviewed.rs"]
mod reviewed;

pub use reviewed::{IntegrationKind, IntegrationRequest};

/// Ordinary Git merge fast-forward policy.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum FastForward {
    /// Use Git's configured fast-forward behavior.
    #[default]
    Allow,
    /// Refuse a merge commit.
    Only,
    /// Create a merge commit even when fast-forwarding is possible.
    Prevent,
}

/// Lower-level merge options; native actions must additionally pin reviewed tips.
#[derive(Clone, Copy, Debug)]
pub struct MergeOptions<'a> {
    /// Non-option revision to merge.
    pub revision: &'a str,
    /// Git fast-forward policy.
    pub fast_forward: FastForward,
    /// Prepare a squash index/message without automatically committing it.
    pub squash: bool,
    /// Optional message, preserving Git's hooks and signing configuration.
    pub message: Option<&'a str>,
}

impl<'a> MergeOptions<'a> {
    /// Merge one revision with ordinary fast-forward behavior and no editor prompt.
    pub fn new(revision: &'a str) -> Self {
        Self {
            revision,
            fast_forward: FastForward::Allow,
            squash: false,
            message: None,
        }
    }
}

/// Lower-level rebase options; this explicitly permits Git's ordinary history rewrite.
/// Native reviewed integration applies additional published/merge-history safeguards.
#[derive(Clone, Copy, Debug)]
pub struct RebaseOptions<'a> {
    /// Upstream revision.
    pub upstream: &'a str,
    /// Optional replacement base.
    pub onto: Option<&'a str>,
    /// Optional branch to check out and rebase.
    pub branch: Option<&'a str>,
    /// Apply Git's autosquash option.
    pub autosquash: bool,
}

impl<'a> RebaseOptions<'a> {
    /// Rebase the current branch onto this upstream, without explicit onto/autosquash.
    pub fn new(upstream: &'a str) -> Self {
        Self {
            upstream,
            onto: None,
            branch: None,
            autosquash: false,
        }
    }
}

/// Explicit decision about an already reviewed operation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FinishKind {
    /// Continue with staged resolutions, preserving Git's message/hooks/signing.
    Continue,
    /// Explicitly abort the reviewed operation; the UI must obtain its own confirmation.
    Abort,
}

/// Owned review of durable operation state, rebuilt from a fresh snapshot after restart.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FinishOperation {
    /// Explicit continuation or abort decision.
    pub kind: FinishKind,
    /// Reviewed active operation; Normal is rejected.
    pub operation: OperationState,
    /// Exact reviewed HEAD/branch, including detached rebase state.
    pub expected: BranchIdentity,
    /// Exact nonempty marker fingerprint from the reviewed snapshot.
    pub token: String,
}

fn failure(phase: WritePhase, error: impl Into<RepositoryError>) -> WriteError {
    WriteError {
        phase,
        error: error.into(),
    }
}

fn invalid(message: &'static str) -> WriteError {
    failure(
        WritePhase::BeforeCommand,
        RepositoryError::InvalidInput(message),
    )
}

impl Repository {
    fn integration_preflight(&self, cancellation: Option<&Cancellation>) -> Result<(), WriteError> {
        check_cancelled(cancellation).map_err(|error| failure(WritePhase::BeforeCommand, error))?;

        self.check_write_identity()
            .map_err(|error| failure(WritePhase::BeforeCommand, error))
    }

    fn integration_command(
        &self,
        args: impl IntoIterator<Item = impl Into<OsString>>,
        stdin: Option<&[u8]>,
        cancellation: Option<&Cancellation>,
    ) -> Result<(), WriteError> {
        self.check_write_identity()
            .map_err(|error| failure(WritePhase::BeforeCommand, error))?;
        let mut command = GitCommand::new(&self.info.root, args);

        command.directory = Some(&self.root_directory);
        command.stdin = stdin.unwrap_or_default();
        command.cancellation = cancellation;
        self.process
            .run(command)
            .map_err(|error| failure(WritePhase::Command, error))?;

        Ok(())
    }

    fn integration_snapshot(
        &self,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.check_write_identity()
            .and_then(|_| self.snapshot_uncoordinated(false, cancellation))
            .map_err(|error| failure(WritePhase::Refresh, error))
    }

    /// Merge through Git without forcing a branch switch or deleting refs.
    /// Ordinary repository merge/autostash configuration remains in effect. Conflicts
    /// return Command failure and leave Git's operation state available for review.
    pub fn merge(
        &self,
        options: MergeOptions<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        let _write = self.mutations.enter();

        self.integration_preflight(cancellation)?;
        require_revision(options.revision)
            .map_err(|error| failure(WritePhase::BeforeCommand, error))?;
        let mut args = vec![OsString::from("merge"), "--no-edit".into()];

        match options.fast_forward {
            FastForward::Allow => {}
            FastForward::Only => args.push("--ff-only".into()),
            FastForward::Prevent => args.push("--no-ff".into()),
        }

        if options.squash {
            args.push("--squash".into());
        }

        if let Some(message) = options.message.filter(|message| !message.is_empty()) {
            if message.contains('\0') {
                return Err(invalid("Merge message must contain no NUL."));
            }

            args.extend(["-m".into(), message.into()]);
        }

        args.push(options.revision.into());
        self.integration_command(args, None, cancellation)?;

        self.integration_snapshot(cancellation)
    }

    /// Rebase with the source API's upstream/onto/branch/autosquash options.
    /// This is the ordinary CLI boundary, not reviewed unpublished-history consent.
    pub fn rebase(
        &self,
        options: RebaseOptions<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        let _write = self.mutations.enter();

        self.integration_preflight(cancellation)?;
        let mut args = vec![OsString::from("rebase")];

        if options.autosquash {
            args.push("--autosquash".into());
        }

        if let Some(onto) = options.onto.filter(|value| !value.is_empty()) {
            require_revision(onto).map_err(|error| failure(WritePhase::BeforeCommand, error))?;
            args.extend(["--onto".into(), onto.into()]);
        }

        require_revision(options.upstream)
            .map_err(|error| failure(WritePhase::BeforeCommand, error))?;
        args.push(options.upstream.into());

        if let Some(branch) = options.branch.filter(|value| !value.is_empty()) {
            require_revision(branch).map_err(|error| failure(WritePhase::BeforeCommand, error))?;
            args.push(branch.into());
        }

        self.integration_command(args, None, cancellation)?;

        self.integration_snapshot(cancellation)
    }

    /// Abort Git's active merge without an application review check.
    pub fn abort_merge(&self, cancellation: Option<&Cancellation>) -> Result<Snapshot, WriteError> {
        self.integration_action("merge", "--abort", cancellation)
    }

    /// Continue Git's active merge without automatically staging files.
    pub fn continue_merge(
        &self,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.integration_action("merge", "--continue", cancellation)
    }

    /// Continue Git's active rebase without automatically staging files.
    pub fn continue_rebase(
        &self,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.integration_action("rebase", "--continue", cancellation)
    }

    /// Explicitly skip the current rebase commit using ordinary Git semantics.
    pub fn skip_rebase(&self, cancellation: Option<&Cancellation>) -> Result<Snapshot, WriteError> {
        self.integration_action("rebase", "--skip", cancellation)
    }

    /// Abort Git's active rebase without an application review check.
    pub fn abort_rebase(
        &self,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.integration_action("rebase", "--abort", cancellation)
    }

    fn integration_action(
        &self,
        command: &str,
        action: &str,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        let _write = self.mutations.enter();

        self.integration_preflight(cancellation)?;
        self.integration_command([command, action], None, cancellation)?;

        self.integration_snapshot(cancellation)
    }

    /// Continue or abort only the operation whose state, HEAD and marker fingerprint
    /// still match this owned review. Never stage implicitly, replay or clean up an
    /// uncertain command result. Abort consent belongs to the application boundary.
    pub fn finish_operation(
        &self,
        request: &FinishOperation,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        let _write = self.mutations.enter();

        self.integration_preflight(cancellation)?;
        let snapshot = self
            .snapshot_uncoordinated(false, cancellation)
            .map_err(|error| failure(WritePhase::BeforeCommand, error))?;

        if request.operation == OperationState::Normal
            || snapshot.operation != request.operation
            || BranchIdentity::from_snapshot(&snapshot) != request.expected
            || request.token.is_empty()
            || snapshot.operation_token.as_ref() != Some(&request.token)
        {
            return Err(invalid(
                "The Git operation changed. Refresh and review it before trying again.",
            ));
        }

        if request.kind == FinishKind::Continue {
            if snapshot
                .status
                .files
                .iter()
                .any(|file| file.record_type == RecordType::Unmerged)
            {
                return Err(invalid(
                    "Resolve and stage all conflicted files before continuing.",
                ));
            }

            if snapshot.status.files.iter().any(|file| {
                !matches!(
                    file.record_type,
                    RecordType::Untracked | RecordType::Ignored
                ) && file.worktree_status != FileStatus::Unmodified
            }) {
                return Err(invalid(
                    "Unstaged tracked changes remain. Review and stage them outside the app before continuing.",
                ));
            }
        }

        if request.operation == OperationState::SquashMerge {
            let original = fs::read_to_string(self.info.git_directory.join("ORIG_HEAD"))
                .map_err(|error| failure(WritePhase::BeforeCommand, error))?;

            if request.expected.oid.as_deref() != Some(original.trim()) {
                return Err(invalid(
                    "The branch moved since squash merge started. Inspect History before continuing or aborting.",
                ));
            }

            if request.kind == FinishKind::Continue {
                // Git can prefer MERGE_MSG and append conflict notes when --no-edit
                // resumes a squash. Commit the reviewed persistent squash message.
                let message = fs::read(self.info.git_directory.join("SQUASH_MSG"))
                    .map_err(|error| failure(WritePhase::BeforeCommand, error))?;

                self.integration_command(["commit", "-F", "-"], Some(&message), cancellation)?;
            } else {
                self.integration_command(
                    ["reset", "--merge", original.trim()],
                    None,
                    cancellation,
                )?;
            }

            match fs::remove_file(self.info.git_directory.join("SQUASH_MSG")) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(failure(WritePhase::Refresh, error)),
            }
        } else {
            self.integration_command(
                [
                    request.operation.name(),
                    if request.kind == FinishKind::Continue {
                        "--continue"
                    } else {
                        "--abort"
                    },
                ],
                None,
                cancellation,
            )?;
        }

        self.integration_snapshot(cancellation)
    }
}
