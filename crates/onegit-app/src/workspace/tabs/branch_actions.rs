//! Branch results update related worktree tabs without disposing their retained state.
use super::{RepositoryState, Workspace, gpui};
use crate::workspace::{branches, write};

impl Workspace {
    pub(super) fn open_branches(
        &mut self,
        origin: Option<gpui::Point<gpui::Pixels>>,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let Some(tab) = self
            .active
            .and_then(|id| self.tabs.iter().find(|tab| tab.id == id))
        else {
            return;
        };

        let RepositoryState::Ready(source) = &tab.workspace.read(cx).state else {
            return;
        };

        if self.busy(&source.snapshot.repository.root, cx) || tab.workspace.read(cx).refresh_blocked
        {
            return;
        }

        let id = tab.id;
        let source = source.clone();

        self.branches.update(cx, |picker, cx| {
            picker.open(
                id,
                source,
                origin.unwrap_or_else(|| gpui::point(gpui::px(48.), gpui::px(84.))),
                window,
                cx,
            )
        });
    }

    pub(super) fn submit_branch(
        &mut self,
        event: &branches::Submit,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let target = self
            .tabs
            .iter()
            .find(|tab| tab.id == event.tab)
            .map(|tab| tab.workspace.clone());

        let accepted = if let Some(target) = target {
            let root = match &target.read(cx).state {
                RepositoryState::Ready(source) => Some(source.snapshot.repository.root.clone()),
                _ => None,
            };

            if root.as_ref().is_some_and(|root| {
                !self.busy(root, cx)
                    && self
                        .related(root, cx)
                        .iter()
                        .all(|tab| !tab.read(cx).refresh_blocked)
            }) {
                let peers = self
                    .related(root.as_ref().expect("available branch source"), cx)
                    .iter()
                    .filter_map(|tab| match &tab.read(cx).state {
                        RepositoryState::Ready(source) => Some((
                            source.snapshot.repository.root.clone(),
                            source.repository.clone(),
                        )),
                        _ => None,
                    })
                    .collect::<std::collections::HashMap<_, _>>();

                for root in peers.keys() {
                    if let Some(monitor) = self.monitors.get_mut(root) {
                        monitor.read = None;
                        monitor.timer = None;
                        monitor.queue.invalidate(cx.background_executor().now());
                    }
                }

                target.update(cx, |view, cx| {
                    view.start_write(
                        write::Operation::Branch {
                            request: event.request.clone(),
                            peers: peers.into_values().collect(),
                        },
                        window,
                        cx,
                    )
                });

                target.read(cx).write_job.is_some()
            } else {
                false
            }
        } else {
            false
        };

        if !accepted {
            self.branches.update(cx,|picker,cx|picker.finish(Err("The repository is busy or unavailable. Finish the current operation, then reopen Branches.".into()),None,false,window,cx));
        }

        self.reconcile(cx);
        cx.notify();
    }

    pub(super) fn branch_completed(
        &mut self,
        id: u64,
        event: &branches::Completed,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if let Some(change) = &event.change {
            for tab in self.related(&event.root, cx) {
                tab.update(cx, |view, cx| {
                    view.graph
                        .update(cx, |graph, cx| graph.branch_changed(change, cx))
                });
            }
        }

        self.refresh_written_tabs(id, &event.snapshots, cx);
        // Graph's create-at action has no peer list; invalidate any linked worktrees as before.
        let linked = self
            .related(&event.root, cx)
            .iter()
            .filter_map(|tab| match &tab.read(cx).state {
                RepositoryState::Ready(source)
                    if !event
                        .snapshots
                        .iter()
                        .any(|(root, _)| root == &source.snapshot.repository.root) =>
                {
                    Some(source.snapshot.repository.root.clone())
                }
                _ => None,
            })
            .collect::<std::collections::HashSet<_>>();

        for root in linked {
            self.invalidate(&root, cx);
        }

        if event.needs_review {
            for tab in self.related(&event.root, cx) {
                tab.update(cx,|view,cx|{
                    view.refresh_blocked=true;
                    view.refresh_error=Some("The branch action needs review. Inspect Branches and refresh before writing again.".into());
                    cx.notify();
                });
            }
        }

        self.branches.update(cx, |picker, cx| {
            if picker.owns(id) {
                picker.finish(
                    event.result.clone(),
                    event.loaded.as_ref().ok().map(|loaded| loaded.as_ref()),
                    event.needs_review,
                    window,
                    cx,
                );
            }
        });
        self.reconcile(cx);
        self.session_changed(cx);
        cx.notify();
    }
}
