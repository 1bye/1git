//! Configuration and subsequent reads share owned task lifetime; no failed write is replayed.
use super::{Request, Review};
use crate::workspace::read::{self, Loaded};
use onegit_git::{Repository, RepositoryError, SettingsChange, WritePhase};
use std::{path::PathBuf, sync::Arc};

pub(in crate::workspace) struct Completed {
    pub result: Result<Review, String>,
    pub snapshots: Vec<(PathBuf, Result<Arc<Loaded>, String>)>,
    pub needs_review: bool,
}

pub(super) fn run(request: Request, peers: Vec<Arc<Repository>>) -> Completed {
    let result = match (&request.source, &request.review, &request.change) {
        (Some(source), Review::Repository(review), change) => source
            .repository
            .change_git_settings(review, change, None)
            .map(Review::Repository),
        (None, Review::Global(review), SettingsChange::Identity(Some(identity))) => request
            .global
            .write(review, identity, None)
            .map(Review::Global),
        _ => {
            return Completed {
                result: Err("Settings context changed. Reload before saving.".into()),
                snapshots: Vec::new(),
                needs_review: true,
            };
        }
    };

    let mut needs_review = result.as_ref().err().is_some_and(|error| {
        error.phase != WritePhase::BeforeCommand
            || !matches!(error.error, RepositoryError::InvalidInput(_))
    });

    let result = result.map_err(|error| {
        let boundary = if !needs_review {
            "No settings were written. Correct the form and try again."
        } else if error.phase == WritePhase::BeforeCommand {
            "No settings were written. Reload and review before saving."
        } else {
            "Some settings may have changed. Reload and inspect Git configuration before trying again."
        };

        format!("{}\n{boundary}", read::message(error.error))
    });

    let snapshots = peers
        .into_iter()
        .map(|repo| {
            let root = repo.info().root.clone();

            let loaded = repo
                .snapshot(false, None)
                .map(|snapshot| read::from_snapshot(repo, snapshot))
                .map_err(read::message);

            (root, loaded)
        })
        .collect::<Vec<_>>();

    let result = if result.is_ok() && snapshots.iter().any(|(_, result)| result.is_err()) {
        needs_review = true;

        Err("Git settings were saved, but a related checkout could not be refreshed. Reload and inspect it before writing again.".into())
    } else {
        result
    };

    Completed {
        result,
        snapshots,
        needs_review,
    }
}
