//! Reviewed, non-forcing creation/removal with source, destination and checkout preservation.

use super::*;
use crate::repository::{BranchIdentity, BranchKind, OperationState, Snapshot};
use std::fs;

/// Branch selection retained by a worktree creation dialog.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WorktreeBranch {
    /// Create this new local name from the reviewed source commit.
    New(String),
    /// Use an existing unoccupied local branch.
    Existing(String),
    /// Create a tracking branch for this exact full remote ref, without guessing a remote.
    Remote(String),
}

/// Owned intent retained independently of later UI refreshes. Neither variant permits force.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WorktreeRequest {
    /// Create a checkout without changing the source worktree or discarding its edits.
    Create {
        /// Exact source commit/branch reviewed when opening the form.
        source: BranchIdentity,
        /// Local/new/exact-remote branch choice.
        branch: WorktreeBranch,
        /// Absolute empty or missing destination under an existing parent.
        path: PathBuf,
    },
    /// Remove a registered clean linked checkout, preserving its branch.
    Remove {
        /// Exact canonical registered path reviewed by the confirmation.
        path: PathBuf,
        /// Exact target commit/branch; this is not the source workspace identity.
        expected: BranchIdentity,
    },
}

/// Fresh metadata and source snapshot after a reviewed worktree write.
#[derive(Debug)]
pub struct WorktreeMutation {
    /// Canonical created or removed checkout path.
    pub path: PathBuf,
    /// Fresh registrations after the command, before releasing its write guard.
    pub worktrees: Vec<Worktree>,
    /// Fresh state of the originating worktree, including hook changes.
    pub snapshot: Snapshot,
}

fn before(error: impl Into<RepositoryError>) -> WriteError {
    failure(WritePhase::BeforeCommand, error)
}

fn conflict(message: impl Into<String>) -> WriteError {
    before(RepositoryError::Conflict(message.into()))
}

fn source(
    repository: &Repository,
    reviewed: &BranchIdentity,
    cancellation: Option<&Cancellation>,
) -> Result<Snapshot, WriteError> {
    let snapshot = repository
        .snapshot_uncoordinated(false, cancellation)
        .map_err(before)?;

    if BranchIdentity::from_snapshot(&snapshot) != *reviewed {
        return Err(conflict(
            "The branch changed outside this app. Refresh before creating a worktree.",
        ));
    }

    if snapshot.status.head.oid.is_none() || snapshot.operation != OperationState::Normal {
        return Err(conflict(
            "Create a commit and finish any Git operation before creating a worktree.",
        ));
    }

    Ok(snapshot)
}

