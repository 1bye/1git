//! Reviewed whole-worktree stash intent and identity-safe reflog deletion.
use super::metadata_writes::{before, refresh};
use super::{BranchIdentity, OperationState, Repository, RepositoryError, Snapshot, WriteError};
use crate::{Cancellation, GitError, RecordType};

use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

/// Explicit stash action; saved entries are always selected by their immutable object ID.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StashAction {
    /// Save tracked edits, optionally including untracked files. Ignored files remain untouched.
    Save {
        /// Optional user message; whitespace-only messages use Git's default.
        message: String,
        /// Explicit permission to save and remove untracked working files.
        include_untracked: bool,
    },
    /// Restore saved working changes while keeping the stash.
    Apply(String),
    /// Apply, then remove exactly the reviewed stash only after successful application.
    Pop(String),
    /// Remove exactly the reviewed stash after application-owned confirmation.
    Delete(String),
}

/// Frozen source identity prevents an open form from following a later branch switch.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StashRequest {
    /// HEAD/branch reviewed by the caller.
    pub source: BranchIdentity,
    /// Explicit action. No automatic retries or force options.
    pub action: StashAction,
}

fn conflict(message: impl Into<String>) -> WriteError {
    before(RepositoryError::Conflict(message.into()))
}

fn exact_oid(oid: &str) -> bool {
    matches!(oid.len(), 40 | 64)
        && oid
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

impl Repository {
    /// Recheck source, conflicts and eligible changes under the shared worktree mutation guard.
    /// Failed application retains the stash and any conflict files for explicit review.
    ///
    /// # Errors
    /// Returns a before-command error for stale identity, unavailable saved work or ineligible
    /// changes; a command error for failed Git execution; and a refresh error for unconfirmed
    /// results or a successfully applied Pop whose saved-copy cleanup failed. Never retries.
    pub fn change_stash(
        &self,
        request: &StashRequest,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.mutate(cancellation, || {
            let snapshot = self.snapshot_uncoordinated(false,cancellation).map_err(before)?;

            if BranchIdentity::from_snapshot(&snapshot) != request.source {
                return Err(conflict("The branch changed. Refresh before trying this stash action again."));
            }

            let files = &snapshot.status.files;

            if snapshot.operation != OperationState::Normal || files.iter().any(|f| f.record_type == RecordType::Unmerged) {
                return Err(conflict("Resolve conflicts and finish the current Git operation first."));
            }

            match &request.action {
                StashAction::Save{message,include_untracked} => {
                    if snapshot.status.head.oid.is_none() {return Err(conflict("Create the first commit before stashing changes."));}

                    if files.iter().any(|f| f.submodule.starts_with('S')) {return Err(conflict("Save submodule changes in the submodule before stashing here."));}

                    if message.contains('\0') {return Err(conflict("The stash message contains an invalid character."));}

                    if !files.iter().any(|f|f.record_type != RecordType::Ignored && (*include_untracked || f.record_type != RecordType::Untracked)) {
                        return Err(conflict("There are no changes to stash with these options."));
                    }

                    let mut args=vec!["stash","push"];

                    if *include_untracked {args.push("--include-untracked");}

                    let message = message.trim();

                    if !message.is_empty() {args.extend(["-m", message]);}

                    self.write_command(args,&[],cancellation)?;
                }
                StashAction::Apply(oid) | StashAction::Pop(oid) | StashAction::Delete(oid) => {
                    if !exact_oid(oid) {return Err(conflict("Choose an exact saved stash."));}

                    let stashes = self.stashes_uncoordinated(cancellation).map_err(before)?;

                    if stashes.iter().filter(|s|s.oid == *oid).count()!=1 {return Err(conflict("This stash changed or is unavailable. Refresh and select it again."));}

                    if !matches!(request.action,StashAction::Delete(_)) {
                        if files.iter().any(|f|f.record_type != RecordType::Ignored) {return Err(conflict("Commit or stash current changes before applying saved work. Nothing was overwritten."));}

                        self.write_command(["stash","apply",oid], &[], cancellation)?;
                    }

                    if !matches!(request.action,StashAction::Apply(_)) {
                        // Resolve again while holding Git's ref lock. Never pass a mutable selector to drop/pop.
                        self.delete_reviewed_stash(oid, cancellation).map_err(|mut error| {
                            if matches!(request.action,StashAction::Pop(_)) {error.phase=super::WritePhase::Refresh;}

                            error
                        })?;
                    }
                }
            }

            self.written_snapshot(cancellation)
        })
    }

    fn delete_reviewed_stash(
        &self,
        oid: &str,
        cancellation: Option<&Cancellation>,
    ) -> Result<(), WriteError> {
        match self.run(
            ["config", "--local", "--get", "extensions.refStorage"],
            cancellation,
        ) {
            Ok(out) if out.stdout == b"files\n" => {}
            Err(RepositoryError::Git(GitError::CommandFailed { status, .. }))
                if status.code() == Some(1) => {}
            Err(error) => return Err(before(error)),
            _ => {
                return Err(conflict(
                    "Safe stash deletion is unavailable for this Git reference format. Use Git outside the app.",
                ));
            }
        }

        let reference = self.info.common_directory.join("refs/stash");
        let log = self.info.common_directory.join("logs/refs/stash");
        let mut ref_lock = Lock::new(reference.with_extension("lock")).map_err(before)?;

        match self.run(["symbolic-ref", "-q", "refs/stash"], cancellation) {
            Err(RepositoryError::Git(GitError::CommandFailed { status, .. }))
                if status.code() == Some(1) => {}
            Err(error) => return Err(before(error)),
            _ => {
                return Err(conflict(
                    "Safe deletion requires an ordinary stash reference. Inspect it using Git.",
                ));
            }
        }

        let stashes = self.stashes_uncoordinated(cancellation).map_err(before)?;

        if stashes.iter().filter(|s| s.oid == oid).count() != 1 {
            return Err(conflict(
                "This stash changed or is unavailable. Refresh and select it again.",
            ));
        }

        let bytes = fs::read(&log).map_err(before)?;
        let lines = records(&bytes, oid.len()).map_err(before)?;

        let matches = lines
            .iter()
            .filter(|line| &line[oid.len() + 1..oid.len() * 2 + 1] == oid.as_bytes())
            .count();

        if matches != 1 {
            return Err(conflict(
                "The stash reflog changed. Refresh and select it again.",
            ));
        }

        let tip = std::str::from_utf8(
            &lines
                .last()
                .ok_or_else(|| conflict("The stash reflog is empty."))?
                [oid.len() + 1..oid.len() * 2 + 1],
        )
        .map_err(|_| conflict("Invalid stash object ID."))?;

        let current = self
            .run(["rev-parse", "--verify", "refs/stash"], cancellation)
            .map_err(before)?;

        if current
            .stdout
            .strip_suffix(b"\n")
            .unwrap_or(&current.stdout)
            != tip.as_bytes()
        {
            return Err(conflict(
                "The stash reference and reflog disagree. Inspect Stashes using Git.",
            ));
        }

        let mut output = Vec::with_capacity(bytes.len());
        let mut previous = vec![b'0'; oid.len()];

        for line in lines {
            let next = &line[oid.len() + 1..oid.len() * 2 + 1];

            if next == oid.as_bytes() {
                continue;
            }

            output.extend_from_slice(&previous);
            output.extend_from_slice(&line[oid.len()..]);
            output.push(b'\n');
            previous.copy_from_slice(next);
        }

        let empty = output.is_empty();
        let mut log_lock = Lock::new(log.with_extension("lock")).map_err(before)?;

        log_lock.write(&output).map_err(before)?;

        if !empty {
            ref_lock
                .write(&[previous.as_slice(), b"\n"].concat())
                .map_err(before)?;
        }

        self.check_write_identity().map_err(before)?;
        super::check_cancelled(cancellation).map_err(before)?;
        log_lock.install(&log).map_err(before)?;

        if !empty {
            // If installing the tip fails, retain the ref lock to prevent further destructive writes.
            ref_lock.retain = true;
            ref_lock.install(&reference).map_err(|_| refresh(RepositoryError::Conflict("The stash entry was removed, but its reference could not be updated. Inspect refs/stash.lock before continuing.".into())))?;
        } else {
            ref_lock.release().map_err(refresh)?;

            // CAS also deletes packed refs. A concurrent new stash must survive final cleanup.
            if let Err(error) = self.write_command(
                ["update-ref", "--no-deref", "-d", "refs/stash", tip],
                &[],
                cancellation,
            ) && self
                .stashes_uncoordinated(cancellation)
                .map_err(refresh)?
                .is_empty()
            {
                return Err(error);
            }
        }

        Ok(())
    }
}

fn records(bytes: &[u8], width: usize) -> Result<Vec<&[u8]>, RepositoryError> {
    if !bytes.ends_with(b"\n") {
        return Err(RepositoryError::InvalidOutput);
    }

    bytes[..bytes.len() - 1]
        .split(|b| *b == b'\n')
        .map(|line| {
            if line.len() < width * 2 + 2
                || line[width] != b' '
                || line[width * 2 + 1] != b' '
                || !line[..width]
                    .iter()
                    .chain(&line[width + 1..width * 2 + 1])
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(b))
            {
                Err(RepositoryError::InvalidOutput)
            } else {
                Ok(line)
            }
        })
        .collect()
}

struct Lock {
    path: PathBuf,
    file: Option<File>,
    retain: bool,
    owned: bool,
}

impl Lock {
    fn new(path: PathBuf) -> std::io::Result<Self> {
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)?;

        Ok(Self {
            path,
            file: Some(file),
            retain: false,
            owned: true,
        })
    }

    fn write(&mut self, bytes: &[u8]) -> std::io::Result<()> {
        let file = self.file.as_mut().expect("owned lock is open");

        file.write_all(bytes)?;

        file.sync_all()
    }

    fn install(&mut self, target: &Path) -> std::io::Result<()> {
        if let Ok(metadata) = fs::metadata(target) {
            fs::set_permissions(&self.path, metadata.permissions())?;
        }

        self.file.take();
        fs::rename(&self.path, target)?;
        self.owned = false;

        Ok(())
    }

    fn release(&mut self) -> std::io::Result<()> {
        self.file.take();
        fs::remove_file(&self.path)?;
        self.owned = false;

        Ok(())
    }
}

impl Drop for Lock {
    fn drop(&mut self) {
        self.file.take();

        if self.owned && !self.retain {
            let _ = fs::remove_file(&self.path);
        }
    }
}
