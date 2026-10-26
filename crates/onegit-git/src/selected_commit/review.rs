use super::CommitError;

use crate::{
    BranchIdentity, Cancellation, CommitInfo, ErrorCode, OperationState, Repository, WritePhase,
};

impl Repository {
    /// Inspect the exact unpublished, non-merge branch tip eligible for amend/undo.
    /// Uses only locally recorded remote refs; never fetches or changes repository data.
    ///
    /// # Errors
    /// Refuses stale/unborn/detached identity, active operations/conflicts,
    /// locally known publication and merge tips; preserves read/cancellation causes.
    pub fn review_last_commit(
        &self,
        expected: &BranchIdentity,
        cancellation: Option<&Cancellation>,
    ) -> Result<CommitInfo, CommitError> {
        self.mutations.wait_for_pending();

        self.review_last_commit_uncoordinated(expected, cancellation)
    }

    pub(super) fn review_last_commit_uncoordinated(
        &self,
        expected: &BranchIdentity,
        cancellation: Option<&Cancellation>,
    ) -> Result<CommitInfo, CommitError> {
        let before = |error| CommitError::repository(WritePhase::BeforeCommand, error);

        let snapshot = self
            .snapshot_uncoordinated(false, cancellation)
            .map_err(before)?;

        let oid = expected.oid.as_deref().unwrap_or("");
        let branch = expected.branch.as_deref().unwrap_or("");

        if oid.is_empty()
            || branch.is_empty()
            || snapshot.status.head.oid != expected.oid
            || snapshot.status.head.branch != expected.branch
        {
            return Err(CommitError::invalid(
                ErrorCode::InvalidInput,
                "HEAD or the branch changed. Refresh before editing the last commit.",
            ));
        }

        if snapshot.operation != OperationState::Normal
            || snapshot
                .status
                .files
                .iter()
                .any(|file| file.record_type == crate::RecordType::Unmerged)
        {
            return Err(CommitError::invalid(
                ErrorCode::InvalidInput,
                "Finish the current Git operation and resolve conflicts first.",
            ));
        }

        let published = self
            .run(
                [
                    "for-each-ref",
                    &format!("--contains={oid}"),
                    "--format=%(refname)",
                    "refs/remotes/",
                ],
                cancellation,
            )
            .map_err(before)?;

        if !published.stdout.iter().all(u8::is_ascii_whitespace) {
            return Err(CommitError::invalid(
                ErrorCode::InvalidInput,
                "This commit is already published according to the known remote branches. History editing is only available for unpublished commits.",
            ));
        }

        let commit = self
            .commit_uncoordinated(oid, cancellation)
            .map_err(before)?;

        if commit.parent_oids.len() > 1 {
            return Err(CommitError::invalid(
                ErrorCode::InvalidInput,
                "Editing merge commits requires external Git tools.",
            ));
        }

        Ok(commit)
    }
}
