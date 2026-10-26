//! Disk-backed discard and short-lived undo. The repository session owns its latest
//! undo token; private recovery files outlive the session, expiry and all failures.

use crate::GitPath;
mod patches;
mod recovery;

use std::collections::HashSet;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use super::{BranchIdentity, Repository, RepositoryError, Snapshot, WritePhase, check_cancelled};
use crate::{Cancellation, FileChange, FileStatus, OperationState, RecordType};
use recovery::{Recovery, iso_time, validate_paths, wall_time};

const UNDO_TTL: Duration = Duration::from_secs(15);

/// Optional reviewed app guard and durable private recovery destination.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DiscardRecovery {
    /// New directory beneath an existing parent; never reused or overwritten.
    pub directory: PathBuf,
    /// HEAD/branch displayed when the discard confirmation was accepted.
    pub expected: BranchIdentity,
}

/// Explicit lower-level discard request. App callers supply `recovery` and wait
/// for native confirmation before dispatching this owned request to a worker.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DiscardFiles {
    /// Exact selected paths, with duplicate entries permitted.
    pub paths: Vec<GitPath>,
    /// Mandatory explicit permission for the destructive steps.
    pub allow_destructive: bool,
    /// Reviewed app preflight. None uses a private persistent OS-temporary backup.
    pub recovery: Option<DiscardRecovery>,
}

/// Retained recovery location. A partial backup may contain useful patch bytes,
/// but its instructions/manifest have not all been written and durably synced.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecoveryBackup {
    /// Private recovery folder; never automatically removed by this API.
    pub directory: PathBuf,
    /// Both patches and compatible metadata/instructions have completed syncing.
    pub complete: bool,
}

/// One-use session undo token, expiring fifteen seconds after successful discard.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DiscardUndo {
    /// Compatible UUIDv4, independent of the recovery directory name.
    pub token: String,
    /// First selected file in snapshot order.
    pub path: GitPath,
    /// UTC ISO-8601 milliseconds, matching the existing wire representation.
    pub expires_at: String,
}

/// Fresh state and the latest undo token after all discard steps succeeded.
#[derive(Debug)]
pub struct DiscardResult {
    /// Confirmed post-write repository state.
    pub snapshot: Snapshot,
    /// Session-owned, one-use short-lived undo capability.
    pub undo: DiscardUndo,
    /// Durable files also support manual recovery after restart or expiry.
    pub recovery: RecoveryBackup,
}

/// Original discard/undo failure, optional compensation failure and retained backup.
/// Never infer rollback from this result: inspect actual state and recovery files.
#[derive(Debug)]
pub struct DiscardError {
    /// Last repository mutation boundary reached; backup preparation is BeforeCommand.
    pub phase: WritePhase,
    /// Original failure, even when a later compensating apply also fails.
    pub error: RepositoryError,
    /// Present only when retained regular patch files contain nonempty bytes.
    pub recovery: Option<RecoveryBackup>,
    /// First failure of a source-compatible compensating apply, if attempted.
    pub rollback_error: Option<Box<RepositoryError>>,
}

impl std::fmt::Display for DiscardError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.error.fmt(f)
    }
}

impl std::error::Error for DiscardError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.error)
    }
}

pub(super) struct PendingDiscard {
    deadline: SystemTime,
    undo: DiscardUndo,
    backup: Recovery,
}

impl Repository {
    /// Discard selected staged and working changes after complete disk-backed capture.
    ///
    /// App requests require exact reviewed HEAD/branch, normal operation state and
    /// every selected path still supported: no conflicts, renames, submodules or type
    /// changes. Parent links and non-regular leaves are refused; leaf symlinks are
    /// captured/restored as links, never traversed. Lower-level requests without a
    /// review still reject conflicts and unsafe filesystem paths.
    ///
    /// Both binary patches stream to private files before any destructive step.
    /// Capture never changes the real index or writes untracked blobs: intent-to-add
    /// preparation uses a disposable index. Backups, manifest and instructions are
    /// synced before apply. No backup is automatically deleted, including on error.
    ///
    /// The session/common-directory FIFO guard spans preparation through refresh.
    /// Calls block and belong on an owned, joined worker. Source-compatible planned
    /// compensation is attempted if a later staged apply fails; failures preserve
    /// their original cause and any compensation error. Cancellation also applies
    /// to compensation. No command is blindly retried and no clean state is assumed.
    /// External writers are not excluded; repeated checks are not a transaction.
    pub fn discard_files(
        &self,
        request: &DiscardFiles,
        cancellation: Option<&Cancellation>,
    ) -> Result<DiscardResult, DiscardError> {
        let _write = self.mutations.enter();
        let before_error = |error| failure(WritePhase::BeforeCommand, error, None, None);

        check_cancelled(cancellation).map_err(|error| before_error(error.into()))?;

        if !request.allow_destructive {
            return Err(before_error(RepositoryError::InvalidInput(
                "Discarding file changes requires allowDestructive: true.",
            )));
        }

        let (before, selected) = self
            .discard_selection(request, cancellation)
            .map_err(before_error)?;

        let mut backup =
            self.capture_discard(&before, &selected, request.recovery.as_ref(), cancellation)?;

        let info = backup.info();

        let prepare = (|| {
            let (fresh, selection) = self.discard_selection(request, cancellation)?;

            if BranchIdentity::from_snapshot(&fresh) != BranchIdentity::from_snapshot(&before)
                || selection != selected
            {
                return Err(RepositoryError::InvalidInput(
                    "The selected files or branch changed during backup. Refresh before discarding.",
                ));
            }

            super::mutations::recovery_id().map_err(RepositoryError::Io)
        })();

        let token = prepare
            .map_err(|error| failure(WritePhase::BeforeCommand, error, info.clone(), None))?;

        self.perform_discard(&mut backup, cancellation)
            .map_err(|(error, rollback)| {
                failure(error.phase, error.error, backup.info(), rollback)
            })?;

        let finish = (|| {
            let deadline = wall_time()?
                .checked_add(UNDO_TTL)
                .ok_or(RepositoryError::InvalidInput("Undo expiry is out of range"))?;

            let undo = DiscardUndo {
                token,
                path: selected[0].path.clone(),
                expires_at: iso_time(deadline)?,
            };

            Ok((deadline, undo))
        })();

        let (deadline, undo) =
            finish.map_err(|error| failure(WritePhase::Command, error, backup.info(), None))?;

        let recovery = backup.info().expect("completed nonempty recovery patches");

        *self
            .pending_discard
            .lock()
            .expect("discard undo state poisoned") = Some(PendingDiscard {
            deadline,
            undo: undo.clone(),
            backup,
        });

        let snapshot = self
            .check_write_identity()
            .and_then(|_| self.snapshot_uncoordinated(false, cancellation))
            .map_err(|error| failure(WritePhase::Refresh, error, Some(recovery.clone()), None))?;

        Ok(DiscardResult {
            snapshot,
            undo,
            recovery,
        })
    }

