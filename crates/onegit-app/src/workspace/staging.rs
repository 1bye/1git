//! Frozen partial-index actions and shared repository refresh.
use super::{ChangeKey, Preview, PreviewState, RepositoryState, RepositoryWorkspace, read, write};
use onegit_git::{BranchIdentity, ChangeLines, GitPath, LineAction, Repository, WritePhase};
use onegit_ui::{DiffStageRequest, Toast, ToastKind};
use rake::gpui;
use std::{path::PathBuf, sync::Arc};

#[derive(Clone, Debug)]
pub(super) struct Action {
    pub root: PathBuf,
    pub path: GitPath,
    pub expected: BranchIdentity,
    pub patch: String,
    pub lines: Vec<String>,
    pub direction: LineAction,
}

pub(super) struct Submit(pub Action);

pub(super) struct Completed {
    pub snapshots: Vec<(PathBuf, Result<Arc<read::Loaded>, String>)>,
}

impl gpui::EventEmitter<Submit> for RepositoryWorkspace {}

impl gpui::EventEmitter<Completed> for RepositoryWorkspace {}

impl RepositoryWorkspace {
    pub(super) fn staging_error(
        &self,
        message: &str,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        self.toasts.update(cx, |toasts, cx| {
            toasts.show(
                Toast {
                    description: Some(message.to_owned().into()),
                    ..Toast::new(ToastKind::Error, "Could not update selected changes")
                },
                window,
                cx,
            );
        });
    }

    pub(super) fn stage_diff(
        &mut self,
        key: &ChangeKey,
        root: &std::path::Path,
        expected: &BranchIdentity,
        request: &DiffStageRequest,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if !self.can_write() || self.diff_job.is_some() || self.load_job.is_some() {
            return;
        }

        let RepositoryState::Ready(loaded) = &self.state else {
            return;
        };

        if loaded.snapshot.repository.root != root
            || self.selected.as_ref() != Some(key)
            || BranchIdentity::from_snapshot(&loaded.snapshot) != *expected
            || !matches!(&self.preview,PreviewState::Ready(Preview::Patch { document: doc, .. }) if doc.patch()==request.document.patch())
        {
            self.staging_error(
                "The diff changed. Refresh and review it before staging.",
                window,
                cx,
            );

            return;
        }

        let action = Action {
            root: root.to_owned(),
            path: key.path.clone(),
            expected: expected.clone(),
            patch: request.document.patch().to_owned(),
            lines: request.lines.clone(),
            direction: if key.side == read::Side::Staged {
                LineAction::Unstage
            } else {
                LineAction::Stage
            },
        };

        if self.hosted {
            cx.emit(Submit(action));
        } else {
            self.start_write(
                write::Operation::Lines {
                    action,
                    peers: Vec::new(),
                },
                window,
                cx,
            );
        }
    }
}

pub(super) fn run(
    loaded: Arc<read::Loaded>,
    action: &Action,
    peers: &[Arc<Repository>],
) -> write::Outcome {
    let result = if loaded.snapshot.repository.root != action.root {
        Err("The tab opened another repository. Review its diff before staging.".into())
    } else {
        loaded.repository.change_lines(ChangeLines{path:&action.path,expected:&action.expected,expected_patch:&action.patch,lines:&action.lines,action:action.direction},None)
        .map(|_|()).map_err(|error|{
            let boundary=match error.phase {WritePhase::BeforeCommand=>"Nothing was staged. Refresh and review before trying again.",
                WritePhase::Command=>"The index may have changed. Review the refreshed repository before trying again.",
                WritePhase::Refresh=>"Git updated the index, but its result could not be confirmed. Refresh before writing again."};

            format!("{}\n{boundary}",read::message(error.error))
        })
    };

    let mut repositories = peers.to_vec();

    if !repositories
        .iter()
        .any(|r| r.info().root == loaded.snapshot.repository.root)
    {
        repositories.push(loaded.repository.clone());
    }

    let snapshots: Vec<_> = repositories
        .into_iter()
        .map(|repository| {
            let root = repository.info().root.clone();

            let result = repository
                .snapshot(false, None)
                .map(|s| read::from_snapshot(repository, s))
                .map_err(read::message);

            (root, result)
        })
        .collect();

    let origin = snapshots
        .iter()
        .find(|(root, _)| *root == loaded.snapshot.repository.root)
        .expect("origin refresh exists")
        .1
        .clone();

    let result = if result.is_ok() && snapshots.iter().any(|(_, r)| r.is_err()) {
        Err("Git updated the index, but a related repository could not be refreshed. Refresh before writing again.".into())
    } else {
        result
    };

    write::Outcome {
        loaded: origin,
        result: result.clone().map(|()| {
            if action.direction == LineAction::Stage {
                "Selected changes staged".into()
            } else {
                "Selected changes unstaged".into()
            }
        }),
        committed: false,
        branch_action: false,
        stash_completion: None,
        discard_completion: None,
        conflict_completion: None,
        staging_completion: Some(Completed { snapshots }),
    }
}
