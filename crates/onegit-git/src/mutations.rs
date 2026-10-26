//! FIFO application mutations, shared explicitly across canonical related worktrees.
//! The guard spans command cleanup and post-write refresh; external Git is not excluded.

use crate::GitPath;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, Weak};

use super::{Repository, RepositoryError, Snapshot, check_cancelled};
use crate::validation::require_paths;
use crate::{Cancellation, GitCommand, GitProcess};

#[derive(Default)]
struct QueueState {
    issued: u64,
    completed: u64,
}

#[derive(Default)]
pub(super) struct MutationQueue {
    state: Mutex<QueueState>,
    wake: Condvar,
}

impl MutationQueue {
    pub(super) fn enter(&self) -> MutationGuard<'_> {
        let mut state = self.state.lock().expect("mutation queue state poisoned");
        let ticket = state.issued;

        state.issued = state
            .issued
            .checked_add(1)
            .expect("mutation ticket space exhausted");

        while state.completed != ticket {
            state = self
                .wake
                .wait(state)
                .expect("mutation queue state poisoned");
        }

        MutationGuard(self)
    }

    pub fn wait_for_pending(&self) {
        let mut state = self.state.lock().expect("mutation queue state poisoned");
        let barrier = state.issued;

        while state.completed < barrier {
            state = self
                .wake
                .wait(state)
                .expect("mutation queue state poisoned");
        }
    }
}

pub(super) struct MutationGuard<'a>(&'a MutationQueue);

impl Drop for MutationGuard<'_> {
    fn drop(&mut self) {
        let mut state = self.0.state.lock().expect("mutation queue state poisoned");

        state.completed += 1;
        self.0.wake.notify_all();
    }
}

/// Shared application coordination for one owner's local repository sessions.
/// Clones share queues, not Git configuration or running processes. Related worktrees
/// use their canonical common directory; independent repositories do not block each other.
/// This serializes app calls only and does not replace Git's own index/ref locks.
#[derive(Clone, Default)]
pub struct RepositoryCoordinator {
    queues: Arc<Mutex<HashMap<PathBuf, Weak<MutationQueue>>>>,
}

impl RepositoryCoordinator {
    /// Number of queued/running writes for a canonical common-directory identity.
    /// Includes owned command cleanup and the final snapshot read. This is an app
    /// coordination signal, not evidence that external Git is idle.
    pub fn pending_writes(&self, common_directory: &Path) -> u64 {
        let queue = self
            .queues
            .lock()
            .expect("repository coordination map poisoned")
            .get(common_directory)
            .and_then(Weak::upgrade);

        queue.map_or(0, |queue| {
            let state = queue.state.lock().expect("mutation queue state poisoned");

            state.issued - state.completed
        })
    }

    /// Open a session participating in this owner's shared mutation/read barriers.
    /// Identity discovery is read-only; subsequent queries wait for prior queued writes.
    pub fn open(
        &self,
        path: &Path,
        process: GitProcess,
        cancellation: Option<&Cancellation>,
    ) -> Result<Repository, RepositoryError> {
        let mut repository = Repository::open(path, process, cancellation)?;

        let mut queues = self
            .queues
            .lock()
            .expect("repository coordination map poisoned");

        queues.retain(|_, queue| queue.strong_count() != 0);
        let key = repository.info.common_directory.clone();

        repository.mutations = queues.get(&key).and_then(Weak::upgrade).unwrap_or_else(|| {
            let queue = Arc::new(MutationQueue::default());

            queues.insert(key, Arc::downgrade(&queue));

            queue
        });

        Ok(repository)
    }
}

/// Boundary reached before a mutation failed. Command failures may have partial effects.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WritePhase {
    /// Failed before the requested repository mutation. Preparation can create private
    /// recovery files or temporary metadata; selected working files and the real index
    /// have not yet been changed by the requested operation.
    BeforeCommand,
    /// A command or remaining write step failed after mutation began; inspect state before retrying.
    Command,
    /// Mutating commands succeeded, but fresh result state could not be read or confirmed.
    Refresh,
}

/// A mutation failure preserving whether the command ran/succeeded before a read failed.
/// Never infer rollback or a clean tree from this result, and never automatically replay it.
#[derive(Debug)]
pub struct WriteError {
    /// Last mutation boundary reached.
    pub phase: WritePhase,
    /// Original validation, filesystem, status or process failure.
    pub error: RepositoryError,
}