    /// Restore the latest successful discard while its one-use token is valid.
    ///
    /// Reconstructs staged and working contents separately using held, hash-checked
    /// patch files, with the source's compensating applies on later failures.
    /// A successful restore consumes the token before final refresh; an unsuccessful
    /// restore retains it until expiry. Expiry/session close never deletes backups.
    /// Later successful discards replace the session token without deleting older
    /// backups. Reopened sessions do not acquire the old short-lived undo token.
    pub fn undo_discard(
        &self,
        token: &str,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, DiscardError> {
        let _write = self.mutations.enter();

        let invalid = || {
            failure(
                WritePhase::BeforeCommand,
                RepositoryError::InvalidInput("The discarded change can no longer be restored."),
                None,
                None,
            )
        };

        check_cancelled(cancellation)
            .map_err(|error| failure(WritePhase::BeforeCommand, error.into(), None, None))?;

        if token.is_empty() || token.contains('\0') {
            return Err(invalid());
        }

        let mut state = self
            .pending_discard
            .lock()
            .expect("discard undo state poisoned");

        let Some(pending) = state.as_mut() else {
            return Err(invalid());
        };

        if pending.undo.token != token {
            return Err(invalid());
        }

        let now = wall_time().map_err(|error| {
            failure(
                WritePhase::BeforeCommand,
                error,
                pending.backup.info(),
                None,
            )
        })?;

        if pending.deadline <= now {
            *state = None;

            return Err(invalid());
        }

        self.perform_undo(&mut pending.backup, cancellation)
            .map_err(|(error, rollback)| {
                failure(error.phase, error.error, pending.backup.info(), rollback)
            })?;
        let info = pending.backup.info();

        *state = None;

        self.check_write_identity()
            .and_then(|_| self.snapshot_uncoordinated(false, cancellation))
            .map_err(|error| failure(WritePhase::Refresh, error, info, None))
    }

    fn discard_selection(
        &self,
        request: &DiscardFiles,
        cancellation: Option<&Cancellation>,
    ) -> Result<(Snapshot, Vec<FileChange>), RepositoryError> {
        validate_paths(&request.paths)?;
        self.validate_discard_files(&request.paths)?;
        self.check_write_identity()?;
        let before = self.snapshot_uncoordinated(false, cancellation)?;
        let requested: HashSet<_> = request.paths.iter().collect();

        let selected: Vec<_> = before
            .status
            .files
            .iter()
            .filter(|file| {
                requested.contains(&file.path)
                    || file
                        .original_path
                        .as_ref()
                        .is_some_and(|path| requested.contains(path))
            })
            .cloned()
            .collect();

        if selected.is_empty() {
            return Err(RepositoryError::InvalidInput(
                "No changed file matches the selected path.",
            ));
        }

        if selected
            .iter()
            .any(|file| file.record_type == RecordType::Unmerged)
        {
            return Err(RepositoryError::InvalidInput(
                "Resolve conflicted files before discarding their changes.",
            ));
        }

        if let Some(review) = request.recovery.as_ref()
            && (before.operation != OperationState::Normal
                || BranchIdentity::from_snapshot(&before) != review.expected
                || selected.len() != requested.len()
                || selected.iter().any(|file| {
                    !requested.contains(&file.path)
                        || file.original_path.is_some()
                        || file.submodule.starts_with('S')
                        || file.index_status == FileStatus::TypeChanged
                        || file.worktree_status == FileStatus::TypeChanged
                }))
        {
            return Err(RepositoryError::InvalidInput(
                "Refresh first. Every selected path must still be an ordinary changed file outside Git operations.",
            ));
        }

        self.check_write_identity()?;

        Ok((before, selected))
    }
}

fn failure(
    phase: WritePhase,
    error: RepositoryError,
    recovery: Option<RecoveryBackup>,
    rollback_error: Option<RepositoryError>,
) -> DiscardError {
    DiscardError {
        phase,
        error,
        recovery,
        rollback_error: rollback_error.map(Box::new),
    }
}
