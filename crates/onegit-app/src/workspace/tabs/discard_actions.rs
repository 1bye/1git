//! File writes share guards and refresh each worktree without replacing per-tab intent.
use super::{RepositoryState, Workspace, gpui};
use crate::workspace::{discard, write};
use std::collections::HashMap;

impl Workspace {
    pub(super) fn submit_discard(
        &mut self,
        id: u64,
        event: &discard::Submit,
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
            target.read(cx).discard.clone().update(cx, |form, cx| {
                form.finish(
                    Err("The repository is busy or needs a refresh. Nothing was started.".into()),
                    None,
                    None,
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
                write::Operation::Discard {
                    action: event.0.clone(),
                    peers: peers.into_values().collect(),
                },
                window,
                cx,
            )
        });

        if target.read(cx).write_job.is_none() {
            target.read(cx).discard.clone().update(cx, |form, cx| {
                form.finish(
                    Err(
                        "The file operation did not start. Refresh and review before trying again."
                            .into(),
                    ),
                    None,
                    None,
                    window,
                    cx,
                )
            });
        }

        self.reconcile(cx);
        cx.notify();
    }

    pub(super) fn discard_completed(
        &mut self,
        id: u64,
        event: &discard::Completed,
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

                tab.update(cx, |view, cx| {
                    view.discard.update(cx, |form, cx| {
                        if event.recovery.is_some() || (event.result.is_ok() && form.recovery.as_ref().is_some_and(|saved| Some(&saved.undo.token) == event.restored.as_ref())) {
                            form.recovery = None;
                            cx.notify();
                        }
                    });

                    match result {
                        Ok(source) => { view.load_job = None; view.apply_automatic(source.clone(), cx); }
                        Err(error) => {
                            view.refresh_blocked = true;
                            view.refresh_error = Some(format!("Could not refresh after the file operation: {error}. Refresh before writing again."));
                            cx.notify();
                        }
                    }
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
