//! Explicit CLI-level worktree maintenance; reviewed application guards are a separate boundary.

use super::{Repository, RepositoryError, Worktree, WriteError, WritePhase, check_cancelled};
use crate::Cancellation;
use crate::validation::require_revision;
use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};

#[path = "worktree_mutations/reviewed.rs"]
mod reviewed;

pub use reviewed::{WorktreeBranch, WorktreeMutation, WorktreeRequest};

/// Lower-level worktree creation options, preserving ordinary Git hooks and tracking.
/// The application must additionally review source/destination identity and occupancy.
#[derive(Clone, Copy, Debug)]
pub struct CreateWorktree<'a> {
    /// Destination, resolved lexically against the process directory like the source API.
    pub path: &'a Path,
    /// Optional start point or existing branch; absence uses Git's basename/HEAD behavior.
    pub revision: Option<&'a str>,
    /// Create this new branch without replacing an existing ref.
    pub new_branch: Option<&'a str>,
    /// Configure tracking of the selected start point.
    pub track: bool,
    /// Explicit lower-level permission to bypass ordinary occupancy guards.
    /// Reviewed application actions must leave this false.
    pub force: bool,
    /// Create a detached checkout; mutually exclusive with `new_branch`.
    pub detach: bool,
    /// Create locked, with this non-empty reason; None creates unlocked.
    pub lock_reason: Option<&'a str>,
}

impl<'a> CreateWorktree<'a> {
    /// Use Git's default branch selection without force, tracking, detachment or a lock.
    pub fn new(path: &'a Path) -> Self {
        Self {
            path,
            revision: None,
            new_branch: None,
            track: false,
            force: false,
            detach: false,
            lock_reason: None,
        }
    }
}

