//! Read-only restart recovery and debounced, atomic workspace persistence.
mod model;
#[cfg(all(test, feature = "test-support"))]
mod native_tests;
mod store;
#[cfg(test)]
mod tests;

use super::{RepositoryState, RepositoryWorkspace, Workspace, gpui, home};

use crate::workspace::{
    Section,
    read::{ChangeKey, Side},
};

use model::Document;
pub(in crate::workspace) use model::{Change, History, Root, SavedTab};
use onegit_git::GitPath;
use onegit_ui::{DiffView, SplitState};
use rake::gpui::{AppContext, px};
use std::{path::PathBuf, time::Duration};
use store::Store;

pub(super) struct Session {
    store: Store,
    timer: Option<gpui::Task<()>>,
    quitting: bool,
}

struct Loaded {
    path: PathBuf,
    result: Result<Option<Document>, String>,
}

impl gpui::EventEmitter<Loaded> for Workspace {}

impl Workspace {
    pub(super) fn session_subscriptions(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        self._subscriptions.push(cx.subscribe_in(
            &cx.entity(),
            window,
            |this, _, loaded: &Loaded, window, cx| this.session_loaded(loaded, window, cx),
        ));
        self._subscriptions.push(cx.on_app_quit(|this, cx| {
            let save = this.prepare_session(cx);

            if let Some(session) = &mut this.session {
                session.timer = None;
                session.quitting = true;
            }

            cx.background_executor().spawn(async move {
                if let Some(save) = save
                    && let Err(error) = save()
                {
                    rake::error!(%error,"Could not save workspace before quit");
                }
            })
        }));
        self._subscriptions.push(cx.on_release(|this, cx| {
            if this
                .session
                .as_ref()
                .is_some_and(|session| !session.quitting)
            {
                // Closing the last window must flush even when the debounce has not fired.
                if let Some(save) = this.prepare_session(cx)
                    && let Err(error) = save()
                {
                    rake::error!(%error,"Could not save workspace before close");
                }
            }
        }));
    }

    fn session_loaded(
        &mut self,
        loaded: &Loaded,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        self.session_load = None;

        match &loaded.result {
            Ok(document) => {
                if let Some(document) = document {
                    self.restore_session(document.clone(), window, cx);
                }

                self.session = Some(Session {
                    store: Store::new(loaded.path.clone()),
                    timer: None,
                    quitting: false,
                });
                self.session_changed(cx);
            }
            Err(error) => {
                self.session_error = Some(format!(
                    "Could not restore workspace: {error}. The saved file at {} was kept. Saving is disabled until it is repaired and the app restarted.",
                    loaded.path.display()
                ));
            }
        }

        cx.notify();
    }

    pub(super) fn load_session(&mut self, cx: &mut gpui::Context<Self>) {
        let path = std::env::var_os("ONEGIT_SESSION_PATH")
            .map(PathBuf::from)
            .or_else(|| {
                home::library::data_directory("1git-rust").map(|dir| dir.join("workspace.json"))
            });

        if let Some(path) = path {
            self.load_session_from(path, cx);
        } else {
            self.session_error=Some("Workspace cannot be saved because the local application data directory is unavailable.".into());
        }
    }

    fn load_session_from(&mut self, path: PathBuf, cx: &mut gpui::Context<Self>) {
        let worker = cx.background_executor().spawn(async move {
            let result = Store::load(&path);

            Loaded { path, result }
        });

        self.session_load = Some(cx.spawn(async move |this, cx| {
            let loaded = worker.await;
            let _ = this.update(cx, |_, cx| cx.emit(loaded));
        }));
    }

    fn capture_session(&self, cx: &gpui::App) -> Document {
        Document {
            version: 1,
            active: self
                .active
                .and_then(|id| self.tabs.iter().position(|tab| tab.id == id)),
            tabs: self
                .tabs
                .iter()
                .filter_map(|tab| SavedTab::capture(tab.workspace.read(cx), cx))
                .collect(),
        }
    }