fn destination(path: &Path) -> Result<PathBuf, WriteError> {
    if !path.is_absolute() || path.as_os_str().as_bytes().contains(&0) {
        return Err(conflict("Choose an absolute destination path."));
    }

    let parent = path
        .parent()
        .ok_or_else(|| conflict("Choose an empty destination folder."))?;

    let name = path
        .file_name()
        .ok_or_else(|| conflict("Choose an empty destination folder."))?;

    let parent = fs::canonicalize(parent).map_err(|_| {
        conflict("Choose a writable empty folder or a new destination in an existing folder.")
    })?;

    let path = parent.join(name);

    match fs::symlink_metadata(&path) {
        Ok(metadata) => {
            if !metadata.is_dir()
                || fs::read_dir(&path)
                    .map_err(before)?
                    .next()
                    .transpose()
                    .map_err(before)?
                    .is_some()
            {
                return Err(conflict(
                    "Choose an empty destination folder; nothing was overwritten.",
                ));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(before(error)),
    }

    Ok(path)
}

impl Repository {
    /// Execute a reviewed source/target intent under the shared related-worktree guard.
    /// Never forces, replaces an existing ref, deletes a branch or cleans up an uncertain result.
    /// External Git/filesystem writes are not excluded; Git's own non-forcing checks still apply.
    pub fn change_worktree(
        &self,
        request: &WorktreeRequest,
        cancellation: Option<&Cancellation>,
    ) -> Result<WorktreeMutation, WriteError> {
        let _write = self.mutations.enter();

        check_cancelled(cancellation).map_err(before)?;
        self.check_write_identity().map_err(before)?;
        let (path, removing) = match request {
            WorktreeRequest::Create {
                source: reviewed,
                branch,
                path,
            } => {
                let snapshot = source(self, reviewed, cancellation)?;
                let path = destination(path)?;
                let branches = self.branches_uncoordinated(cancellation).map_err(before)?;

                let local = |name: &str| {
                    branches
                        .branches
                        .iter()
                        .find(|item| item.kind == BranchKind::Local && item.name == name)
                };

                let mut options = CreateWorktree::new(&path);

                match branch {
                    WorktreeBranch::New(name) => {
                        require_revision(name).map_err(before)?;

                        if local(name).is_some() {
                            return Err(conflict(
                                "This branch already exists. Choose another name.",
                            ));
                        }

                        options.new_branch = Some(name);
                        options.revision = snapshot.status.head.oid.as_deref();
                    }
                    WorktreeBranch::Existing(name) => {
                        let target = local(name).ok_or_else(|| conflict("Choose a local branch that is not checked out in another worktree."))?;

                        if target.checked_out || target.worktree_path.is_some() {
                            return Err(conflict(
                                "Choose a local branch that is not checked out in another worktree.",
                            ));
                        }

                        options.revision = Some(name);
                    }
                    WorktreeBranch::Remote(reference) => {
                        options.new_branch = Some(
                            crate::repository::refs::remote_tracking_name(reference, &branches)
                                .map_err(before)?,
                        );
                        options.revision = Some(reference);
                        options.track = true;
                    }
                }

                // Metadata and destination inspection must not silently retarget a refreshed dialog.
                source(self, reviewed, cancellation)?;
                self.check_write_identity().map_err(before)?;
                self.execute_worktree(Edit::Create(options), cancellation)?;

                (path, false)
            }
            WorktreeRequest::Remove { path, expected } => {
                let registrations = self.worktrees_uncoordinated(cancellation).map_err(before)?;

                let target = registrations
                    .iter()
                    .find(|item| item.path == *path)
                    .filter(|item| !item.locked && !item.prunable)
                    .ok_or_else(|| {
                        conflict(
                            "Choose an available, unlocked worktree. Refresh before trying again.",
                        )
                    })?;

                if target.head_oid != expected.oid || target.branch != expected.branch {
                    return Err(conflict(
                        "The worktree changed since it was selected. Refresh before removing it.",
                    ));
                }

                let metadata = fs::symlink_metadata(path).map_err(|_| {
                    conflict("The worktree folder is unavailable. Refresh before trying again.")
                })?;

                if !metadata.is_dir() || fs::canonicalize(path).map_err(before)? != *path {
                    return Err(conflict("The worktree path changed. Nothing was removed."));
                }

                let opened =
                    Repository::open(path, self.process.clone(), cancellation).map_err(before)?;

                let snapshot = opened
                    .snapshot_uncoordinated(true, cancellation)
                    .map_err(before)?;

                let source = self
                    .snapshot_uncoordinated(false, cancellation)
                    .map_err(before)?;

                if snapshot.repository.root != *path
                    || BranchIdentity::from_snapshot(&snapshot) != *expected
                {
                    return Err(conflict(
                        "The worktree changed since it was selected. Refresh before removing it.",
                    ));
                }

                if snapshot.repository.common_directory != self.info.common_directory
                    || snapshot.repository.git_directory == snapshot.repository.common_directory
                    || snapshot.repository.root == self.info.root
                {
                    return Err(conflict(
                        "The main or current worktree cannot be removed here.",
                    ));
                }

                if snapshot.operation != OperationState::Normal
                    || source.operation != OperationState::Normal
                {
                    return Err(conflict(
                        "Finish the Git operation before removing a worktree.",
                    ));
                }

                if !snapshot.status.files.is_empty() {
                    return Err(conflict(
                        "This worktree contains changed, untracked, or ignored files. Nothing was removed.",
                    ));
                }

                self.check_write_identity().map_err(before)?;
                opened.check_write_identity().map_err(before)?;
                self.execute_worktree(Edit::Remove(path, false), cancellation)?;

                (path.clone(), true)
            }
        };

        let worktrees = self.worktree_result(cancellation)?;

        if worktrees.iter().any(|item| item.path == path) == removing {
            return Err(failure(WritePhase::Refresh, RepositoryError::InvalidOutput));
        }

        let snapshot = self
            .snapshot_uncoordinated(false, cancellation)
            .map_err(|error| failure(WritePhase::Refresh, error))?;

        Ok(WorktreeMutation {
            path,
            worktrees,
            snapshot,
        })
    }
}