enum Edit<'a> {
    Create(CreateWorktree<'a>),
    Move(&'a Path, &'a Path),
    Remove(&'a Path, bool),
    Lock(&'a Path, Option<&'a str>),
    Unlock(&'a Path),
    Prune(Option<&'a str>),
    Repair(&'a [PathBuf]),
}

fn failure(phase: WritePhase, error: impl Into<RepositoryError>) -> WriteError {
    WriteError {
        phase,
        error: error.into(),
    }
}

fn text(value: &str) -> Result<(), RepositoryError> {
    if value.is_empty() || value.contains('\0') {
        return Err(RepositoryError::InvalidInput(
            "Worktree text must be non-empty and contain no NUL",
        ));
    }

    Ok(())
}

fn absolute(path: &Path) -> Result<OsString, RepositoryError> {
    if path.as_os_str().is_empty()
        || crate::platform::path_to_git_bytes(path.as_os_str())
            .map_err(|_| RepositoryError::InvalidPath)?
            .contains(&0)
    {
        return Err(RepositoryError::InvalidPath);
    }

    let path = std::path::absolute(path)?;
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::ParentDir => {
                normalized.pop();
            }
            Component::CurDir => {}
            _ => normalized.push(component.as_os_str()),
        }
    }

    Ok(crate::platform::git_native_path(&normalized)?)
}

impl Repository {
    /// Create a linked checkout and return fresh registrations under the same write guard.
    /// Errors preserve partial files/refs; the caller must inspect rather than replay/clean up.
    pub fn create_worktree(
        &self,
        options: CreateWorktree<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<Worktree>, WriteError> {
        self.edit_worktree(Edit::Create(options), cancellation)
    }

    /// Move a registered linked checkout; Git protects locked/main/unsupported worktrees.
    pub fn move_worktree(
        &self,
        path: &Path,
        new_path: &Path,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<Worktree>, WriteError> {
        self.edit_worktree(Edit::Move(path, new_path), cancellation)
    }

    /// Remove a linked checkout, never its branch. Explicit force can discard dirty files.
    /// This CLI-level method does not replace the application's clean/ignored/current guards.
    pub fn remove_worktree(
        &self,
        path: &Path,
        force: bool,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<Worktree>, WriteError> {
        self.edit_worktree(Edit::Remove(path, force), cancellation)
    }

    /// Lock a registered checkout against pruning/removal with an optional reason.
    pub fn lock_worktree(
        &self,
        path: &Path,
        reason: Option<&str>,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<Worktree>, WriteError> {
        self.edit_worktree(Edit::Lock(path, reason), cancellation)
    }

    /// Unlock a registered checkout without removing its files or branch.
    pub fn unlock_worktree(
        &self,
        path: &Path,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<Worktree>, WriteError> {
        self.edit_worktree(Edit::Unlock(path), cancellation)
    }

    /// Explicitly prune stale registrations using Git's expiry syntax, without deleting working files.
    pub fn prune_worktrees(
        &self,
        expire: Option<&str>,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<Worktree>, WriteError> {
        self.edit_worktree(Edit::Prune(expire), cancellation)
    }

    /// Explicitly repair administrative links after manual moves; an empty list repairs Git's defaults.
    pub fn repair_worktrees(
        &self,
        paths: &[PathBuf],
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<Worktree>, WriteError> {
        self.edit_worktree(Edit::Repair(paths), cancellation)
    }

    fn edit_worktree(
        &self,
        edit: Edit<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<Worktree>, WriteError> {
        let _write = self.mutations.enter();
        let before = |error: RepositoryError| failure(WritePhase::BeforeCommand, error);

        check_cancelled(cancellation).map_err(|error| before(error.into()))?;
        self.check_write_identity().map_err(before)?;
        self.execute_worktree(edit, cancellation)?;

        self.worktree_result(cancellation)
    }

    fn execute_worktree(
        &self,
        edit: Edit<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<(), WriteError> {
        let before = |error: RepositoryError| failure(WritePhase::BeforeCommand, error);
        let mut args: Vec<OsString> = vec!["worktree".into()];

        match edit {
            Edit::Create(options) => {
                if options.detach && options.new_branch.is_some_and(|branch| !branch.is_empty()) {
                    return Err(before(RepositoryError::InvalidInput(
                        "detach and new_branch are mutually exclusive",
                    )));
                }

                args.push("add".into());

                if options.track {
                    args.push("--track".into());
                }

                if options.force {
                    args.push("--force".into());
                }

                if options.detach {
                    args.push("--detach".into());
                }

                if let Some(branch) = options.new_branch.filter(|branch| !branch.is_empty()) {
                    self.branch_name(branch, cancellation)?;
                    args.extend(["-b".into(), branch.into()]);
                }

                if let Some(reason) = options.lock_reason {
                    text(reason).map_err(before)?;
                    args.extend(["--lock".into(), "--reason".into(), reason.into()]);
                }

                args.push(absolute(options.path).map_err(before)?);

                if let Some(revision) = options.revision.filter(|revision| !revision.is_empty()) {
                    require_revision(revision).map_err(before)?;
                    args.push(revision.into());
                }
            }
            Edit::Move(path, new_path) => args.extend([
                "move".into(),
                absolute(path).map_err(before)?,
                absolute(new_path).map_err(before)?,
            ]),
            Edit::Remove(path, force) => {
                args.push("remove".into());

                if force {
                    args.push("--force".into());
                }

                args.push(absolute(path).map_err(before)?);
            }
            Edit::Lock(path, reason) => {
                args.push("lock".into());

                if let Some(reason) = reason.filter(|reason| !reason.is_empty()) {
                    text(reason).map_err(before)?;
                    args.extend(["--reason".into(), reason.into()]);
                }

                args.push(absolute(path).map_err(before)?);
            }
            Edit::Unlock(path) => args.extend(["unlock".into(), absolute(path).map_err(before)?]),
            Edit::Prune(expire) => {
                args.push("prune".into());

                if let Some(expire) = expire.filter(|expire| !expire.is_empty()) {
                    text(expire).map_err(before)?;
                    args.push(format!("--expire={expire}").into());
                }
            }
            Edit::Repair(paths) => {
                args.push("repair".into());

                for path in paths {
                    args.push(absolute(path).map_err(before)?);
                }
            }
        }

        self.run(args, cancellation)
            .map_err(|error| failure(WritePhase::Command, error))?;

        Ok(())
    }

    fn worktree_result(
        &self,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<Worktree>, WriteError> {
        self.check_write_identity()
            .and_then(|_| self.worktrees_uncoordinated(cancellation))
            .map_err(|error| failure(WritePhase::Refresh, error))
    }
}
