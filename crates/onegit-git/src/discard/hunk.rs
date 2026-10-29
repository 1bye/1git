//! Exact single-file hunk selection and shared disk-backed discard undo.
use super::recovery::{Recovery, iso_time, wall_time};
use super::{
    DiscardError, DiscardUndo, PendingDiscard, Repository, RepositoryError, Snapshot, UNDO_TTL,
    WritePhase, check_cancelled, failure,
};
use crate::validation::require_paths;
use crate::{Cancellation, DiffOptions, DiffTarget, GitPath};

/// One path-scoped hunk operation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HunkAction {
    /// Add the hunk to the real index.
    Stage,
    /// Remove the hunk from the index without changing working files.
    Unstage,
    /// Reverse the hunk in working files after explicit consent.
    Discard,
}

/// Frozen selection from a three-context-line, whitespace-sensitive diff.
#[derive(Clone, Copy, Debug)]
pub struct ChangeHunk<'a> {
    /// Exact selected repository path.
    pub path: &'a GitPath,
    /// Zero-based text hunk index.
    pub hunk_index: usize,
    /// Staging or explicitly destructive working-file operation.
    pub action: HunkAction,
    /// Optional exact preview to reject stale selections.
    pub expected_patch: Option<&'a str>,
    /// Required only for discard.
    pub allow_destructive: bool,
}

/// Refreshed state and an optional shared discard-undo capability.
#[derive(Debug)]
pub struct HunkResult {
    /// Actual state after the patch command.
    pub snapshot: Snapshot,
    /// Present for discard only; consumed by Repository::undo_discard.
    pub undo: Option<DiscardUndo>,
}

/// Select one hunk from exactly one authoritative file patch, retaining its header.
///
/// # Errors
/// Rejects multiple files, missing hunks and patches without a diff header.
pub fn select_hunk_patch(patch: &str, index: usize) -> Result<String, RepositoryError> {
    let files: Vec<_> = patch
        .match_indices("diff --git ")
        .filter(|(i, _)| *i == 0 || patch.as_bytes()[*i - 1] == b'\n')
        .map(|(i, _)| i)
        .collect();
    if files != [0] {
        return Err(RepositoryError::InvalidInput(
            "The selected path must resolve to exactly one diff.",
        ));
    }
    let hunks: Vec<_> = patch
        .match_indices("@@ ")
        .filter(|(i, _)| *i == 0 || patch.as_bytes()[*i - 1] == b'\n')
        .map(|(i, _)| i)
        .collect();
    let start = *hunks.get(index).ok_or(RepositoryError::InvalidInput(
        "The selected hunk no longer exists.",
    ))?;
    let end = hunks.get(index + 1).copied().unwrap_or(patch.len());
    let mut result = format!("{}{}", &patch[..hunks[0]], &patch[start..end]);
    if !result.ends_with('\n') {
        result.push('\n');
    }
    Ok(result)
}

impl Repository {
    /// Stage, unstage or explicitly discard a reviewed path-scoped text hunk.
    /// Discard uses the same private held-file recovery and one-use undo as file discard.
    ///
    /// # Errors
    /// Rejects stale/missing hunks, redirected patch destinations, unsafe paths and
    /// unconfirmed discard. Process/recovery/refresh failures retain their write phase;
    /// an error after mutation begins must not trigger an automatic retry.
    pub fn change_hunk(
        &self,
        request: ChangeHunk<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<HunkResult, DiscardError> {
        let _write = self.mutations.enter();
        let before = |error| failure(WritePhase::BeforeCommand, error, None, None);
        check_cancelled(cancellation).map_err(|e| before(e.into()))?;
        self.check_write_identity().map_err(before)?;
        require_paths([request.path]).map_err(before)?;
        if request.hunk_index > i32::MAX as usize {
            return Err(before(RepositoryError::InvalidInput(
                "Hunk index is out of range.",
            )));
        }
        if request.action == HunkAction::Discard && !request.allow_destructive {
            return Err(before(RepositoryError::InvalidInput(
                "Discarding worktree content requires allowDestructive: true.",
            )));
        }
        let paths = [request.path.clone()];
        let mut options = DiffOptions::new(if request.action == HunkAction::Unstage {
            DiffTarget::Staged
        } else {
            DiffTarget::Working
        });
        options.paths = Some(&paths);
        let diff = self
            .diff_uncoordinated(options, cancellation)
            .map_err(before)?;
        if request
            .expected_patch
            .is_some_and(|expected| expected != diff.patch)
        {
            return Err(before(RepositoryError::InvalidInput(
                "The diff changed. Refresh and review it before staging.",
            )));
        }
        let patch = select_hunk_patch(&diff.patch, request.hunk_index).map_err(before)?;
        self.check_patch_destination(patch.as_bytes(), request.path, cancellation)
            .map_err(before)?;

        if request.action != HunkAction::Discard {
            let mut args = vec!["apply", "--recount", "--whitespace=nowarn", "--cached"];
            if request.action == HunkAction::Unstage {
                args.push("--reverse");
            }
            self.write_command(args, patch.as_bytes(), cancellation)
                .map_err(|e| failure(e.phase, e.error, None, None))?;
            let snapshot = self
                .written_snapshot(cancellation)
                .map_err(|e| failure(e.phase, e.error, None, None))?;
            return Ok(HunkResult {
                snapshot,
                undo: None,
            });
        }
        self.validate_discard_files(&paths).map_err(before)?;
        let snapshot = self
            .snapshot_uncoordinated(false, cancellation)
            .map_err(before)?;
        let mut backup = Recovery::from_hunk(
            &self.info.root,
            snapshot.status.head.oid.as_deref(),
            request.path.clone(),
            patch.as_bytes(),
            cancellation,
        )
        .map_err(before)?;
        self.perform_discard(&mut backup, cancellation)
            .map_err(|(e, rollback)| failure(e.phase, e.error, backup.info(), rollback))?;
        let info = backup.info();
        let now = wall_time().map_err(|e| failure(WritePhase::Command, e, info.clone(), None))?;
        let deadline = now.checked_add(UNDO_TTL).ok_or_else(|| {
            failure(
                WritePhase::Command,
                RepositoryError::InvalidInput("Undo expiry is out of range"),
                info.clone(),
                None,
            )
        })?;
        let undo = DiscardUndo {
            path: request.path.clone(),
            token: super::super::mutations::recovery_id()
                .map_err(|e| failure(WritePhase::Command, e.into(), info.clone(), None))?,
            expires_at: iso_time(deadline)
                .map_err(|e| failure(WritePhase::Command, e, info.clone(), None))?,
        };
        *self
            .pending_discard
            .lock()
            .expect("discard undo state poisoned") = Some(PendingDiscard {
            deadline,
            undo: undo.clone(),
            backup,
        });
        let snapshot = self
            .written_snapshot(cancellation)
            .map_err(|e| failure(e.phase, e.error, info, None))?;
        Ok(HunkResult {
            snapshot,
            undo: Some(undo),
        })
    }
}
