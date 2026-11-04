//! Replay once; a failed command remains inspectable on its destination.
use super::{Action, Completed, Kind};

use crate::workspace::{
    read::{self, Loaded},
    write::Outcome,
};

use onegit_git::{Repository, WritePhase};
use std::sync::Arc;

pub(in crate::workspace) fn run(
    source: Arc<Loaded>,
    action: &Action,
    peers: &[Arc<Repository>],
) -> Outcome {
    let mut started = false;

    let result = if !action.review.matches(&source) {
        Err("The repository or branch changed. Cancel and review the commit again.".to_owned())
    } else {
        let result = if let Some(request) = action.cherry_pick() {
            source.repository.cherry_pick_commit(&request, None)
        } else {
            source
                .repository
                .revert_commit(&action.review.request(), None)
        };

        started = result
            .as_ref()
            .map_or_else(|error| error.phase != WritePhase::BeforeCommand, |_| true);

        result.map(|_| ()).map_err(|error| {
            let boundary = match error.phase {
                WritePhase::BeforeCommand => "The operation did not start. Cancel and review the commit again.",
                WritePhase::Command => "Git may have switched branches or paused with conflicts. Inspect Changes and use Continue or Abort; do not replay this request.",
                WritePhase::Refresh => "Git completed the operation, but its result could not be confirmed. Refresh and inspect Changes before writing again.",
            };

            format!("{}\n{boundary}",read::message(error.error))
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

    let result = if result.is_ok() && snapshots.iter().any(|(_, loaded)| loaded.is_err()) {
        Err("Git completed, but a related repository could not be refreshed. Inspect Changes before writing again.".into())
    } else {
        result
    };

    Outcome {
        loaded,
        result: result.clone().map(|_| {
            match action.kind() {
                Kind::CherryPick => "Commit copied to the destination branch.",
                Kind::Revert => {
                    "A new commit reverses the selected changes; existing history is intact."
                }
            }
            .into()
        }),
        committed: false,
        branch_action: false,
        recovery_completion: None,
        staging_completion: None,
        stash_completion: None,
        conflict_completion: None,
        discard_completion: None,
        replay_completion: Some(Completed {
            snapshots,
            result,
            started,
        }),
    }
}
