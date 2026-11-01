//! Snapshot-bound index edits; working files and unselected staging stay untouched.
use super::{
    BranchIdentity, OperationState, Repository, RepositoryError, Snapshot, WriteError, WritePhase,
    check_cancelled,
};

use crate::{Cancellation, DiffOptions, DiffTarget, GitCommand, GitPath, PartialPatch};
use std::{collections::HashSet, ffi::OsString, fs, io, path::Path};

/// Direction of a reviewed index edit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineAction {
    /// Add selected working changes to the index.
    Stage,
    /// Remove selected staged changes from the index.
    Unstage,
}

/// Exact original preview and source coordinates accepted by the user.
#[derive(Clone, Copy, Debug)]
pub struct ChangeLines<'a> {
    /// One literal repository path.
    pub path: &'a GitPath,
    /// Branch and HEAD shown with the preview.
    pub expected: &'a BranchIdentity,
    /// Exact unexpanded, unfiltered three-context-line patch.
    pub expected_patch: &'a str,
    /// Nonempty old/new coordinates from PartialPatch.
    pub lines: &'a [String],
    /// Stage or unstage the selected changes.
    pub action: LineAction,
}

impl Repository {
    /// Apply reviewed lines atomically to the index, preserving all working bytes.
    /// Holds the common-directory queue and real index lock while preparing a private index.
    /// Rechecks the exact diff and HEAD before installation; never automatically retry failures.
    ///
    /// # Errors
    /// Rejects stale, unsupported, empty or redirected selections, conflicts and foreign locks.
    /// Errors retain whether the real index changed or only its refresh failed.
    pub fn change_lines(
        &self,
        request: ChangeLines<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        let _write = self.mutations.enter();

        let before = |error| WriteError {
            phase: WritePhase::BeforeCommand,
            error,
        };

        check_cancelled(cancellation).map_err(|e| before(e.into()))?;
        self.check_write_identity().map_err(before)?;
        crate::validation::require_paths([request.path]).map_err(before)?;
        let mut lock =
            super::index_lock::IndexLock::new(self.index_path(cancellation).map_err(before)?)
                .map_err(|e| {
                    before(if e.kind() == io::ErrorKind::AlreadyExists {
                        RepositoryError::InvalidInput("The index is locked by another Git process.")
                    } else {
                        e.into()
                    })
                })?;

        let review = || -> Result<Snapshot, RepositoryError> {
            let snapshot = self.snapshot_uncoordinated(false, cancellation)?;

            if BranchIdentity::from_snapshot(&snapshot) != *request.expected
                || snapshot.operation != OperationState::Normal
                || snapshot
                    .status
                    .files
                    .iter()
                    .any(|f| f.record_type == crate::RecordType::Unmerged)
            {
                return Err(RepositoryError::InvalidInput(
                    "HEAD, branch or operation changed. Refresh and review the diff.",
                ));
            }

            let paths = [request.path.clone()];

            let mut options = DiffOptions::new(if request.action == LineAction::Stage {
                DiffTarget::Working
            } else {
                DiffTarget::Staged
            });

            options.paths = Some(&paths);
            let fresh = self.diff_uncoordinated(options, cancellation)?;

            if fresh.patch_omitted.is_some()
                || fresh.stats.iter().any(|s| s.path != *request.path)
                || fresh.patch != request.expected_patch
            {
                return Err(RepositoryError::InvalidInput(
                    "The diff changed. Refresh and review it before staging.",
                ));
            }

            Ok(snapshot)
        };

        let snapshot = review().map_err(before)?;

        let parsed = PartialPatch::new(request.expected_patch).map_err(|_| {
            before(RepositoryError::InvalidInput(
                "This change requires whole-file staging.",
            ))
        })?;

        let selected = parsed.select(request.lines).map_err(|_| {
            before(RepositoryError::InvalidInput(
                "The line selection is empty or outdated.",
            ))
        })?;

        let directory = tempfile::tempdir().map_err(|e| before(e.into()))?;
        let index = directory.path().join("index");

        let run = |args: Vec<OsString>, input: &[u8]| -> Result<(), RepositoryError> {
            let mut command = GitCommand::new(&self.info.root, args);

            command.directory = Some(&self.root_directory);
            command.index_file = Some(&index);
            command.stdin = input;
            command.cancellation = cancellation;
            self.process.run(command)?;

            Ok(())
        };

        match fs::copy(&lock.path, &index) {
            Ok(_) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                run(vec!["read-tree".into(), "--empty".into()], &[]).map_err(before)?
            }
            Err(e) => return Err(before(e.into())),
        }

        let patch = if request.action == LineAction::Unstage {
            let mut args: Vec<OsString> = vec!["--literal-pathspecs".into()];

            if snapshot.status.head.is_unborn() {
                args.extend(["rm", "--cached", "--force", "--ignore-unmatch"].map(Into::into));
            } else {
                args.extend(["restore", "--staged", "--source=HEAD"].map(Into::into));
            }

            args.extend(["--pathspec-from-file=-", "--pathspec-file-nul"].map(Into::into));
            run(
                args,
                &crate::git_path::pathspec_list(std::slice::from_ref(request.path))
                    .map_err(|e| before(e.into()))?,
            )
            .map_err(before)?;
            let selected: HashSet<_> = request.lines.iter().collect();

            let remaining: Vec<_> = parsed
                .lines()
                .iter()
                .filter(|line| !selected.contains(line))
                .cloned()
                .collect();

            if remaining.is_empty() {
                None
            } else {
                Some(parsed.select(&remaining).map_err(|_| {
                    before(RepositoryError::InvalidInput(
                        "Could not retain unselected staging.",
                    ))
                })?)
            }
        } else {
            Some(selected)
        };

        if let Some(patch) = patch {
            self.check_patch_destination(patch.as_bytes(), request.path, cancellation)
                .map_err(before)?;
            run(
                ["apply", "--cached", "--recount", "--whitespace=nowarn"]
                    .map(Into::into)
                    .to_vec(),
                patch.as_bytes(),
            )
            .map_err(before)?;
        }

        review().map_err(before)?;
        self.check_write_identity().map_err(before)?;
        check_cancelled(cancellation).map_err(|e| before(e.into()))?;
        lock.install(Path::new(&index))
            .map_err(|error| WriteError {
                phase: WritePhase::Command,
                error: error.into(),
            })?;

        self.check_write_identity()
            .and_then(|_| self.snapshot_uncoordinated(false, None))
            .map_err(|error| WriteError {
                phase: WritePhase::Refresh,
                error,
            })
    }
}
