//! Blocking writes use the existing Git mutation queue and never replay a failed command.
use super::read::{self, ChangedFile, Loaded, Side};

use onegit_git::{
    CommitIndex, FileStatus, OperationState, RecordType, RepositoryError, WriteError, WritePhase,
};

use std::sync::Arc;

pub(super) enum Operation {
    Replay {
        action: super::replay::Action,
        peers: Vec<Arc<onegit_git::Repository>>,
    },
    Recovery {
        action: super::recovery::Action,
        peers: Vec<Arc<onegit_git::Repository>>,
    },
    Lines {
        action: super::staging::Action,
        peers: Vec<Arc<onegit_git::Repository>>,
    },
    File(ChangedFile),
    Worktree {
        request: onegit_git::WorktreeRequest,
        peers: Vec<Arc<onegit_git::Repository>>,
        process: onegit_git::GitProcess,
    },
    Branch {
        request: onegit_git::BranchRequest,
        peers: Vec<Arc<onegit_git::Repository>>,
    },
    Integration {
        request: onegit_git::IntegrationRequest,
        peers: Vec<Arc<onegit_git::Repository>>,
    },
    GraphBranch(super::graph::Submit),
    Stash {
        request: onegit_git::StashRequest,
        peers: Vec<Arc<onegit_git::Repository>>,
    },
    Discard {
        action: super::discard::Action,
        peers: Vec<Arc<onegit_git::Repository>>,
    },
    Conflict {
        action: super::conflicts::Action,
        peers: Vec<Arc<onegit_git::Repository>>,
    },
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
            Self::Worktree { .. } => "Updating worktree…",
            Self::Replay { action, .. } => action.kind().title(),
            Self::Recovery {
                action: super::recovery::Action::Amend { .. },
                ..
            } => "Amending last commit…",
            Self::Recovery { .. } => "Undoing last commit…",
            Self::Lines { action, .. } if action.direction == onegit_git::LineAction::Unstage => {
                "Unstaging selected changes…"
            }
            Self::Lines { .. } => "Staging selected changes…",
            Self::File(file) if file.key.side == Side::Staged => "Unstaging file…",
            Self::File(_) => "Staging file…",
            Self::Conflict { .. } => "Updating conflict resolution…",
            Self::StageAll => "Staging all changes…",
            Self::UnstageAll => "Unstaging all changes…",
            Self::Commit { .. } => "Creating commit…",
            Self::Integration { request, .. } => {
                if request.kind == onegit_git::IntegrationKind::Rebase {
                    "Rebasing…"
                } else {
                    "Merging…"
                }
            }
            Self::Branch { .. } | Self::GraphBranch(_) => "Updating branch…",
            Self::Stash { .. } => "Updating saved work…",
            Self::Discard {
                action: super::discard::Action::Restore(_),
                ..
            } => "Restoring discarded changes…",
            Self::Discard { .. } => "Discarding changes…",
        }
    }

    fn success(&self) -> &'static str {
        match self {
            Self::Worktree { .. } => "Updating worktree…",
            Self::Replay { action, .. } => action.kind().title(),
            Self::Recovery { .. } => "Last commit updated",
            Self::Lines { .. } => "Selected changes updated",
            Self::File(file) if file.key.side == Side::Staged => "File unstaged",
            Self::File(_) => "File staged",
            Self::Conflict { .. } => "Conflict state updated",
            Self::StageAll => "Changes staged",
            Self::UnstageAll => "Changes unstaged",
            Self::Commit { .. } => "Commit created",
            Self::Integration { .. } => "Branches integrated",
            Self::Branch { .. } | Self::GraphBranch(_) => "Branch updated",
            Self::Stash { .. } => "Stash updated",
            Self::Discard { .. } => "Files updated",
        }
    }
}

pub(super) struct Outcome {
    pub loaded: Result<Arc<Loaded>, String>,
    pub result: Result<String, String>,
    pub recovery_completion: Option<super::recovery::Completed>,
    pub replay_completion: Option<super::replay::Completed>,
    pub staging_completion: Option<super::staging::Completed>,
    pub committed: bool,
    pub branch_action: Option<super::branches::WriteResult>,
    pub stash_completion: Option<super::stashes::Completed>,
    pub conflict_completion: Option<super::conflicts::Completed>,
    pub discard_completion: Option<super::discard::Completed>,
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
    if let Operation::Worktree {
        request,
        peers,
        process,
    } = &operation
    {
        return super::branches::worktrees::run(loaded, request, peers, process);
    }

    if let Operation::Replay { action, peers } = &operation {
        return super::replay::run(loaded, action, peers);
    }

    if let Operation::Recovery { action, peers } = &operation {
        return super::recovery::run(loaded, action, peers);
    }

    if let Operation::Lines { action, peers } = &operation {
        return super::staging::run(loaded, action, peers);
    }

    if let Operation::Conflict { action, peers } = &operation {
        return super::conflicts::run(loaded, action, peers);
    }