    fn prepare_session(
        &self,
        cx: &gpui::App,
    ) -> Option<impl FnOnce() -> Result<(), String> + Send + 'static + use<>> {
        self.session
            .as_ref()
            .map(|session| session.store.prepare(self.capture_session(cx)))
    }

    pub(super) fn session_changed(&mut self, cx: &mut gpui::Context<Self>) {
        let Some(session) = &mut self.session else {
            return;
        };

        if session.quitting || session.timer.is_some() {
            return;
        }

        let timer = cx.background_executor().timer(Duration::from_millis(250));

        session.timer = Some(cx.spawn(async move |this, cx| {
            timer.await;
            let save = this
                .update(cx, |this, cx| {
                    if let Some(session) = &mut this.session
                        && let Some(timer) = session.timer.take()
                    {
                        timer.detach();
                    }

                    this.prepare_session(cx)
                })
                .ok()
                .flatten();

            if let Some(save) = save {
                let result = cx.background_executor().spawn(async move { save() }).await;

                let _ = this.update(cx, |this, cx| {
                    let error = result.err().map(|e| {
                        format!("Workspace not saved: {e}. Drafts remain in this window.")
                    });

                    if this.session_error != error {
                        this.session_error = error;
                        cx.notify();
                    }
                });
            }
        }));
    }

    fn restore_session(
        &mut self,
        document: Document,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let old_active = self.active;
        let had_tabs = !self.tabs.is_empty();
        let mut ids = Vec::new();

        for saved in document.tabs {
            if let Ok(path) = saved.root.path() {
                self.add_tab(path, Some(saved), window, cx);
                ids.push(self.tabs.last().expect("restored tab added").id);
            }
        }

        self.active = if had_tabs {
            old_active
        } else {
            document.active.and_then(|index| ids.get(index).copied())
        };

        if let Some(id) = self.active {
            self.activate(id, window, cx);
        } else {
            window.focus(&self.welcome.read(cx).focus.clone(), cx);
        }

        self.pump_restore(cx);
    }

    pub(super) fn pump_restore(&mut self, cx: &mut gpui::Context<Self>) {
        // Bound startup Git work while retaining all queued tabs in the saved session.
        let running = self
            .tabs
            .iter()
            .filter(|tab| tab.workspace.read(cx).load_job.is_some())
            .count();

        let queued = self
            .tabs
            .iter()
            .filter(|tab| {
                let view = tab.workspace.read(cx);

                view.pending_session.is_some()
                    && view.load_job.is_none()
                    && matches!(view.state, RepositoryState::Loading(_))
            })
            .take(4usize.saturating_sub(running))
            .map(|tab| tab.workspace.clone())
            .collect::<Vec<_>>();

        for tab in queued {
            tab.update(cx, |view, cx| {
                if let RepositoryState::Loading(path) = &view.state {
                    let path = path.clone();

                    view.open(path, None, cx);
                }
            });
        }
    }
}

impl SavedTab {
    pub fn capture(view: &RepositoryWorkspace, cx: &gpui::App) -> Option<Self> {
        let root = match &view.state {
            RepositoryState::Ready(loaded) => &loaded.snapshot.repository.root,
            RepositoryState::Loading(path) | RepositoryState::Failed { path, .. } => path,
            RepositoryState::Welcome => return None,
        };

        Some(Self {
            root: Root::capture(root),
            summary: view.summary.read(cx).text().into(),
            description: view.description.read(cx).text().into(),
            history_visible: view.section == Section::History,
            selected: view
                .pending_session
                .as_ref()
                .and_then(|saved| saved.selected.clone())
                .or_else(|| {
                    view.selected.as_ref().map(|key| Change {
                        path: key.path.as_bytes().to_vec(),
                        staged: key.side == Side::Staged,
                    })
                }),
            split_diff: view.view == DiffView::Split,
            filter: view.filter.read(cx).text().into(),
            filter_visible: view.filter_visible,
            sidebar: view.split.read(cx).preferred_size().into(),
            history: view.pending_session.as_ref().map_or_else(
                || view.history.read(cx).session(cx),
                |saved| saved.history.clone(),
            ),
        })
    }

    pub fn install(
        self,
        view: &mut RepositoryWorkspace,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<RepositoryWorkspace>,
    ) {
        view.summary
            .update(cx, |input, cx| input.set_text(self.summary.clone(), cx));
        view.description
            .update(cx, |input, cx| input.set_text(self.description.clone(), cx));
        view.filter
            .update(cx, |input, cx| input.set_text(self.filter.clone(), cx));
        view.filter_visible = self.filter_visible;
        view.section = if self.history_visible {
            Section::History
        } else {
            Section::Changes
        };
        view.view = if self.split_diff {
            DiffView::Split
        } else {
            DiffView::Unified
        };
        view.split = cx.new(|cx| SplitState::new(px(self.sidebar), window, cx));
        view.history.update(cx, |history, cx| {
            history.restore_preferences(&self.history, window, cx)
        });
        view.pending_session = Some(self);
    }

    pub fn selection(&self) -> Option<ChangeKey> {
        self.selected.as_ref().and_then(|change| {
            GitPath::new(&change.path).ok().map(|path| ChangeKey {
                path,
                side: if change.staged {
                    Side::Staged
                } else {
                    Side::Working
                },
            })
        })
    }
}
