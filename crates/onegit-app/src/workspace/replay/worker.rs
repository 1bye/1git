//! Replay once; a failed command remains inspectable on its destination.
use super::{Action, Completed, Kind};

use crate::workspace::{
    read::{self, Loaded},
    write::Outcome,
};

use onegit_git::{CherryPickCommit, Repository, WritePhase};
use std::sync::Arc;

pub(in crate::workspace) fn run(
    source: Arc<Loaded>,
    action: &Action,
    peers: &[Arc<Repository>],
) -> Outcome {
    let mut started = false;
    let mut needs_review = false;
    let history_edit = action.kind() == Kind::Reset || action.kind().is_rewrite();
    let mut recovery = None;

    let result = if !action.review().matches(&source) {
        Err("The repository or branch changed. Cancel and review the commit again.".to_owned())
    } else if let Action::Reset(review) = action {
        match source
            .repository
            .reset_to_commit(&review.reset_request(), None)
        {
            Ok(result) => {
                started = true;
                needs_review = result.warning.is_some() || result.snapshot.is_none();
                recovery = Some(format!("Recovery ref: {}", result.recovery_ref));

                if needs_review {
                    Err(result.warning.unwrap_or_else(|| "The reset result could not be confirmed. Inspect History and refresh before writing again.".into()))
                } else {
                    Ok("History reset. Working files and staging were kept.".to_owned())
                }
            }
            Err(error) => {
                started = error.phase != WritePhase::BeforeCommand;
                needs_review = started;

                Err(format!(
                    "{}\n{}",
                    read::message(error.error),
                    if started {
                        "The reset result needs review. Inspect History and refresh; do not repeat this request."
                    } else {
                        "The reset did not start. Cancel and review the commit again."
                    }
                ))
            }
        }
    } else if action.kind().is_rewrite() {
        let result = match action {
            Action::Squash {
                review,
                message,
                cancel,
            } => source
                .repository
                .squash_commits(&review.squash(message.clone()), Some(cancel)),
            Action::Reorder {
                review,
                order,
                cancel,
            } => source
                .repository
                .reorder_commits(&review.reorder(order.clone()), Some(cancel)),
            _ => unreachable!("reviewed range edit"),
        };

        match result {
            Ok(result) => {
                started = true;
                needs_review = result.warning.is_some() || result.snapshot.is_none();
                recovery = Some(format!("Recovery ref: {}", result.recovery_ref));

                if needs_review {
                    Err(result.warning.unwrap_or_else(||"The history edit result could not be confirmed. Inspect History and refresh before writing again.".into()))
                } else {
                    Ok(match action {
                        Action::Squash { review, .. } => format!(
                            "Squashed {} commits. Files and staging were kept.",
                            review.commits.len()
                        ),
                        Action::Reorder { review, .. } => format!(
                            "Reordered {} commits. Files and staging were kept.",
                            review.commits.len()
                        ),
                        _ => unreachable!("reviewed range edit"),
                    })
                }
            }
            Err(error) => {
                started = error.phase != WritePhase::BeforeCommand;
                needs_review = started;

                Err(format!(
                    "{}\n{}",
                    read::message(error.error),
                    if started {
                        "Inspect History and refresh before writing again. Do not repeat this request."
                    } else {
                        "The history edit did not start. Cancel and review the commits again."
                    }
                ))
            }
        }
    } else {
        let result = match action {
            Action::CherryPick {
                review,
                destination: (branch, oid),
            } => source.repository.cherry_pick_commit(
                &CherryPickCommit {
                    review: review.request(),
                    target_branch: branch.clone(),
                    expected_target: oid.clone(),
                },
                None,
            ),
            Action::Revert(review) => source.repository.revert_commit(&review.request(), None),
            Action::Reset(_) | Action::Squash { .. } | Action::Reorder { .. } => {
                unreachable!("history edits handled above")
            }
        };

        started = result
            .as_ref()
            .map_or_else(|error| error.phase != WritePhase::BeforeCommand, |_| true);

        result.map(|_| match action.kind() {
            Kind::CherryPick => "Commit copied to the destination branch.".to_owned(),
            Kind::Revert => "A new commit reverses the selected changes; existing history is intact.".to_owned(),
            Kind::Reset|Kind::Squash|Kind::Reorder => unreachable!("history edits handled above"),
        }).map_err(|error| {
            let boundary = match error.phase {
                WritePhase::BeforeCommand => "The operation did not start. Cancel and review the commit again.",
                WritePhase::Command => "Git may have switched branches or paused with conflicts. Inspect Changes and use Continue or Abort; do not replay this request.",
                WritePhase::Refresh => "Git completed the operation, but its result could not be confirmed. Refresh and inspect Changes before writing again.",
            };

            format!("{}\n{boundary}", read::message(error.error))
        })
    };

    let mut repositories = peers.to_vec();

    if !repositories
        .iter()
        .any(|repo| repo.info().root == source.snapshot.repository.root)
    {
        repositories.push(source.repository.clone());
    }

    let snapshots: Vec<_> = repositories
        .into_iter()
        .map(|repository| {
            let root = repository.info().root.clone();

            let loaded = repository
                .snapshot(false, None)
                .map(|snapshot| read::from_snapshot(repository, snapshot))
                .map_err(read::message);

            (root, loaded)
        })
        .collect();

    let loaded = snapshots
        .iter()
        .find(|(root, _)| *root == source.snapshot.repository.root)
        .expect("origin refresh exists")
        .1
        .clone();

    let refresh_failed = snapshots.iter().any(|(_, loaded)| loaded.is_err());

    needs_review |= history_edit && started && refresh_failed;
    let result = if result.is_ok() && refresh_failed {
        Err("Git completed, but a related repository could not be refreshed. Inspect Changes before writing again.".into())
    } else {
        result
    };

    // Retain the acknowledged recovery ref even when the subsequent refresh fails.
    let result = match (result, recovery) {
        (Ok(message), Some(recovery)) => Ok(format!("{message}\n{recovery}")),
        (Err(message), Some(recovery)) => Err(format!("{message}\n{recovery}")),
        (result, None) => result,
    };

    Outcome {
        loaded,
        result: result.clone(),
        committed: false,
        branch_action: false,
        recovery_completion: None,
        staging_completion: None,
        stash_completion: None,
        conflict_completion: None,
        discard_completion: None,
        replay_completion: Some(Completed {
            snapshots,
            result: result.map(|_| ()),
            started,
            kind: action.kind(),
            needs_review,
        }),
    }
}