    if let Operation::Discard { action, peers } = &operation {
        return super::discard::run(loaded, action, peers);
    }

    if let Operation::Stash { request, peers } = &operation {
        return run_stash(loaded, request, peers);
    }

    if let Operation::GraphBranch(request) = &operation {
        let result = loaded
            .repository
            .create_branch_at_commit(&request.name, &request.oid, None)
            .map_err(Into::into);

        return branch_outcome(loaded, result, None, &[]);
    }

    if let Operation::Integration { request, peers } = &operation {
        return run_integration(loaded, request, peers);
    }

    if let Operation::Branch { request, peers } = &operation {
        return run_branch(loaded, request, peers);
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
            Operation::Replay { .. } => unreachable!("replays use the reviewed sequencer writer"),
            Operation::Recovery { .. } => {
                unreachable!("history edits use the reviewed transaction")
            }
            Operation::Lines { .. } => unreachable!("line edits use their reviewed index writer"),
            Operation::Discard { .. } => {
                unreachable!("discard operations use their reviewed write guard")
            }
            Operation::Stash { .. } => {
                unreachable!("stash operations use their reviewed write guard")
            }
            Operation::Worktree { .. }
            | Operation::Branch { .. }
            | Operation::Integration { .. }
            | Operation::GraphBranch(_) => {
                unreachable!("branch operations use their reviewed write guard")
            }
            Operation::Conflict { .. } => {
                unreachable!("conflict actions use their reviewed writer")
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
            staging_completion: None,
            replay_completion: None,
            recovery_completion: None,
            committed,
            branch_action: None,
            stash_completion: None,
            discard_completion: None,
            conflict_completion: None,
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
                staging_completion: None,
                replay_completion: None,
                recovery_completion: None,
                committed: false,
                branch_action: None,
                stash_completion: None,
                discard_completion: None,
                conflict_completion: None,
            }
        }
    }
}

fn run_integration(
    loaded: Arc<Loaded>,
    request: &onegit_git::IntegrationRequest,
    peers: &[Arc<onegit_git::Repository>],
) -> Outcome {
    let result = loaded.repository.integrate_branch(request, None);

    let recovery = match &result {
        Ok(result) => Some(result.recovery_ref.clone()),
        Err(error) => error.recovery_ref.clone(),
    };

    let result = result
        .map(|result| onegit_git::BranchMutation {
            branches: result.branches,
            snapshot: result.snapshot,
            saved_changes: None,
        })
        .map_err(|error| {
            onegit_git::BranchError::from(onegit_git::WriteError {
                phase: error.phase,
                error: error.error,
            })
        });

    let mut outcome = branch_outcome(loaded, result, None, peers);

    let paused = outcome
        .loaded
        .as_ref()
        .is_ok_and(|source| source.snapshot.operation != onegit_git::OperationState::Normal);

    let failed_refresh = outcome
        .branch_action
        .as_ref()
        .is_some_and(|event| event.snapshots.iter().any(|(_, source)| source.is_err()));

    let completion = outcome
        .branch_action
        .as_mut()
        .expect("branch outcome has completion");

    completion.integration = Some(request.kind);
    completion.needs_review = outcome.result.is_err() && (!paused || failed_refresh);

    if let Ok(detail) = &mut outcome.result {
        *detail = match request.kind {
            onegit_git::IntegrationKind::Merge => "Merge completed",
            onegit_git::IntegrationKind::Rebase => "Rebase completed",
            onegit_git::IntegrationKind::SquashMerge => "Squash merge completed",
        }
        .into();
    }

    if let Some(reference) = recovery {
        match &mut outcome.result {
            Ok(detail) | Err(detail) => {
                detail.push_str("\nRecovery ref: ");
                detail.push_str(&reference);
            }
        }
    }

    outcome
}

fn run_branch(
    loaded: Arc<Loaded>,
    request: &onegit_git::BranchRequest,
    peers: &[Arc<onegit_git::Repository>],
) -> Outcome {
    let repository = &loaded.repository;

    let result = repository.change_branch(request, None);

    branch_outcome(loaded, result, Some(&request.action), peers)
}

