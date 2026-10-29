//! Ordinary sequencer commands and reviewed single-commit History actions.
use super::metadata_writes::{before, refresh, text};

use super::{
    BranchIdentity, BranchKind, CommitInfo, OperationState, Repository, RepositoryError, Snapshot,
    WriteError, WritePhase,
};

use crate::validation::{full_oid, require_revision};
use crate::{Cancellation, GitError};

/// Ordinary index commit; use selected commits for guarded checkbox/line workflows.
#[derive(Clone, Copy, Debug, Default)]
pub struct CommitIndex<'a> {
    /// Nonblank summary, trimmed before execution.
    pub summary: &'a str,
    /// Optional trimmed message body.
    pub description: Option<&'a str>,
    /// Allow a commit with an unchanged tree.
    pub allow_empty: bool,
    /// Explicit ordinary Git amend; this lower-level operation does not check publication.
    pub amend: bool,
    /// Explicitly bypass pre-commit/commit-msg hooks.
    pub no_verify: bool,
    /// Add the configured committer's signoff.
    pub signoff: bool,
}

/// Commit metadata and fresh state after an ordinary index commit.
#[derive(Debug)]
pub struct IndexCommitResult {
    /// Actual resulting commit including hooks' message changes.
    pub commit: CommitInfo,
    /// Fresh state after Git completes.
    pub snapshot: Snapshot,
}

/// Ordinary revert sequence with an explicit no-commit choice.
#[derive(Clone, Copy, Debug)]
pub struct RevertOptions<'a> {
    /// One or more validated commit-ish arguments.
    pub revisions: &'a [&'a str],
    /// Apply reverse changes without committing them.
    pub no_commit: bool,
}

/// Exact commit and source branch identity reviewed in History.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReplayCommit {
    /// Full commit object ID, reachable from the reviewed source HEAD.
    pub commit: String,
    /// Source HEAD and named branch captured during review.
    pub expected: BranchIdentity,
}

/// Reviewed source commit and unoccupied local destination for cherry-pick.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CherryPickCommit {
    /// Captured source intent.
    pub review: ReplayCommit,
    /// Different existing local branch, never an arbitrary ref expression.
    pub target_branch: String,
    /// Captured destination object ID.
    pub expected_target: String,
}

