use super::{CommitError, UndoCommitResult};
use crate::{BranchIdentity, Cancellation, GitCommand, Repository, WritePhase};

impl Repository {
    /// Undo only the reviewed unpublished, non-merge branch tip, preserving all files/staging.
    /// Atomically creates a durable recovery ref and moves the named branch to its parent;
    /// undoing its first commit deletes only that branch ref, leaving HEAD on an unborn branch.
    /// Other refs and linked checkouts remain untouched. Uses only known local remote refs.
    ///
    /// Holds the shared write queue through review, uncancellable ref installation and refresh.
    /// Call on an owned worker and retain close protection until UI publication. Cancellation
    /// applies before installation; an attempted transaction is reaped before returning.
    /// External Git can still change refs, so never automatically retry a command error.
    ///
    /// # Examples
    /// ```no_run
    /// use onegit_git::{BranchIdentity, GitProcess, Repository};
    /// # fn main() -> Result<(), Box<dyn std::error::Error>> {
    /// let repository = Repository::open(std::path::Path::new("/local/repository"), GitProcess::default(), None)?;
    /// let snapshot = repository.snapshot(false, None)?;
    /// let result = repository.undo_last_commit(&BranchIdentity::from_snapshot(&snapshot), None)?;
    /// assert!(result.recovery_ref.starts_with("refs/1git/undo/"));
    /// if result.warning.is_some() { eprintln!("Refresh and inspect History before continuing"); }
    /// # Ok(())
    /// # }
    /// ```
    ///
    /// # Errors
    /// Returns the exact review/preparation failure before attempting installation. Transaction
    /// failures carry [`WritePhase::Command`] and their original typed cause; a command error is
    /// not proof that the branch stayed unchanged. An acknowledged undo with failed refresh
    /// returns a result with a warning, retaining its recovery ref and original message.
    pub fn undo_last_commit(
        &self,
        expected: &BranchIdentity,
        cancellation: Option<&Cancellation>,
    ) -> Result<UndoCommitResult, CommitError> {
        let _write = self.mutations.enter();
        let before = |error| CommitError::repository(WritePhase::BeforeCommand, error);

        super::super::check_cancelled(cancellation).map_err(|error| before(error.into()))?;
        self.check_write_identity().map_err(before)?;
        let commit = self.review_last_commit_uncoordinated(expected, cancellation)?;
        let id = super::super::mutations::recovery_id().map_err(|error| before(error.into()))?;
        let recovery_ref = format!("refs/1git/undo/{id}");

        let branch = expected
            .branch
            .as_deref()
            .expect("successful review requires a named branch");

        let parent = commit.parent_oids.first();

        let change = parent.map_or_else(
            || format!("delete refs/heads/{branch} {}", commit.oid),
            |parent| format!("update refs/heads/{branch} {parent} {}", commit.oid),
        );

        let transaction = format!(
            "start\ncreate {recovery_ref} {}\n{change}\nprepare\ncommit\n",
            commit.oid
        );

        super::super::check_cancelled(cancellation).map_err(|error| before(error.into()))?;
        self.check_write_identity().map_err(before)?;
        let mut command = GitCommand::new(
            &self.info.root,
            ["update-ref", "-m", "1git: undo last commit", "--stdin"],
        );

        command.directory = Some(&self.root_directory);
        command.stdin = transaction.as_bytes();
        // The acknowledged branch move and recovery creation must finish together.
        self.process
            .run(command)
            .map_err(|error| CommitError::repository(WritePhase::Command, error.into()))?;
        let fresh = self
            .check_write_identity()
            .and_then(|_| self.snapshot_uncoordinated(false, None));

        let (snapshot, warning) = match fresh {
            Ok(snapshot) => {
                let changed = snapshot.status.head.branch != expected.branch
                    || snapshot.status.head.oid.as_ref() != parent;

                (Some(snapshot), changed.then(|| "Undo completed, but the branch changed externally. Refresh and inspect History before continuing.".to_owned()))
            }
            Err(_) => (
                None,
                Some("Commit undone, but refreshing failed. Refresh before continuing.".to_owned()),
            ),
        };

        let message = if commit.body.is_empty() {
            commit.summary
        } else {
            commit.body
        };

        Ok(UndoCommitResult {
            snapshot,
            message,
            recovery_ref,
            warning,
        })
    }
}
