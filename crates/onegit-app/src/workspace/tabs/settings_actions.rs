//! Settings reads never reset tab state; accepted writes refresh every affected checkout.
use super::{RepositoryState, Workspace, gpui};
use crate::workspace::settings::Event;
use std::collections::HashMap;

impl Workspace {
    pub(super) fn open_settings(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.active.is_some_and(|id| {
            self.tabs.iter().any(|tab| {
                tab.id == id && !matches!(tab.workspace.read(cx).state, RepositoryState::Ready(_))
            })
        }) {
            return;
        }

        let source = self
            .active
            .and_then(|id| self.tabs.iter().find(|tab| tab.id == id))
            .and_then(|tab| match &tab.workspace.read(cx).state {
                RepositoryState::Ready(source) => Some(source.clone()),
                _ => None,
            });

        self.branches
            .update(cx, |picker, cx| picker.close(window, cx));
        self.settings.update(cx, |settings, cx| {
            settings.open(source, self.process.clone(), window, cx)
        });
        cx.notify();
    }

    pub(super) fn settings_event(&mut self, event: &Event, cx: &mut gpui::Context<Self>) {
        match event {
            Event::Submit(request) => {
                let common = request
                    .source
                    .as_ref()
                    .map(|source| &source.snapshot.repository.common_directory);

                let affected = self
                    .tabs
                    .iter()
                    .filter_map(|tab| match &tab.workspace.read(cx).state {
                        RepositoryState::Ready(source)
                            if common.is_none_or(|common| {
                                source.snapshot.repository.common_directory == *common
                            }) =>
                        {
                            Some(tab.workspace.clone())
                        }
                        _ => None,
                    })
                    .collect::<Vec<_>>();

                // The settings panel has marked itself pending; inspect other writers directly.
                let blocked=affected.iter().any(|tab|{let tab=tab.read(cx);

                    tab.write_job.is_some()||tab.load_job.is_some()||tab.refresh_blocked||matches!(&tab.state,RepositoryState::Ready(source) if self.sync_busy(&source.snapshot.repository.root,cx))});

                let peers: HashMap<_, _> = affected
                    .iter()
                    .filter_map(|tab| match &tab.read(cx).state {
                        RepositoryState::Ready(source) => Some((
                            source.snapshot.repository.root.clone(),
                            source.repository.clone(),
                        )),
                        _ => None,
                    })
                    .collect();

                let missing = request
                    .source
                    .as_ref()
                    .is_some_and(|source| !peers.contains_key(&source.snapshot.repository.root));

                if blocked || missing {
                    self.settings.update(cx,|settings,cx|settings.reject("The repository is busy or unavailable. Reload and review Git settings before saving.".into(),cx));
                } else {
                    for root in peers.keys() {
                        if let Some(monitor) = self.monitors.get_mut(root) {
                            monitor.read = None;
                            monitor.timer = None;
                            monitor.queue.invalidate(cx.background_executor().now());
                        }

                        for tab in self.matching(root, cx) {
                            tab.update(cx, |tab, _| tab.diff_job = None);
                        }
                    }

                    self.settings.update(cx, |settings, cx| {
                        settings.start(
                            (**request).clone(),
                            peers.into_values().collect(),
                            self.write_scope.as_ref(),
                            cx,
                        )
                    });
                }
            }
            Event::Completed(completed) => {
                self.refresh_written_tabs(0, &completed.snapshots, cx);
            }
            Event::Closed => {}
        }

        self.reconcile(cx);
        cx.notify();
    }
}
