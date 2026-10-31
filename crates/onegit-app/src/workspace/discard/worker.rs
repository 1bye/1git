//! Worker-owned disk recovery precedes destructive application; every outcome refreshes peers.
use super::{Action, Completed, Recovery};

use crate::workspace::{
    read::{self, Loaded},
    write::Outcome,
};

use onegit_git::{DiscardError, DiscardFiles, DiscardRecovery, Repository, WritePhase};
use std::{path::Path, sync::Arc};

fn failure(error: DiscardError) -> String {
    let boundary = match error.phase {
        WritePhase::BeforeCommand => "The operation did not start.",
        WritePhase::Command => {
            "Some files may already have changed. Review the refreshed files before doing anything else."
        }
        WritePhase::Refresh => {
            "The write completed but its result could not be confirmed. Refresh and review before writing again."
        }
    };

    let mut detail = format!("{}\n{boundary}", read::message(error.error));

    if let Some(rollback) = error.rollback_error {
        detail.push_str(&format!(
            "\nCompensation also failed: {}",
            read::message(*rollback)
        ));
    }

    if let Some(backup) = error.recovery {
        detail.push_str(&format!(
            "\n{}: {}",
            if backup.complete {
                "Recovery backup"
            } else {
                "Partial recovery files"
            },
            backup.directory.display()
        ));
    }

    detail
}

fn destination(parent: &Path) -> Result<std::path::PathBuf, String> {
    std::fs::create_dir_all(parent).map_err(|error| {
        format!("Could not prepare recovery storage: {error}. Nothing was discarded.")
    })?;
    let directory = tempfile::Builder::new()
        .prefix("discard-")
        .tempdir_in(parent)
        .map_err(|error| {
            format!("Could not prepare recovery storage: {error}. Nothing was discarded.")
        })?;

    // Let the Git API create and sync the recovery entry directly under its durable parent.
    let path = directory.path().to_owned();

    directory.close().map_err(|error| {
        format!("Could not prepare recovery storage: {error}. Nothing was discarded.")
    })?;

    Ok(path)
}

pub(in crate::workspace) fn run(
    loaded: Arc<Loaded>,
    action: &Action,
    peers: &[Arc<Repository>],
) -> Outcome {
    let mut recovery = None;

    let restored = match action {
        Action::Restore(saved) => Some(saved.undo.token.clone()),
        Action::Discard { .. } => None,
    };

    let result = match action {
        Action::Discard { selection, parent } => destination(parent).and_then(|directory| {
            loaded
                .repository
                .discard_reviewed(
                    &DiscardFiles {
                        paths: selection.paths.clone(),
                        allow_destructive: true,
                        recovery: Some(DiscardRecovery {
                            directory,
                            expected: selection.source.clone(),
                        }),
                    },
                    selection.scope,
                    None,
                )
                .map(|result| {
                    recovery = Some(Recovery {
                        repository: loaded.repository.clone(),
                        source: selection.source.clone(),
                        undo: result.undo,
                        backup: result.recovery,
                    });
                })
                .map_err(failure)
        }),
        Action::Restore(saved) => {
            if saved.repository.info().root != loaded.snapshot.repository.root {
                Err("This recovery belongs to a different repository. Nothing was restored.".into())
            } else {
                saved
                    .repository
                    .restore_discard(&saved.undo.token, &saved.source, None)
                    .map(|_| ())
                    .map_err(|error| {
                        format!(
                            "{}\nRecovery backup: {}",
                            failure(error),
                            saved.backup.directory.display()
                        )
                    })
            }
        }
    };

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
                .map_err(read::message);

            (root, snapshot)
        })
        .collect();

    let loaded = snapshots
        .iter()
        .find(|(root, _)| *root == loaded.snapshot.repository.root)
        .expect("origin refresh exists")
        .1
        .clone();

    let result = if result.is_ok() && snapshots.iter().any(|(_, snapshot)| snapshot.is_err()) {
        Err("The file operation completed, but a related repository could not be refreshed. Review it before writing again.".into())
    } else {
        result
    };

    let detail = if restored.is_some() {
        "Discarded changes restored"
    } else {
        "Changes discarded"
    }
    .into();

    Outcome {
        loaded,
        result: result.clone().map(|()| detail),
        committed: false,
        branch_action: false,
        stash_completion: None,
        conflict_completion: None,
        discard_completion: Some(Completed {
            snapshots,
            result,
            recovery,
            restored,
        }),
    }
}
