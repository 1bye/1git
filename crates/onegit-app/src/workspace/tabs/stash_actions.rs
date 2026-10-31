//! Stash mutations refresh each related worktree separately and retain every tab's local state.
use super::{RepositoryState, Workspace, gpui};
use crate::workspace::{stashes, write};
use std::{collections::HashMap, path::Path};

impl Workspace {
    pub(super) fn related(
        &self,
        root: &Path,
        cx: &gpui::App,
    ) -> Vec<gpui::Entity<super::RepositoryWorkspace>> {
        let roots = self.roots(cx);

        let common = roots
            .get(root)
            .map(|i| &i.common_directory)
            .or_else(|| self.monitors.get(root).map(|m| &m.info.common_directory));

        self.tabs
            .iter()
            .filter(|tab| {
                let view = tab.workspace.read(cx);

                let path = match &view.state {
                    RepositoryState::Ready(source) => &source.snapshot.repository.root,
                    RepositoryState::Loading(path) | RepositoryState::Failed { path, .. } => path,
                    _ => return false,
                };

                path == root
                    || common.is_some_and(|common| {
                        roots
                            .get(path)
                            .map(|i| &i.common_directory)
                            .or_else(|| self.monitors.get(path).map(|m| &m.info.common_directory))
                            == Some(common)
                    })
            })
            .map(|tab| tab.workspace.clone())
            .collect()
    }

    pub(super) fn submit_stash(
        &mut self,
        id: u64,
        event: &stashes::Submit,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let Some(target) = self
            .tabs
            .iter()
            .find(|tab| tab.id == id)
            .map(|tab| tab.workspace.clone())
        else {
            return;
        };

        let source = match &target.read(cx).state {
            RepositoryState::Ready(source) => source.clone(),
            _ => return,
        };

        let root = &source.snapshot.repository.root;
        let related = self.related(root, cx);

        if self.busy(root, cx) || related.iter().any(|tab| tab.read(cx).refresh_blocked) {
            target.read(cx).stashes.clone().update(cx, |stashes, cx| {
                stashes.finish(
                    Err(
                        "The repository is busy or needs a refresh. Review it before trying again."
                            .into(),
                    ),
                    window,
                    cx,
                )
            });

            return;
        }

        let peers: HashMap<_, _> = related
            .iter()
            .filter_map(|tab| match &tab.read(cx).state {
                RepositoryState::Ready(source) => Some((
                    source.snapshot.repository.root.clone(),
                    source.repository.clone(),
                )),
                _ => None,
            })
            .collect();

        for path in peers.keys() {
            if let Some(monitor) = self.monitors.get_mut(path) {
                monitor.read = None;
                monitor.timer = None;
                monitor.queue.invalidate(cx.background_executor().now());
            }
        }

        target.update(cx, |view, cx| {
            view.start_write(
                write::Operation::Stash {
                    request: event.0.clone(),
                    peers: peers.into_values().collect(),
                },
                window,
                cx,
            )
        });

        if target.read(cx).write_job.is_none() {
            target.read(cx).stashes.clone().update(cx,|stashes,cx|stashes.finish(Err("The stash operation did not start. Refresh and review it before trying again.".into()),window,cx));
        }

        self.reconcile(cx);
        cx.notify();
    }

    pub(super) fn stash_completed(
        &mut self,
        id: u64,
        event: &stashes::Completed,
        _: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let origin = self
            .tabs
            .iter()
            .find(|tab| tab.id == id)
            .map(|tab| tab.workspace.entity_id());

        for (root, result) in &event.snapshots {
            for tab in self.matching(root, cx) {
                if Some(tab.entity_id()) == origin {
                    continue;
                }

                tab.update(cx,|view,cx|match result{
                    Ok(source)=>{view.load_job=None;view.apply_automatic(source.clone(),cx);},
                    Err(error)=>{view.refresh_blocked=true;view.refresh_error=Some(format!("Could not refresh after the stash action: {error}. Refresh before writing again."));cx.notify();}
                });
            }

            if let Ok(source) = result {
                self.home
                    .update(cx, |home, cx| home.refresh_overview(&source.snapshot, cx));
            }

            self.invalidate(root, cx);
        }

        self.reconcile(cx);
        self.session_changed(cx);
        cx.notify();
    }
}
