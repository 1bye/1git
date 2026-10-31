//! Repository-wide transport ownership and per-worktree refresh; no user action is replayed.
use super::{RepositoryState, Workspace, gpui};
use crate::workspace::sync::{self, Event, Sync};
use onegit_git::RepositoryInfo;
use rake::gpui::prelude::*;

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

pub(super) struct Entry {
    pub state: gpui::Entity<Sync>,
    _events: gpui::Subscription,
}

impl Workspace {
    pub(super) fn reconcile_syncs(
        &mut self,
        roots: &HashMap<PathBuf, RepositoryInfo>,
        cx: &mut gpui::Context<Self>,
    ) {
        for info in roots.values() {
            if !self.syncs.contains_key(&info.common_directory) {
                let state = cx.new(|cx| Sync::new(&self.branch_host, cx));

                let events = cx.subscribe(&state, |this: &mut Self, state, event, cx| {
                    this.sync_event(state, event, cx)
                });

                self.syncs.insert(
                    info.common_directory.clone(),
                    Entry {
                        state,
                        _events: events,
                    },
                );
            }
        }

        self.syncs.retain(|common, entry| {
            entry.state.read(cx).busy()
                || roots.values().any(|info| &info.common_directory == common)
        });

        for tab in &self.tabs {
            let common = match &tab.workspace.read(cx).state {
                RepositoryState::Ready(source) => {
                    Some(source.snapshot.repository.common_directory.clone())
                }
                _ => None,
            };

            let state = common
                .as_ref()
                .and_then(|common| self.syncs.get(common))
                .map(|entry| entry.state.clone());

            if let Some(state) = state {
                let changed = tab
                    .workspace
                    .read(cx)
                    .sync_rail
                    .as_ref()
                    .is_none_or(|rail| rail.read(cx).state != state);

                if changed {
                    let rail = cx.new(|cx| sync::Rail::new(state, cx));

                    tab.workspace.update(cx, |tab, cx| {
                        tab.sync_rail = Some(rail);
                        cx.notify();
                    });
                }
            }
        }
    }

    pub(super) fn sync_busy(&self, root: &Path, cx: &gpui::App) -> bool {
        let common = self
            .monitors
            .get(root)
            .map(|monitor| &monitor.info.common_directory)
            .or_else(|| {
                self.tabs
                    .iter()
                    .find_map(|tab| match &tab.workspace.read(cx).state {
                        RepositoryState::Ready(source)
                            if source.snapshot.repository.root == root =>
                        {
                            Some(&source.snapshot.repository.common_directory)
                        }
                        _ => None,
                    })
            });

        common
            .and_then(|common| self.syncs.get(common))
            .is_some_and(|entry| entry.state.read(cx).busy())
    }

    pub(super) fn fetch_shortcut(
        &mut self,
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

        if self.busy(&source.snapshot.repository.root, cx) {
            return;
        }

        let source = source.clone();

        if let Some(entry) = self.syncs.get(&source.snapshot.repository.common_directory) {
            entry.state.update(cx, |state, cx| {
                state.open(source, window, cx);
                state.fetch_after_review = true;
            });
        }
    }

    fn sync_event(
        &mut self,
        state: gpui::Entity<Sync>,
        event: &Event,
        cx: &mut gpui::Context<Self>,
    ) {
        match event {
            Event::Submit(request) => {
                let common = &request.review.loaded.snapshot.repository.common_directory;

                let sources: HashMap<_, _> = self
                    .tabs
                    .iter()
                    .filter_map(|tab| match &tab.workspace.read(cx).state {
                        RepositoryState::Ready(source)
                            if &source.snapshot.repository.common_directory == common =>
                        {
                            Some((
                                source.snapshot.repository.root.clone(),
                                source.repository.clone(),
                            ))
                        }
                        _ => None,
                    })
                    .collect();

                let conflict = self.tabs.iter().any(|tab| {
                    let view = tab.workspace.read(cx);

                    let related = match &view.state {
                        RepositoryState::Ready(source) => {
                            &source.snapshot.repository.common_directory == common
                        }
                        RepositoryState::Loading(path) | RepositoryState::Failed { path, .. } => {
                            self.monitors
                                .get(path)
                                .is_some_and(|monitor| &monitor.info.common_directory == common)
                        }
                        _ => false,
                    };

                    related && (view.write_job.is_some() || view.load_job.is_some())
                });

                if conflict
                    || !sources.contains_key(&request.review.loaded.snapshot.repository.root)
                {
                    state.update(cx,|state,cx|state.reject("The repository is busy or unavailable. Refresh and review it before trying again.",cx));
                } else {
                    for root in sources.keys() {
                        if let Some(monitor) = self.monitors.get_mut(root) {
                            monitor.read = None;
                            monitor.timer = None;
                            monitor.queue.invalidate(cx.background_executor().now());
                        }

                        for tab in self.matching(root, cx) {
                            tab.update(cx, |tab, _| tab.diff_job = None);
                        }
                    }

                    state.update(cx, |state, cx| {
                        state.start(
                            request.clone(),
                            sources.into_values().collect(),
                            self.write_scope.as_ref(),
                            cx,
                        )
                    });
                }
            }
            Event::Reviewed(loaded) => {
                for tab in self.matching(&loaded.snapshot.repository.root, cx) {
                    tab.update(cx, |tab, cx| tab.apply_automatic(loaded.clone(), cx));
                }

                self.home
                    .update(cx, |home, cx| home.refresh_overview(&loaded.snapshot, cx));
            }
            Event::Completed(completed) => {
                for (root, result) in &completed.snapshots {
                    match result {
                        Ok(loaded) => {
                            for tab in self.matching(root, cx) {
                                tab.update(cx, |tab, cx| {
                                    tab.load_job = None;
                                    tab.apply_automatic(loaded.clone(), cx);
                                });
                            }

                            self.home
                                .update(cx, |home, cx| home.refresh_overview(&loaded.snapshot, cx));
                        }
                        Err(error) => {
                            for tab in self.matching(root, cx) {
                                tab.update(cx,|tab,cx| {
                            tab.refresh_blocked=true;
                            tab.refresh_error=Some(format!("Could not refresh after synchronization: {error}. Refresh before writing again."));cx.notify();
                        });
                            }
                        }
                    }

                    self.invalidate(root, cx);
                }

                self.session_changed(cx);
            }
        }

        self.reconcile(cx);
        cx.notify();
    }
}
