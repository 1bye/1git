//! Accepted worktree writes use the repository mutation guard, then reread each surviving root.
use super::Change;

use crate::workspace::{
    branches,
    read::{self, Loaded},
    write::Outcome,
};

use onegit_git::{GitProcess, Repository, WorktreeRequest, WritePhase};
use std::sync::Arc;

pub(in crate::workspace) fn run(
    loaded: Arc<Loaded>,
    request: &WorktreeRequest,
    peers: &[Arc<Repository>],
    process: &GitProcess,
) -> Outcome {
    let repository = &loaded.repository;
    let result = repository.change_worktree(request, None);

    // Before-command refusals can be corrected; immutable source/target checks run on each submit.
    let needs_review = result
        .as_ref()
        .err()
        .is_some_and(|error| error.phase != WritePhase::BeforeCommand);

    let change = result.as_ref().ok().map(|result| match request {
        WorktreeRequest::Create { .. } => Change::Created(result.path.clone()),
        WorktreeRequest::Move { path, .. } => Change::Moved {
            from: path.clone(),
            to: result.path.clone(),
        },
        WorktreeRequest::Remove { path, .. } => Change::Removed(path.clone()),
    });

    let acknowledged = change.is_some();

    let (fresh, mut feedback) = match result {
        Ok(result) => (
            Ok(read::from_snapshot(repository.clone(), result.snapshot)),
            Ok("Worktree updated".to_owned()),
        ),
        Err(error) => {
            let boundary = match error.phase {
                WritePhase::BeforeCommand => "The worktree operation did not start.",
                WritePhase::Command => {
                    "Git may have made partial changes. Inspect the worktree folders and refresh before trying again."
                }
                WritePhase::Refresh => {
                    "Git completed the write, but its result could not be confirmed. Inspect the worktree folders before trying again."
                }
            };

            (
                repository
                    .snapshot(false, None)
                    .map(|snapshot| read::from_snapshot(repository.clone(), snapshot))
                    .map_err(read::message),
                Err(format!("{}\n{boundary}", read::message(error.error))),
            )
        }
    };

    let mut snapshots = vec![(repository.info().root.clone(), fresh.clone())];

    for peer in peers {
        let root = &peer.info().root;

        if snapshots.iter().any(|(path, _)| path == root)
            || matches!(&change,Some(Change::Removed(path)) if path==root)
            || matches!(&change,Some(Change::Moved{from,..}) if from==root)
        {
            continue;
        }

        snapshots.push((
            root.clone(),
            peer.snapshot(false, None)
                .map(|snapshot| read::from_snapshot(peer.clone(), snapshot))
                .map_err(read::message),
        ));
    }

    if let Some(Change::Moved { to, .. }) = &change {
        let new=read::load(to,process.clone(),&onegit_git::Cancellation::default()).and_then(|new|{
            if new.snapshot.repository.root!=*to||new.snapshot.repository.common_directory!=loaded.snapshot.repository.common_directory {Err("The moved worktree folder changed. Review its destination before continuing.".into())}else{Ok(new)}
        });

        snapshots.push((to.clone(), new));
    }

    let failed = snapshots.iter().any(|(_, result)| result.is_err());

    if acknowledged && failed {
        feedback=Err("The worktree was updated, but a related checkout could not be refreshed. Inspect the folders and refresh before writing again.".into());
    }

    Outcome {
        loaded: fresh,
        result: feedback,
        committed: false,
        replay_completion: None,
        recovery_completion: None,
        staging_completion: None,
        stash_completion: None,
        discard_completion: None,
        conflict_completion: None,
        branch_action: Some(branches::WriteResult {
            integration: None,
            change: None,
            worktree: change,
            snapshots,
            needs_review: needs_review || (acknowledged && failed),
        }),
    }
}
