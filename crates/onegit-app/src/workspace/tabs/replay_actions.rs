//! Replay shares the related-repository exclusion and refresh paths.
use super::{RepositoryState, Workspace, gpui};
use crate::workspace::{replay, write};
use std::collections::HashMap;

impl Workspace {
    pub(super) fn submit_replay(
        &mut self,
        id: u64,
        event: &replay::Submit,
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
            || target.read(cx).amend.is_some();

        if invalid {
            target.read(cx).replay.clone().update(cx,|form,cx|form.finish(Err("The repository is busy or the reviewed commit changed. Cancel and review it again.".into()),window,cx));

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
                write::Operation::Replay {
                    action: event.0.clone(),
                    peers: peers.into_values().collect(),
                },
                window,
                cx,
            )
        });

        if target.read(cx).write_job.is_none() {
            target.read(cx).replay.clone().update(cx, |form, cx| {
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

    pub(super) fn replay_completed(
        &mut self,
        id: u64,
        event: &replay::Completed,
        cx: &mut gpui::Context<Self>,
    ) {
        self.refresh_written_tabs(id, &event.snapshots, cx);

        if event.needs_review {
            for (root, _) in &event.snapshots {
                for tab in self.matching(root, cx) {
                    tab.update(cx, |tab, cx| {
                        tab.refresh_blocked = true;
                        tab.refresh_error = Some("The reset result needs review. Inspect History and refresh before writing again.".into());
                        cx.notify();
                    });
                }
            }

            self.reconcile(cx);
        }
    }
}