fn branch_outcome(
    loaded: Arc<Loaded>,
    result: Result<onegit_git::BranchMutation, onegit_git::BranchError>,
    action: Option<&onegit_git::BranchAction>,
    peers: &[Arc<onegit_git::Repository>],
) -> Outcome {
    let repository = &loaded.repository;

    let editing = matches!(
        action,
        Some(onegit_git::BranchAction::Rename { .. } | onegit_git::BranchAction::Delete { .. })
    );

    let mut needs_review = editing
        && result.as_ref().err().is_some_and(|error| {
            error.failure.phase != WritePhase::BeforeCommand
                || matches!(
                    error.failure.error,
                    onegit_git::RepositoryError::Conflict(_)
                )
        });

    let change = if result.is_ok() {
        match action {
            Some(onegit_git::BranchAction::Rename { name, new_name, .. }) => {
                Some(super::branches::RefChange::Rename {
                    from: format!("refs/heads/{name}"),
                    to: format!("refs/heads/{new_name}"),
                })
            }
            Some(onegit_git::BranchAction::Delete { name, .. }) => Some(
                super::branches::RefChange::Delete(format!("refs/heads/{name}")),
            ),
            _ => None,
        }
    } else {
        None
    };

    let acknowledged = result.is_ok();

    let mut outcome = match result {
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
                staging_completion: None,
                replay_completion: None,
                recovery_completion: None,
                committed: false,
                branch_action: None,
                stash_completion: None,
                discard_completion: None,
                conflict_completion: None,
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
                staging_completion: None,
                replay_completion: None,
                recovery_completion: None,
                committed: false,
                branch_action: None,
                stash_completion: None,
                discard_completion: None,
                conflict_completion: None,
            }
        }
    };

    let mut snapshots = vec![(repository.info().root.clone(), outcome.loaded.clone())];

    for peer in peers {
        if snapshots.iter().any(|(root, _)| root == &peer.info().root) {
            continue;
        }

        let loaded = peer
            .snapshot(false, None)
            .map(|snapshot| read::from_snapshot(peer.clone(), snapshot))
            .map_err(read::message);

        snapshots.push((peer.info().root.clone(), loaded));
    }

    let failed = snapshots.iter().any(|(_, loaded)| loaded.is_err());

    needs_review |= editing && acknowledged && failed;

    if acknowledged && failed {
        outcome.result=Err("The branch was updated, but a related worktree could not be refreshed. Inspect Branches and refresh before writing again.".into());
    }

    outcome.branch_action = Some(super::branches::WriteResult {
        worktree: None,
        integration: None,
        change,
        snapshots,
        needs_review,
    });

    outcome
}

fn run_stash(
    loaded: Arc<Loaded>,
    request: &onegit_git::StashRequest,
    peers: &[Arc<onegit_git::Repository>],
) -> Outcome {
    use onegit_git::{Failure, StashAction};
    let operation = match request.action {
        StashAction::Save { .. } => onegit_git::Operation::Stash,
        StashAction::Apply(_) => onegit_git::Operation::ApplyStash,
        StashAction::Pop(_) => onegit_git::Operation::PopStash,
        StashAction::Delete(_) => onegit_git::Operation::DropStash,
    };

    let result=loaded.repository.change_stash(request,None).map(|_|()).map_err(|error|{
        let failure=Failure::from_repository(operation,&error.error);
        let boundary=match error.phase{WritePhase::BeforeCommand=>"The stash action did not start.",WritePhase::Command=>"Git may have made partial changes. Review the refreshed files and saved stashes before trying again.",WritePhase::Refresh=>"Saved work may already have changed. Refresh and review before submitting again."};

        format!("{}\n{}\n{boundary}",failure.message,failure.details.unwrap_or_default())
    });

    // Status reads reveal partial effects; the accepted action is never repeated.
    let mut repositories = peers.to_vec();

    if !repositories
        .iter()
        .any(|repo| repo.info().root == loaded.snapshot.repository.root)
    {
        repositories.push(loaded.repository.clone());
    }

    let snapshots: Vec<_> = repositories
        .into_iter()
        .map(|repo| {
            let root = repo.info().root.clone();

            let snapshot = repo
                .snapshot(false, None)
                .map(|snapshot| read::from_snapshot(repo, snapshot))
                .map_err(|error| {
                    let failure =
                        Failure::from_repository(onegit_git::Operation::GetSnapshot, &error);

                    format!(
                        "{} {}",
                        failure.message,
                        failure.details.unwrap_or_default()
                    )
                });

            (root, snapshot)
        })
        .collect();

    let refreshed = snapshots
        .iter()
        .find(|(root, _)| *root == loaded.snapshot.repository.root)
        .expect("origin refresh exists")
        .1
        .clone();

    let result = if result.is_ok() && snapshots.iter().any(|(_, snapshot)| snapshot.is_err()) {
        Err("Git completed the stash action, but a related repository could not be refreshed. Review it before writing again.".into())
    } else {
        result
    };

    let applied = matches!(request.action, StashAction::Apply(_) | StashAction::Pop(_));

    let message = match request.action {
        StashAction::Save { .. } => "Changes saved to stash",
        StashAction::Apply(_) => "Stash applied; saved copy kept",
        StashAction::Pop(_) => "Stash applied and removed",
        StashAction::Delete(_) => "Stash deleted",
    };

    Outcome {
        loaded: refreshed,
        result: result.clone().map(|()| message.into()),
        staging_completion: None,
        replay_completion: None,
        recovery_completion: None,
        committed: false,
        branch_action: None,
        discard_completion: None,
        conflict_completion: None,
        stash_completion: Some(super::stashes::Completed {
            snapshots,
            result,
            applied,
        }),
    }
}