impl std::fmt::Display for WriteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.error.fmt(f)
    }
}

impl std::error::Error for WriteError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.error)
    }
}

impl Repository {
    /// Stage exact repository-relative paths, preserving path bytes and ordinary Git filters.
    /// Duplicates are harmless. Validation/cancellation precede the mutating command.
    /// Calls on this session (or a shared coordinator) execute in FIFO order.
    pub fn stage(
        &self,
        paths: &[GitPath],
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.change_index(Some(paths), false, cancellation)
    }

    /// Stage all tracked/untracked changes using Git's ordinary add-all semantics.
    pub fn stage_all(&self, cancellation: Option<&Cancellation>) -> Result<Snapshot, WriteError> {
        self.change_index(None, false, cancellation)
    }

    /// Unstage exact paths without changing their working contents, including an unborn branch.
    pub fn unstage(
        &self,
        paths: &[GitPath],
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.change_index(Some(paths), true, cancellation)
    }

    /// Unstage the complete index without changing working files, including an unborn branch.
    pub fn unstage_all(&self, cancellation: Option<&Cancellation>) -> Result<Snapshot, WriteError> {
        self.change_index(None, true, cancellation)
    }

    fn change_index(
        &self,
        paths: Option<&[GitPath]>,
        unstage: bool,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        let _write = self.mutations.enter();

        let before = |error| WriteError {
            phase: WritePhase::BeforeCommand,
            error,
        };

        check_cancelled(cancellation).map_err(|error| before(error.into()))?;
        self.check_write_identity().map_err(before)?;

        if let Some(paths) = paths {
            require_paths(paths.iter()).map_err(before)?;
        }

        let unborn = if unstage {
            self.snapshot_uncoordinated(false, cancellation)
                .map_err(before)?
                .status
                .head
                .is_unborn()
        } else {
            false
        };

        let mut args: Vec<std::ffi::OsString> = if unstage {
            if unborn {
                vec![
                    "--literal-pathspecs".into(),
                    "rm".into(),
                    "--cached".into(),
                    "--ignore-unmatch".into(),
                ]
            } else {
                vec![
                    "--literal-pathspecs".into(),
                    "restore".into(),
                    "--staged".into(),
                ]
            }
        } else {
            vec!["--literal-pathspecs".into(), "add".into()]
        };

        if let Some(paths) = paths {
            args.push("--".into());
            let mut seen = std::collections::HashSet::new();

            for path in paths {
                if seen.insert(path) {
                    args.push(path.to_argument().map_err(|error| before(error.into()))?);
                }
            }
        } else if !unstage {
            args.push("--all".into());
        } else if unborn {
            args.extend(["-r".into(), "--".into(), ".".into()]);
        } else {
            // The cwd is the pinned working-tree root; dot selects the complete index.
            args.extend(["--".into(), ".".into()]);
        }

        let mut command = GitCommand::new(&self.info.root, args);

        command.directory = Some(&self.root_directory);
        command.cancellation = cancellation;
        self.process.run(command).map_err(|error| WriteError {
            phase: WritePhase::Command,
            error: error.into(),
        })?;

        self.check_write_identity()
            .and_then(|_| self.snapshot_uncoordinated(false, cancellation))
            .map_err(|error| WriteError {
                phase: WritePhase::Refresh,
                error,
            })
    }

    pub(super) fn check_write_identity(&self) -> Result<(), RepositoryError> {
        let current = fs::symlink_metadata(&self.info.root)?;

        if !current.is_dir()
            || crate::platform::FileIdentity::from_path(&self.info.root)?
                != crate::platform::FileIdentity::from_file(&self.root_directory)?
        {
            return Err(RepositoryError::InvalidInput(
                "Repository directory changed; reopen it before writing",
            ));
        }

        Ok(())
    }
}

// Compatible v4 identifiers for durable managed branch/rebase recovery records.
pub(super) fn recovery_id() -> std::io::Result<String> {
    let mut bytes = [0_u8; 16];

    crate::platform::random_bytes(&mut bytes)?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let digits = b"0123456789abcdef";

    let hex: String = bytes
        .iter()
        .flat_map(|byte| {
            [
                char::from(digits[(byte >> 4) as usize]),
                char::from(digits[(byte & 15) as usize]),
            ]
        })
        .collect();

    Ok(format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    ))
}
