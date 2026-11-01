//! Last-commit transactions refresh every related tab without replacing its draft or viewport.
use super::{RepositoryState, Workspace, gpui};
use crate::workspace::{recovery, write};
use std::collections::HashMap;

impl Workspace {
    pub(super) fn submit_recovery(
        &mut self,
        id: u64,
        event: &recovery::Submit,
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

        let invalid = !event.0.review().matches(&source)
            || self.busy(root, cx)
            || related.iter().any(|tab| tab.read(cx).refresh_blocked)
            || match &event.0 {
                recovery::Action::Amend { review, .. } => {
                    !target.read(cx).amend.as_ref().is_some_and(|amend| {
                        amend.review.root == review.root && amend.review.expected == review.expected
                    })
                }
                recovery::Action::Undo(_) => target.read(cx).amend.is_some(),
            };

        if invalid {
            target.read(cx).recovery.clone().update(cx,|form,cx|form.finish(Err("The repository is busy or the last commit changed. Cancel and review it again.".into()),window,cx));

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
                write::Operation::Recovery {
                    action: event.0.clone(),
                    peers: peers.into_values().collect(),
                },
                window,
                cx,
            )
        });

        if target.read(cx).write_job.is_none() {
            target.read(cx).recovery.clone().update(cx, |form, cx| {
                form.finish(
                    Err(
                        "The operation did not start. Cancel and review before trying again."
                            .into(),
                    ),
                    window,
                    cx,
                )
            });
        }

        self.reconcile(cx);
        cx.notify();
    }

    pub(super) fn recovery_completed(
        &mut self,
        id: u64,
        event: &recovery::Completed,
        _: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        self.refresh_written_tabs(id, &event.snapshots, cx);

        if event.needs_review {
            for (root, _) in &event.snapshots {
                for tab in self.matching(root, cx) {
                    tab.update(cx,|tab,cx|{
                        tab.refresh_blocked=true;
                        tab.refresh_error=Some("The history edit needs review. Inspect History and refresh before writing again.".into());
                        cx.notify();
                    });
                }
            }

            self.reconcile(cx);
        }
    }
}
