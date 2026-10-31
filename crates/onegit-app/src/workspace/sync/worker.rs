//! Transport stays off the UI thread; failures and cancellation still reread each worktree.
use super::super::read::{self, Loaded};
use super::{Action, Request, model};

use onegit_git::{
    Cancellation, FetchOptions, Remote, Repository, RepositoryError, SyncBranch, SyncKind,
    TransferPhase, TransferProgress, WriteError, WritePhase,
};

use std::{path::PathBuf, sync::Arc};

pub(in crate::workspace) struct Completed {
    pub result: Result<(), String>,
    pub snapshots: Vec<(PathBuf, Result<Arc<Loaded>, String>)>,
}

fn before(error: RepositoryError) -> WriteError {
    WriteError {
        phase: WritePhase::BeforeCommand,
        error,
    }
}

fn transfer(
    request: &Request,
    cancel: &Cancellation,
    progress: &dyn Fn(TransferProgress),
) -> Result<(), WriteError> {
    let repository = &request.review.loaded.repository;

    if let Some(message) = request.review.blocked(request.action) {
        return Err(before(RepositoryError::InvalidInput(message)));
    }

    let remotes = repository.remotes(Some(cancel)).map_err(before)?;

    let same = |current: &Remote, reviewed: &Remote| {
        current.name == reviewed.name
            && if matches!(request.action, Action::Fetch | Action::Pull) {
                current.fetch_urls == reviewed.fetch_urls
            } else {
                current.push_urls == reviewed.push_urls
            }
    };

    // Consent names an effective destination, not just a mutable remote alias.
    let unchanged = if request.action == Action::Fetch {
        remotes.len() == request.review.remotes.len()
            && request
                .review
                .remotes
                .iter()
                .all(|remote| remotes.iter().any(|current| same(current, remote)))
    } else {
        request
            .remote
            .as_ref()
            .is_some_and(|chosen| remotes.iter().any(|remote| same(remote, chosen)))
    };

    if !unchanged {
        return Err(before(RepositoryError::InvalidInput(
            "The remote destination changed. Refresh and review it before trying again.",
        )));
    }

    if request.action == Action::Fetch {
        for remote in &request.review.remotes {
            repository.fetch(
                FetchOptions {
                    remote: Some(&remote.name),
                    on_progress: Some(progress),
                    ..Default::default()
                },
                Some(cancel),
            )?;
        }
    } else {
        let remote = request.remote.as_ref().ok_or_else(|| {
            before(RepositoryError::InvalidInput(
                "Choose one remote destination.",
            ))
        })?;

        let reference = if request.action == Action::Publish {
            format!(
                "refs/heads/{}",
                request
                    .review
                    .branch
                    .as_ref()
                    .expect("reviewed local branch")
                    .name
            )
        } else {
            request
                .review
                .upstream()
                .ok_or_else(|| {
                    before(RepositoryError::InvalidInput(
                        "The upstream is unavailable.",
                    ))
                })?
                .1
                .to_owned()
        };

        repository.sync_branch(
            SyncBranch {
                kind: match request.action {
                    Action::Pull => SyncKind::Pull,
                    Action::Push => SyncKind::Push,
                    Action::Publish => SyncKind::Publish,
                    Action::Fetch => unreachable!("fetch handled above"),
                },
                expected: &request.review.identity(),
                remote: &remote.name,
                remote_ref: &reference,
                authentication: None,
                on_progress: Some(progress),
            },
            Some(cancel),
        )?;
    }

    Ok(())
}

pub(super) fn run(
    request: &Request,
    peers: Vec<Arc<Repository>>,
    cancel: &Cancellation,
    progress: &dyn Fn(TransferProgress),
) -> Completed {
    let result=transfer(request,cancel,progress).map_err(|error| {
        let boundary=match error.phase {
            WritePhase::BeforeCommand=>"The operation did not start.",
            WritePhase::Command=>"Git may have made partial changes, or the remote may have accepted the write. Review local and remote status before trying again.",
            WritePhase::Refresh=>"Git completed the operation but its result could not be confirmed. Review local and remote status before trying again.",
        };

        let branch=request.review.identity().branch.unwrap_or_else(||"Detached HEAD".into());

        format!("{} · {branch}\n{}\n{boundary}",request.action.label(),model::failure(request.action.operation(),&error.error))
    });

    progress(TransferProgress {
        phase: TransferPhase::Refreshing,
        percent: None,
    });
    // Cancellation never skips status recovery or reuses another worktree's files/index.
    let snapshots = peers
        .into_iter()
        .map(|repository| {
            let root = repository.info().root.clone();

            let loaded = repository
                .snapshot(false, None)
                .map(|snapshot| read::from_snapshot(repository, snapshot))
                .map_err(|error| model::failure(onegit_git::Operation::GetSnapshot, &error));

            (root, loaded)
        })
        .collect();

    Completed { result, snapshots }
}
