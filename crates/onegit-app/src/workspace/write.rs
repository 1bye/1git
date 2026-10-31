//! Blocking writes use the existing Git mutation queue and never replay a failed command.
use super::read::{self, ChangedFile, Loaded, Side};

use onegit_git::{
    CommitIndex, FileStatus, OperationState, RecordType, RepositoryError, WriteError, WritePhase,
};

use std::sync::Arc;

pub(super) enum Operation {
    File(ChangedFile),
    Branch(onegit_git::BranchRequest),
    StageAll,
    UnstageAll,
    Commit {
        summary: String,
        description: String,
    },
}

impl Operation {
    pub fn progress(&self) -> &'static str {
        match self {
            Self::File(file) if file.key.side == Side::Staged => "Unstaging file…",
            Self::File(_) => "Staging file…",
            Self::StageAll => "Staging all changes…",
            Self::UnstageAll => "Unstaging all changes…",
            Self::Commit { .. } => "Creating commit…",
            Self::Branch(_) => "Updating branch…",
        }
    }

    fn success(&self) -> &'static str {
        match self {
            Self::File(file) if file.key.side == Side::Staged => "File unstaged",
            Self::File(_) => "File staged",
            Self::StageAll => "Changes staged",
            Self::UnstageAll => "Changes unstaged",
            Self::Commit { .. } => "Commit created",
            Self::Branch(_) => "Branch updated",
        }
    }
}

pub(super) struct Outcome {
    pub loaded: Result<Arc<Loaded>, String>,
    pub result: Result<String, String>,
    pub committed: bool,
    pub branch_action: bool,
}

pub(super) fn available(loaded: &Loaded) -> bool {
    loaded.snapshot.operation == OperationState::Normal
        && !loaded
            .snapshot
            .status
            .files
            .iter()
            .any(|file| file.record_type == RecordType::Unmerged)
}

pub(super) fn staged_count(loaded: &Loaded) -> usize {
    loaded
        .files
        .iter()
        .filter(|file| file.key.side == Side::Staged)
        .count()
}

pub(super) fn run(loaded: Arc<Loaded>, operation: Operation) -> Outcome {
    if let Operation::Branch(request) = &operation {
        return run_branch(loaded, request);
    }

    let repository = &loaded.repository;
    let mut committed = false;

    let result = (|| {
        let before = |error| WriteError {
            phase: WritePhase::BeforeCommand,
            error,
        };

        let fresh = read::from_snapshot(
            repository.clone(),
            repository.snapshot(false, None).map_err(before)?,
        );

        if !available(&fresh) {
            return Err(before(RepositoryError::InvalidInput(
                "Finish the current Git operation and resolve conflicts in your editor before writing here.",
            )));
        }

        if fresh.snapshot.status.head.branch != loaded.snapshot.status.head.branch
            || fresh.snapshot.status.head.oid != loaded.snapshot.status.head.oid
        {
            return Err(before(RepositoryError::InvalidInput(
                "HEAD or the branch changed. Review the refreshed repository before trying again.",
            )));
        }

        let snapshot = match &operation {
            Operation::File(file) => {
                let Some(current) = fresh.file(&file.key) else {
                    return Err(before(RepositoryError::InvalidInput(
                        "The selected file changed. Review the refreshed files before trying again.",
                    )));
                };

                if file.status == FileStatus::Renamed
                    && (current.status != FileStatus::Renamed || current.original != file.original)
                {
                    return Err(before(RepositoryError::InvalidInput(
                        "The rename changed. Review the refreshed files before trying again.",
                    )));
                }

                let mut paths = vec![file.key.path.clone()];

                // A rename represents both names; a copy must leave its source alone.
                if file.status == FileStatus::Renamed
                    && let Some(original) = &file.original
                {
                    paths.push(original.clone());
                }

                if file.key.side == Side::Staged {
                    repository.unstage(&paths, None)?
                } else {
                    repository.stage(&paths, None)?
                }
            }
            Operation::Branch(_) => {
                unreachable!("branch operations use their reviewed write guard")
            }
            Operation::StageAll => repository.stage_all(None)?,
            Operation::UnstageAll => repository.unstage_all(None)?,
            Operation::Commit {
                summary,
                description,
            } => {
                if staged_count(&fresh) == 0 {
                    return Err(before(RepositoryError::InvalidInput(
                        "Stage at least one file before committing.",
                    )));
                }

                let result = repository.commit_index(
                    CommitIndex {
                        summary,
                        description: Some(description),
                        ..Default::default()
                    },
                    None,
                )?;

                committed = true;

                return Ok((
                    result.snapshot,
                    format!("{} · {}", &result.commit.oid[..8], result.commit.summary),
                ));
            }
        };

        Ok((snapshot, operation.success().to_owned()))
    })();

    match result {
        Ok((snapshot, detail)) => Outcome {
            loaded: Ok(read::from_snapshot(repository.clone(), snapshot)),
            result: Ok(detail),
            committed,
            branch_action: false,
        },
        Err(error) => {
            let boundary = match error.phase {
                WritePhase::BeforeCommand => "The operation did not start.",
                WritePhase::Command => {
                    "Git may have made partial changes. Review the refreshed files before trying again."
                }
                WritePhase::Refresh => {
                    "Git completed the write, but its result could not be confirmed. Inspect the repository before submitting again."
                }
            };

            let detail = format!("{}\n{boundary}", read::message(error.error));

            // A failed command is never retried: only status is read to reveal any partial effects.
            let refreshed = repository
                .snapshot(false, None)
                .map(|snapshot| read::from_snapshot(repository.clone(), snapshot))
                .map_err(read::message);

            Outcome {
                loaded: refreshed,
                result: Err(detail),
                committed: false,
                branch_action: false,
            }
        }
    }
}

fn run_branch(loaded: Arc<Loaded>, request: &onegit_git::BranchRequest) -> Outcome {
    let repository = &loaded.repository;

    match repository.change_branch(request, None) {
        Ok(result) => {
            let detail = if let Some(saved) = &result.saved_changes {
                format!(
                    "Branch updated. Changes saved for “{}” ({}) can be restored from Branches.",
                    saved.branch,
                    saved.oid.chars().take(7).collect::<String>()
                )
            } else {
                "Branch updated".into()
            };

            Outcome {
                loaded: Ok(read::from_snapshot(repository.clone(), result.snapshot)),
                result: Ok(detail),
                committed: false,
                branch_action: true,
            }
        }
        Err(error) => {
            let mut detail = error.to_string();

            let boundary = match error.failure.phase {
                WritePhase::BeforeCommand => "The branch operation did not start.",
                WritePhase::Command => {
                    "Git may have made partial changes. Review the repository and any recovery backup before trying again."
                }
                WritePhase::Refresh => {
                    "The branch operation completed but could not be confirmed. Review the repository before submitting again."
                }
            };

            detail.push('\n');
            detail.push_str(boundary);
            let loaded = repository
                .snapshot(false, None)
                .map(|snapshot| read::from_snapshot(repository.clone(), snapshot))
                .map_err(read::message);

            Outcome {
                loaded,
                result: Err(detail),
                committed: false,
                branch_action: true,
            }
        }
    }
}