impl Repository {
    /// Commit the existing index with ordinary Git hooks, signing and explicit flags.
    pub fn commit_index(
        &self,
        options: CommitIndex<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<IndexCommitResult, WriteError> {
        self.mutate(cancellation, || {
            let summary = options.summary.trim();

            text(summary).map_err(before)?;
            let description = options.description.unwrap_or("").trim();

            if description.contains('\0') {
                return Err(before(RepositoryError::InvalidInput(
                    "Description must contain no NUL.",
                )));
            }

            let message = if description.is_empty() {
                format!("{summary}\n")
            } else {
                format!("{summary}\n\n{description}\n")
            };

            let mut args = vec!["commit", "-F", "-"];

            if options.allow_empty {
                args.push("--allow-empty");
            }

            if options.amend {
                args.push("--amend");
            }

            if options.no_verify {
                args.push("--no-verify");
            }

            if options.signoff {
                args.push("--signoff");
            }

            self.write_command(args, message.as_bytes(), cancellation)?;

            Ok(IndexCommitResult {
                commit: self
                    .commit_uncoordinated("HEAD", cancellation)
                    .map_err(refresh)?,
                snapshot: self.written_snapshot(cancellation)?,
            })
        })
    }

    /// Cherry-pick a nonempty sequence without switching branches or hiding conflicts.
    pub fn cherry_pick(
        &self,
        revisions: &[&str],
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.mutate(cancellation, || {
            sequence(revisions).map_err(before)?;
            let mut args = vec!["cherry-pick"];

            args.extend_from_slice(revisions);
            self.write_command(args, &[], cancellation)?;

            self.written_snapshot(cancellation)
        })
    }

    /// Revert a sequence using Git's default messages, retaining conflicts for recovery.
    pub fn revert(
        &self,
        options: RevertOptions<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.mutate(cancellation, || {
            sequence(options.revisions).map_err(before)?;
            let mut args = vec!["revert", "--no-edit"];

            if options.no_commit {
                args.push("--no-commit");
            }

            args.extend_from_slice(options.revisions);
            self.write_command(args, &[], cancellation)?;

            self.written_snapshot(cancellation)
        })
    }

    /// Revert only the reviewed reachable non-merge commit from a clean named branch.
    pub fn revert_commit(
        &self,
        request: &ReplayCommit,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.mutate(cancellation, || {
            self.review_replay(request, cancellation).map_err(before)?;
            self.write_command(["revert", "--no-edit", &request.commit], &[], cancellation)?;

            self.written_snapshot(cancellation)
        })
    }

    /// Switch only to the reviewed unoccupied branch, then copy its selected source commit.
    /// A replay failure stays on the destination for explicit Continue/Abort; no rollback occurs.
    pub fn cherry_pick_commit(
        &self,
        request: &CherryPickCommit,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.mutate(cancellation, || {
            self.review_replay(&request.review,cancellation).map_err(before)?;
            require_revision(&request.target_branch).map_err(before)?;
            self.run(["check-ref-format","--branch",&request.target_branch],cancellation).map_err(before)?;
            let branches=self.branches_uncoordinated(cancellation).map_err(before)?;
            let target=branches.branches.iter().find(|b| b.kind==BranchKind::Local && b.name==request.target_branch).ok_or_else(|| before(RepositoryError::InvalidInput("Choose an existing local destination branch.")))?;

            if target.oid!=request.expected_target || target.checked_out || target.worktree_path.is_some() || request.review.expected.branch.as_ref()==Some(&request.target_branch) {
                return Err(before(RepositoryError::InvalidInput("The destination changed or is already open in a worktree.")));
            }

            if self.is_ancestor(&request.review.commit,&target.oid,cancellation).map_err(before)? {
                return Err(before(RepositoryError::InvalidInput("This commit is already in the destination branch's history.")));
            }

            self.write_command(["switch","--no-guess","--",&request.target_branch],&[],cancellation)?;
            let destination=self.snapshot_uncoordinated(false,cancellation).map_err(|error| WriteError { phase: WritePhase::Command,error })?;

            if destination.status.head.branch.as_ref()!=Some(&request.target_branch) || destination.status.head.oid.as_ref()!=Some(&request.expected_target) || destination.operation!=OperationState::Normal || !destination.status.files.is_empty() {
                return Err(WriteError { phase: WritePhase::Command,error: RepositoryError::InvalidInput("The destination changed while switching. Inspect Changes before trying again; no commit was copied.") });
            }

            self.write_command(["cherry-pick",&request.review.commit],&[],cancellation).map_err(|mut e| { e.phase=WritePhase::Command;

                e })?;

            self.written_snapshot(cancellation)
        })
    }

    pub(super) fn review_replay(
        &self,
        request: &ReplayCommit,
        cancellation: Option<&Cancellation>,
    ) -> Result<CommitInfo, RepositoryError> {
        if !full_oid(&request.commit) {
            return Err(RepositoryError::InvalidInput(
                "Select an exact commit from History.",
            ));
        }

        self.review_clean_branch(&request.expected, cancellation)?;
        let commit = self.commit_uncoordinated(&request.commit, cancellation)?;

        if commit.parent_oids.len() > 1 {
            return Err(RepositoryError::InvalidInput(
                "Merge commits require an external Git tool to choose the mainline parent.",
            ));
        }

        if !self.is_ancestor(
            &request.commit,
            request.expected.oid.as_deref().unwrap_or(""),
            cancellation,
        )? {
            return Err(RepositoryError::InvalidInput(
                "The selected commit is no longer in the reviewed History.",
            ));
        }

        Ok(commit)
    }

    pub(super) fn review_clean_branch(
        &self,
        expected: &BranchIdentity,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, RepositoryError> {
        let snapshot = self.snapshot_uncoordinated(false, cancellation)?;

        if expected.oid.is_none()
            || expected.branch.is_none()
            || snapshot.status.head.is_detached()
            || BranchIdentity::from_snapshot(&snapshot) != *expected
        {
            return Err(RepositoryError::InvalidInput(
                "HEAD or the branch changed. Refresh and review History again.",
            ));
        }

        if snapshot.operation != OperationState::Normal || !snapshot.status.files.is_empty() {
            return Err(RepositoryError::InvalidInput(
                "Commit or stash your changes and finish the current Git operation first. Nothing has been discarded.",
            ));
        }

        Ok(snapshot)
    }

    pub(super) fn is_ancestor(
        &self,
        ancestor: &str,
        tip: &str,
        cancellation: Option<&Cancellation>,
    ) -> Result<bool, RepositoryError> {
        require_revision(ancestor)?;
        require_revision(tip)?;

        match self.run(["merge-base", "--is-ancestor", ancestor, tip], cancellation) {
            Ok(_) => Ok(true),
            Err(RepositoryError::Git(GitError::CommandFailed { status, .. }))
                if status.code() == Some(1) =>
            {
                Ok(false)
            }
            Err(e) => Err(e),
        }
    }

    /// Continue an ordinary cherry-pick; callers wanting review checks use finish_operation.
    pub fn continue_cherry_pick(
        &self,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.sequence_action("cherry-pick", "--continue", cancellation)
    }

    /// Abort an ordinary cherry-pick, allowing Git to restore its pre-operation state.
    pub fn abort_cherry_pick(
        &self,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.sequence_action("cherry-pick", "--abort", cancellation)
    }

    /// Continue an ordinary revert using staged conflict resolutions.
    pub fn continue_revert(
        &self,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.sequence_action("revert", "--continue", cancellation)
    }

    /// Abort an ordinary revert without automatic retries or branch switching.
    pub fn abort_revert(
        &self,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.sequence_action("revert", "--abort", cancellation)
    }

    fn sequence_action(
        &self,
        sequence: &str,
        action: &str,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.mutate(cancellation, || {
            self.write_command([sequence, action], &[], cancellation)?;

            self.written_snapshot(cancellation)
        })
    }
}

fn sequence(revisions: &[&str]) -> Result<(), RepositoryError> {
    if revisions.is_empty() {
        return Err(RepositoryError::InvalidInput(
            "Select at least one revision.",
        ));
    }

    for revision in revisions {
        require_revision(revision)?;
    }

    Ok(())
}
