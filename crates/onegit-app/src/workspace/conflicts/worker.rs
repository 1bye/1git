//! Accepted actions run once, then refresh every distinct related worktree.
use super::{Action, Completed};

use crate::workspace::{
    read::{self, Loaded},
    write::Outcome,
};

use onegit_git::{Repository, WritePhase};
use std::sync::Arc;

pub(in crate::workspace) fn run(
    loaded: Arc<Loaded>,
    action: &Action,
    peers: &[Arc<Repository>],
) -> Outcome {
    let result = match action {
        Action::Resolve { request, review, .. } => loaded.repository.resolve_reviewed_conflict(request, review, None),
        Action::Finish(request) => loaded.repository.finish_operation(request, None),
    }.map(|_| ()).map_err(|error| {
        let boundary = match error.phase {
            WritePhase::BeforeCommand => "The action did not start. Refresh and review before trying again.",
            WritePhase::Command => "Git may have made partial changes or paused again. Review the refreshed repository before doing anything else.",
            WritePhase::Refresh => "Git completed the action, but its result could not be confirmed. Refresh and review before writing again.",
        };

        format!("{}\n{boundary}", read::message(error.error))
    });

    let mut repositories = peers.to_vec();

    if !repositories
        .iter()
        .any(|repo| repo.info().root == loaded.snapshot.repository.root)
    {
        repositories.push(loaded.repository.clone());
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

    let origin = snapshots
        .iter()
        .find(|(root, _)| *root == loaded.snapshot.repository.root)
        .expect("origin refresh exists")
        .1
        .clone();

    let result = if result.is_ok() && snapshots.iter().any(|(_, result)| result.is_err()) {
        Err("Git completed the action, but a related repository could not be refreshed. Refresh before writing again.".into())
    } else {
        result
    };

    let detail = match action {
        Action::Resolve { .. } => "File marked resolved. Continue the operation separately.".into(),
        Action::Finish(request) if request.kind == onegit_git::FinishKind::Abort => {
            "Git operation aborted".into()
        }
        Action::Finish(_) => {
            if origin
                .as_ref()
                .is_ok_and(|source| source.snapshot.operation == onegit_git::OperationState::Normal)
            {
                "Git operation completed".into()
            } else {
                "Git paused again. Review the current conflicts before continuing.".into()
            }
        }
    };

    Outcome {
        loaded: origin,
        result: result.clone().map(|()| detail),
        committed: false,
        branch_action: false,
        stash_completion: None,
        discard_completion: None,
        conflict_completion: Some(Completed { snapshots, result }),
    }
}
