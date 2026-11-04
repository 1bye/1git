//! The existing library owns ref/index transactions; failures never replay history edits.
use super::{Action, Completed, Effect};
use crate::workspace::{read, write};
use onegit_git::{CommitFiles, CommitOutcome, Repository, WritePhase};
use std::sync::Arc;

pub(in crate::workspace) fn run(
    source: Arc<read::Loaded>,
    action: &Action,
    peers: &[Arc<Repository>],
) -> write::Outcome {
    let mut effect = Effect::Unchanged;
    let mut needs_review = false;

    let result = (|| {
        if !action.review().matches(&source) {
            return Err(
                "The repository or last commit changed. Cancel and review it again.".to_owned(),
            );
        }

        let repository = &source.repository;

        let guard = |error: onegit_git::CommitError| {
            let after = error.phase != WritePhase::BeforeCommand;

            let message = if let Some(details) = &error.failure.details {
                format!("{error}\n{details}")
            } else {
                error.to_string()
            };

            (
                after,
                format!(
                    "{}\n{}",
                    message,
                    if after {
                        "The result needs review. Inspect History and refresh; do not automatically retry."
                    } else {
                        "Nothing was changed. Cancel and review the last commit again."
                    }
                ),
            )
        };

        match action {
            Action::Amend {
                review,
                message,
                mode,
            } => {
                let mut input = CommitFiles::new(Vec::new(), message.clone(), &source.snapshot);

                input.expected = review.expected.clone();
                input.amend = true;
                input.mode = *mode;

                match repository.commit_selected_files(&input, None) {
                    Ok(result) => {
                        effect = if result.outcome == CommitOutcome::Committed {
                            Effect::Amended
                        } else {
                            Effect::Unchanged
                        };
                        needs_review = result.outcome != CommitOutcome::Committed
                            || result.warning.is_some()
                            || result.snapshot.is_none();

                        if needs_review {
                            Err(result.warning.unwrap_or_else(||"The amend result is uncertain. Inspect History and refresh before writing again.".into()))
                        } else {
                            Ok("Last commit amended. The previous commit is retained in a recovery ref.".into())
                        }
                    }
                    Err(error) => {
                        let (review, message) = guard(error);

                        needs_review = review;

                        Err(message)
                    }
                }
            }
            Action::Undo(review) => match repository.undo_last_commit(&review.expected, None) {
                Ok(result) => {
                    effect = Effect::Undone(result.message);
                    needs_review = result.warning.is_some() || result.snapshot.is_none();
                    let retained = format!("Recovery ref: {}", result.recovery_ref);

                    if let Some(warning) = result.warning {
                        Err(format!("{warning}\n{retained}"))
                    } else {
                        Ok(format!(
                            "Last commit undone. Working files and staging were kept.\n{retained}"
                        ))
                    }
                }
                Err(error) => {
                    let (review, message) = guard(error);

                    needs_review = review;

                    Err(message)
                }
            },
        }
    })();

    let mut repositories = peers.to_vec();

    if !repositories
        .iter()
        .any(|r| r.info().root == source.snapshot.repository.root)
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
        .expect("origin refresh is included")
        .1
        .clone();

    if snapshots.iter().any(|(_, loaded)| loaded.is_err()) {
        needs_review = true;
    }

    let result = if needs_review && result.is_ok() {
        Err("Git completed, but a related repository could not be refreshed. Inspect History and refresh before writing again.".into())
    } else {
        result
    };

    write::Outcome {
        loaded,
        result: result.clone(),
        committed: false,
        branch_action: None,
        staging_completion: None,
        stash_completion: None,
        discard_completion: None,
        conflict_completion: None,
        replay_completion: None,
        recovery_completion: Some(Completed {
            snapshots,
            effect,
            needs_review,
            result: result.map(|_| ()),
        }),
    }
}
