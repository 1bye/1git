//! Repository workspace; Git reads and serialized writes run outside the UI thread.
mod branches;
mod chrome;
mod history;
mod home;
mod native;
mod read;
mod stashes;
mod sync;
mod tabs;
#[cfg(test)]
mod tests;
mod view;
mod watch;
mod write;

use onegit_git::{Cancellation, GitProcess};

use onegit_ui::{
    DiffView, InputEvent, InputState, SplitState, Toast, ToastId, ToastKind, ToastState,
};

use rake::gpui::{self, Focusable, prelude::*, px};
use read::{ChangeKey, Loaded, Preview};
use std::{path::PathBuf, sync::Arc};

struct ReadJob {
    cancel: Cancellation,
    task: Option<gpui::Task<()>>,
}

impl Drop for ReadJob {
    fn drop(&mut self) {
        self.cancel.cancel();

        // Keep observing completion so the background reader owns process/temp-index cleanup.
        if let Some(task) = self.task.take() {
            task.detach();
        }
    }
}

struct WriteJob(Option<gpui::Task<()>>);

impl Drop for WriteJob {
    fn drop(&mut self) {
        // Closing a window must not interrupt an accepted index write or commit midway.
        if let Some(task) = self.0.take() {
            task.detach();
        }
    }
}

enum RepositoryState {
    Welcome,
    Loading(PathBuf),
    Ready(Arc<Loaded>),
    Failed { path: PathBuf, error: String },
}

enum PreviewState {
    Empty,
    Loading,
    Ready(Preview),
    Failed(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Section {
    Changes,
    History,
    Stashes,
}

pub(crate) use tabs::Workspace;

pub(crate) struct RepositoryWorkspace {
    hosted: bool,
    repository_busy: bool,
    refresh_blocked: bool,
    sync_rail: Option<gpui::Entity<sync::Rail>>,
    tab_strip: Option<tabs::TabStrip>,
    refresh_error: Option<String>,
    session_error: Option<String>,
    pending_session: Option<tabs::session::SavedTab>,
    state: RepositoryState,
    section: Section,
    home: gpui::Entity<home::Home>,
    home_visible: bool,
    history: gpui::Entity<history::HistoryWorkspace>,
    stashes: gpui::Entity<stashes::Stashes>,
    selected: Option<ChangeKey>,
    preview: PreviewState,
    diff_state: Option<gpui::Entity<onegit_ui::DiffViewerState>>,
    view: DiffView,
    focus: gpui::FocusHandle,
    files_focus: gpui::FocusHandle,
    section_focus: [gpui::FocusHandle; 3],
    filter: gpui::Entity<InputState>,
    filter_visible: bool,
    visible_files: Arc<[usize]>,
    files_scroll: gpui::UniformListScrollHandle,
    split: gpui::Entity<SplitState>,
    process: GitProcess,
    load_job: Option<ReadJob>,
    diff_job: Option<ReadJob>,
    picker: Option<gpui::Task<()>>,
    picker_error: Option<String>,
    write_job: Option<WriteJob>,
    write_scope: Option<rake::tasks::TaskScope>,
    summary: gpui::Entity<InputState>,
    description: gpui::Entity<InputState>,
    draft_root: Option<PathBuf>,
    toasts: gpui::Entity<ToastState>,
    _subscriptions: Vec<gpui::Subscription>,
}

impl RepositoryWorkspace {
    #[cfg(test)]
    pub fn new(
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
        write_scope: Option<rake::tasks::TaskScope>,
    ) -> Self {
        Self::build(window, cx, write_scope, None, None)
    }

    fn for_tab(
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
        write_scope: Option<rake::tasks::TaskScope>,
        home: gpui::Entity<home::Home>,
        host: &onegit_ui::DialogHostState,
    ) -> Self {
        Self::build(window, cx, write_scope, Some(home), Some(host))
    }

    fn build(
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
        write_scope: Option<rake::tasks::TaskScope>,
        shared_home: Option<gpui::Entity<home::Home>>,
        host: Option<&onegit_ui::DialogHostState>,
    ) -> Self {
        let hosted = shared_home.is_some();

        let native_error = if hosted {
            None
        } else {
            native::install(window, onegit_ui::Theme::current().appearance).err()
        };

        let focus = cx.focus_handle();

        window.focus(&focus, cx);
        window.activate_window();

        let summary = cx.new(|cx| InputState::new("", window, cx));
        let description = cx.new(|cx| InputState::new("", window, cx));
        let filter = cx.new(|cx| InputState::new("", window, cx));

        let home = shared_home
            .unwrap_or_else(|| cx.new(|cx| home::Home::new(window, cx, write_scope.clone())));

        let history = cx.new(|cx| history::HistoryWorkspace::new(window, cx));

        let stashes = cx.new(|cx| stashes::Stashes::new(host, window, cx));

        let mut subscriptions = vec![
            cx.subscribe(&stashes, |_: &mut Self, _, event: &stashes::Submit, cx| {
                cx.emit(stashes::Submit(event.0.clone()))
            }),
            cx.subscribe(&stashes, |this: &mut Self, _, _: &stashes::Refresh, cx| {
                this.refresh(cx)
            }),
            cx.subscribe(&history, |this: &mut Self, _, _: &history::Refresh, cx| {
                this.refresh(cx)
            }),
            cx.subscribe(&filter, |this: &mut Self, _, _, cx| this.update_filter(cx)),
            cx.subscribe_in(&summary, window, |this: &mut Self, _, event, window, cx| {
                if *event == InputEvent::Submitted {
                    window.focus(&this.description.read(cx).focus_handle(cx), cx);
                }

                cx.notify();
            }),
            cx.subscribe_in(
                &description,
                window,
                |this: &mut Self, _, event, window, cx| {
                    if *event == InputEvent::Submitted {
                        this.commit(window, cx);
                    }

                    cx.notify();
                },
            ),
        ];

        if !hosted {
            subscriptions.push(cx.subscribe_in(
                &home,
                window,
                |this: &mut Self, _, event, window, cx| match event {
                    home::HomeEvent::Open(path) => this.open(path.clone(), None, cx),
                    home::HomeEvent::Pick => this.choose_repository(cx),
                    home::HomeEvent::Restored(width) => {
                        if let Some(width) = width {
                            // GPUIX includes the hairline in its sidebar width; SplitState reserves it separately.
                            this.split
                                .update(cx, |split, cx| split.resize(px(*width - 1.), window, cx));
                            this.history.update(cx, |history, cx| {
                                history.sidebar_width(px(*width - 1.), window, cx)
                            });
                            this.stashes
                                .read(cx)
                                .sidebar
                                .clone()
                                .update(cx, |split, cx| split.resize(px(*width - 1.), window, cx));
                        }
                    }
                },
            ));
        }

        Self {
            hosted,
            repository_busy: false,
            refresh_blocked: false,
            sync_rail: None,
            tab_strip: None,
            refresh_error: None,
            session_error: None,
            pending_session: None,
            state: RepositoryState::Welcome,
            section: Section::Changes,
            home,
            home_visible: true,
            history,
            stashes,
            selected: None,
            preview: PreviewState::Empty,
            diff_state: None,
            view: DiffView::Unified,
            focus,
            files_focus: cx.focus_handle(),
            section_focus: [cx.focus_handle(), cx.focus_handle(), cx.focus_handle()],
            filter,
            filter_visible: false,
            visible_files: Arc::from([]),
            files_scroll: gpui::UniformListScrollHandle::new(),
            split: cx.new(|cx| SplitState::new(px(310.), window, cx)),
            process: read::process(),
            load_job: None,
            diff_job: None,
            picker: None,
            picker_error: native_error,
            write_job: None,
            write_scope,
            summary,
            description,
            draft_root: None,
            toasts: cx.new(|cx| ToastState::new(window, cx)),
            _subscriptions: subscriptions,
        }
    }

    fn choose_repository(&mut self, cx: &mut gpui::Context<Self>) {
        if self.hosted {
            cx.emit(tabs::Request::Pick);

            return;
        }

        if self.picker.is_some() || self.write_job.is_some() {
            return;
        }

        self.picker_error = None;
        let paths = cx.prompt_for_paths(gpui::PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some("Open repository".into()),
        });

        self.picker = Some(cx.spawn(async move |this, cx| {
            let result = paths.await;

            let _ = this.update(cx, |this, cx| {
                this.picker = None;

                match result {
                    Ok(Ok(Some(paths))) => {
                        if let Some(path) = paths.into_iter().next() {
                            this.open(path, None, cx);
                        }
                    }
                    Ok(Ok(None)) => {}
                    Ok(Err(error)) => {
                        this.picker_error =
                            Some(format!("Could not open the folder picker: {error}"))
                    }
                    Err(_) => {
                        this.picker_error = Some(
                            "The folder picker closed before returning a selection. Try again."
                                .into(),
                        )
                    }
                }

                cx.notify();
            });
        }));
        cx.notify();
    }

    fn open(&mut self, path: PathBuf, preferred: Option<ChangeKey>, cx: &mut gpui::Context<Self>) {
        if self.write_job.is_some() {
            return;
        }

        self.load_job = None;
        self.diff_job = None;
        self.history
            .update(cx, |history, cx| history.set_source(None, cx));
        self.stashes.update(cx, |stashes, cx| stashes.suspend(cx));
        self.selected = None;
        self.preview = PreviewState::Empty;
        self.picker_error = None;
        self.refresh_error = None;
        self.home_visible = false;
        self.state = RepositoryState::Loading(path.clone());
        self.files_scroll
            .0
            .borrow()
            .base_handle
            .set_offset(gpui::point(px(0.), px(0.)));
        let cancel = Cancellation::default();
        let worker_cancel = cancel.clone();
        let completion_cancel = cancel.clone();
        let process = self.process.clone();
        let worker_path = path.clone();
        let restoring = self.pending_session.is_some();

        let worker = cx.background_executor().spawn(async move {
            let loaded = read::load(&worker_path, process, &worker_cancel)?;

            if restoring && std::fs::canonicalize(&worker_path).ok().as_ref() != Some(&loaded.snapshot.repository.root) {
                return Err("The saved folder is no longer the same repository root. Restore the folder and retry, or open its new location.".into());
            }

            Ok(loaded)
        });

        let task = cx.spawn(async move |this, cx| {
            let result = worker.await;

            if !completion_cancel.is_cancelled() {
                let _ = this.update(cx, |this, cx| {
                    this.finish_open(&completion_cancel, path, preferred, result, cx)
                });
            }
        });

        self.load_job = Some(ReadJob {
            cancel,
            task: Some(task),
        });
        cx.notify();
    }

    fn finish_open(
        &mut self,
        cancel: &Cancellation,
        path: PathBuf,
        preferred: Option<ChangeKey>,
        result: Result<Arc<Loaded>, String>,
        cx: &mut gpui::Context<Self>,
    ) {
        if cancel.is_cancelled() {
            return;
        }

        self.load_job = None;

        match result {
            Ok(loaded) => self.apply_loaded(loaded, preferred, cx),
            Err(error) => self.state = RepositoryState::Failed { path, error },
        }

        cx.notify();
    }

    fn apply_loaded(
        &mut self,
        loaded: Arc<Loaded>,
        preferred: Option<ChangeKey>,
        cx: &mut gpui::Context<Self>,
    ) {
        let root = loaded.snapshot.repository.root.clone();

        self.refresh_blocked = false;

        self.home
            .update(cx, |home, cx| home.remember(root.clone(), cx));

        let restored = self.pending_session.take();

        let preferred = restored
            .as_ref()
            .and_then(|saved| saved.selection())
            .or(preferred);

        if restored.is_some() {
            self.draft_root = Some(root.clone());
        }

        if self.draft_root.as_ref() != Some(&root) {
            self.summary.update(cx, |input, cx| input.set_text("", cx));
            self.description
                .update(cx, |input, cx| input.set_text("", cx));
            self.draft_root = Some(root);
            self.filter_visible = false;
            self.filter.update(cx, |filter, cx| filter.set_text("", cx));
        }

        let selected = preferred
            .as_ref()
            .filter(|key| loaded.file(key).is_some())
            .cloned()
            .or_else(|| {
                preferred.as_ref().and_then(|key| {
                    loaded
                        .files
                        .iter()
                        .find(|file| file.key.path == key.path)
                        .map(|file| file.key.clone())
                })
            })
            .or_else(|| loaded.files.first().map(|file| file.key.clone()));

        self.selected = None;
        self.preview = PreviewState::Empty;
        self.history.update(cx, |history, cx| {
            history.set_source(Some(loaded.clone()), cx);

            if let Some(saved) = &restored {
                history.restore_selection(&saved.history, cx);
            }

            if self.section == Section::History {
                history.activate(cx);
            }
        });
        self.stashes.update(cx, |stashes, cx| {
            stashes.source(Some(loaded.clone()), cx);
            stashes.configure(
                self.repository_busy || self.refresh_blocked || !write::available(&loaded),
                cx,
            );

            if self.section == Section::Stashes {
                stashes.activate(cx);
            }
        });
        self.state = RepositoryState::Ready(loaded);
        self.rebuild_filter(cx);

        let selected = selected.filter(|key| self.visible_files.iter().any(|index| {
            matches!(&self.state, RepositoryState::Ready(loaded) if &loaded.files[*index].key == key)
        }));

        if let Some(key) = selected {
            self.select(key, cx);
        } else {
            self.select_first_visible(cx);
        }
    }

    fn can_write(&self) -> bool {
        self.write_job.is_none()
            && !self.repository_busy
            && !self.refresh_blocked
            && self.picker.is_none()
            && matches!(&self.state, RepositoryState::Ready(loaded) if write::available(loaded))
    }

    fn can_commit(&self, cx: &gpui::App) -> bool {
        let summary = self.summary.read(cx).text().trim();
        let description = self.description.read(cx).text();

        self.can_write()
            && !summary.is_empty()
            && !summary.contains(['\0', '\n', '\r'])
            && !description.contains('\0')
            && matches!(&self.state, RepositoryState::Ready(loaded) if write::staged_count(loaded) > 0)
    }

    fn commit(&mut self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        if !self.can_commit(cx) {
            return;
        }

        let operation = write::Operation::Commit {
            summary: self.summary.read(cx).text().to_owned(),
            description: self.description.read(cx).text().to_owned(),
        };

        self.start_write(operation, window, cx);
    }

    fn start_write(
        &mut self,
        operation: write::Operation,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if !self.can_write() {
            return;
        }

        let RepositoryState::Ready(loaded) = &self.state else {
            return;
        };

        let loaded = loaded.clone();
        let path = loaded.snapshot.repository.root.clone();
        let preferred = self.selected.clone();

        let toast = self.toasts.update(cx, |state, cx| {
            state.show(
                Toast::new(ToastKind::Progress, operation.progress()),
                window,
                cx,
            )
        });

        self.diff_job = None;
        self.load_job = None;
        let executor = cx.background_executor().clone();
        let entity = cx.weak_entity();
        let mut context = window.to_async(cx);
        let label = operation.progress();

        let completion = async move {
            let outcome = executor
                .spawn(async move { write::run(loaded, operation) })
                .await;

            let _ = entity.update_in(&mut context, |this, window, cx| {
                this.finish_write(path, preferred, toast, outcome, window, cx);
            });
        };

        if let Some(scope) = &self.write_scope {
            // App-owned work survives a page closing and participates in Rake's normal quit wait.
            match scope.spawn(label, async move {
                completion.await;

                Ok(())
            }) {
                Ok(_) => self.write_job = Some(WriteJob(None)),
                Err(error) => {
                    self.toasts.update(cx, |state, cx| {
                        let _ = state.update(
                            toast,
                            Toast {
                                description: Some(error.to_string().into()),
                                ..Toast::new(ToastKind::Error, "The operation did not start")
                            },
                            window,
                            cx,
                        );
                    });
                }
            }
        } else {
            // Standalone GPUI test hosts do not run a Rake application registry.
            self.write_job = Some(WriteJob(Some(cx.foreground_executor().spawn(completion))));
        }

        cx.notify();
    }

    fn finish_write(
        &mut self,
        path: PathBuf,
        preferred: Option<ChangeKey>,
        toast: ToastId,
        outcome: write::Outcome,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        self.write_job = None;
        self.diff_job = None;

        if outcome.committed {
            self.summary.update(cx, |input, cx| input.set_text("", cx));
            self.description
                .update(cx, |input, cx| input.set_text("", cx));
        }

        let stash_completion = outcome.stash_completion;

        let branch_completion = outcome.branch_action.then(|| branches::Completed {
            root: path.clone(),
            loaded: outcome.loaded.clone(),
            result: outcome.result.as_ref().map(|_| ()).map_err(Clone::clone),
        });

        let feedback = match outcome.result {
            Ok(detail) => Toast {
                description: Some(detail.into()),
                ..Toast::new(ToastKind::Success, "Repository updated")
            },
            Err(detail) => Toast {
                description: Some(detail.into()),
                ..Toast::new(ToastKind::Error, "Could not complete the operation")
            },
        };

        self.toasts.update(cx, |state, cx| {
            // A dismissed progress card stays dismissed while the operation completes.
            let _ = state.update(toast, feedback, window, cx);
        });

        match outcome.loaded {
            Ok(loaded) if outcome.branch_action || stash_completion.is_some() => {
                self.apply_automatic(loaded, cx)
            }
            Ok(loaded) => self.apply_loaded(loaded, preferred, cx),
            Err(error) if stash_completion.is_some() => {
                self.refresh_blocked = true;
                self.refresh_error = Some(format!(
                    "Could not refresh after the stash action: {error}. Refresh before writing again."
                ));
            }
            Err(error) => {
                self.selected = None;
                self.preview = PreviewState::Empty;
                self.state = RepositoryState::Failed { path, error };
            }
        }

        if let Some(completion) = stash_completion {
            self.stashes.update(cx, |stashes, cx| {
                stashes.finish(completion.result.clone(), window, cx)
            });

            if completion.applied && completion.result.is_ok() {
                self.section = Section::Changes;
            }

            cx.emit(completion);
        }

        if let Some(completion) = branch_completion {
            cx.emit(completion);
        }

        cx.notify();
    }

    fn rebuild_filter(&mut self, cx: &gpui::App) {
        let query = self.filter.read(cx).text().to_lowercase();

        self.visible_files = match &self.state {
            RepositoryState::Ready(loaded) => loaded
                .files
                .iter()
                .enumerate()
                .filter(|(_, file)| query.is_empty() || file.label.to_lowercase().contains(&query))
                .map(|(index, _)| index)
                .collect::<Vec<_>>()
                .into(),
            _ => Arc::from([]),
        };
    }

    fn select_first_visible(&mut self, cx: &mut gpui::Context<Self>) {
        let key = match &self.state {
            RepositoryState::Ready(loaded) => self
                .visible_files
                .first()
                .map(|index| loaded.files[*index].key.clone()),
            _ => None,
        };

        if let Some(key) = key {
            self.select(key, cx);
        }
    }

    fn update_filter(&mut self, cx: &mut gpui::Context<Self>) {
        self.rebuild_filter(cx);
        let visible = matches!((&self.state,&self.selected),(RepositoryState::Ready(loaded),Some(key)) if self.visible_files.iter().any(|index| &loaded.files[*index].key == key));

        if !visible && self.write_job.is_none() {
            self.diff_job = None;
            self.selected = None;
            self.preview = PreviewState::Empty;
            self.select_first_visible(cx);
        }

        cx.notify();
    }

    fn toggle_filter(&mut self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        self.filter_visible = !self.filter_visible;

        if self.filter_visible {
            window.focus(&self.filter.read(cx).focus_handle(cx), cx);
        } else {
            self.filter.update(cx, |filter, cx| filter.set_text("", cx));
            window.focus(&self.files_focus, cx);
        }

        cx.notify();
    }

    fn navigate_sections(
        &mut self,
        event: &gpui::KeyDownEvent,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if event.keystroke.modifiers.modified() {
            return;
        }

        let current = match self.section {
            Section::Changes => 0usize,
            Section::History => 1,
            Section::Stashes => 2,
        };

        let next = match event.keystroke.key.as_str() {
            "up" | "left" => current.saturating_sub(1),
            "down" | "right" => (current + 1).min(2),
            "home" => 0,
            "end" => 2,
            _ => return,
        };

        let id = gpui::ElementId::from(["changes", "history", "stashes"][next]);

        window.prevent_default();
        cx.stop_propagation();
        self.change_section(&id, cx);
        window.focus(&self.section_focus[next], cx);
    }

    fn change_section(&mut self, id: &gpui::ElementId, cx: &mut gpui::Context<Self>) {
        self.section = if *id == gpui::ElementId::from("history") {
            Section::History
        } else if *id == gpui::ElementId::from("stashes") {
            Section::Stashes
        } else {
            Section::Changes
        };

        if self.section == Section::Stashes {
            self.stashes.update(cx, |stashes, cx| stashes.activate(cx));
        }

        if self.section == Section::History {
            self.history.update(cx, |history, cx| history.activate(cx));
        }

        cx.notify();
    }

    fn show_home(&mut self, cx: &mut gpui::Context<Self>) {
        if self.hosted {
            cx.emit(tabs::Request::Home);
        } else {
            self.home_visible = true;
            cx.notify();
        }
    }

    fn apply_automatic(&mut self, loaded: Arc<Loaded>, cx: &mut gpui::Context<Self>) {
        if self.write_job.is_some() || self.load_job.is_some() {
            return;
        }

        self.refresh_error = None;
        self.refresh_blocked = false;
        let preferred = self.selected.clone();

        let same = preferred
            .as_ref()
            .is_some_and(|key| loaded.file(key).is_some());

        self.history.update(cx, |history, cx| {
            history.refresh_source(loaded.clone(), cx);

            if self.section == Section::History {
                history.activate(cx);
            }
        });
        self.stashes.update(cx, |stashes, cx| {
            stashes.source(Some(loaded.clone()), cx);
            stashes.configure(
                self.repository_busy || self.refresh_blocked || !write::available(&loaded),
                cx,
            );

            if self.section == Section::Stashes {
                stashes.activate(cx);
            }
        });
        self.state = RepositoryState::Ready(loaded);
        self.rebuild_filter(cx);

        if same {
            // Keep the mounted viewer and its scroll anchor while its new patch is read.
            if let Some(key) = preferred {
                self.read_preview(key, cx);
            }
        } else {
            self.selected = None;
            self.preview = PreviewState::Empty;
            let replacement = match &self.state {
                RepositoryState::Ready(loaded) => preferred
                    .as_ref()
                    .and_then(|key| loaded.files.iter().find(|file| file.key.path == key.path))
                    .map(|file| file.key.clone()),
                _ => None,
            };

            if let Some(key) = replacement {
                self.select(key, cx);
            } else {
                self.select_first_visible(cx);
            }
        }

        cx.notify();
    }

    fn refresh(&mut self, cx: &mut gpui::Context<Self>) {
        if self.repository_busy {
            return;
        }

        let path = match &self.state {
            RepositoryState::Ready(loaded) => loaded.snapshot.repository.root.clone(),
            RepositoryState::Failed { path, .. } => path.clone(),
            _ => return,
        };

        self.open(path, self.selected.clone(), cx);
    }

    fn select(&mut self, key: ChangeKey, cx: &mut gpui::Context<Self>) {
        if self.write_job.is_some() {
            return;
        }

        if self.selected.as_ref() != Some(&key) {
            self.diff_state = None;
        }

        self.preview = PreviewState::Loading;
        self.read_preview(key, cx);
    }

    fn read_preview(&mut self, key: ChangeKey, cx: &mut gpui::Context<Self>) {
        let RepositoryState::Ready(loaded) = &self.state else {
            return;
        };

        let Some(index) = loaded.index(&key) else {
            return;
        };

        let file = loaded.files[index].clone();
        let repository = loaded.repository.clone();

        self.diff_job = None;
        self.selected = Some(key.clone());

        if let Some(position) = self
            .visible_files
            .iter()
            .position(|visible| *visible == index)
        {
            self.files_scroll
                .scroll_to_item(position, gpui::ScrollStrategy::Nearest);
        }

        let cancel = Cancellation::default();
        let worker_cancel = cancel.clone();
        let completion_cancel = cancel.clone();

        let worker = cx
            .background_executor()
            .spawn(async move { read::preview(&repository, &file, &worker_cancel) });

        let task = cx.spawn(async move |this, cx| {
            let result = worker.await;

            if !completion_cancel.is_cancelled() {
                let _ = this.update(cx, |this, cx| {
                    this.finish_preview(&completion_cancel, &key, result, cx)
                });
            }
        });

        self.diff_job = Some(ReadJob {
            cancel,
            task: Some(task),
        });
        cx.notify();
    }

    fn finish_preview(
        &mut self,
        cancel: &Cancellation,
        key: &ChangeKey,
        result: Result<Preview, String>,
        cx: &mut gpui::Context<Self>,
    ) {
        if cancel.is_cancelled() || self.selected.as_ref() != Some(key) {
            return;
        }

        self.diff_job = None;

        if let Ok(Preview::Patch(document)) = &result {
            let compact = document.without_file_metadata();

            if let Some(state) = &self.diff_state {
                state.update(cx, |state, _| state.refresh(compact, self.view));
            } else {
                self.diff_state =
                    Some(cx.new(|cx| onegit_ui::DiffViewerState::new(compact, self.view, cx)));
            }
        }

        self.preview = match result {
            Ok(preview) => PreviewState::Ready(preview),
            Err(error) => PreviewState::Failed(error),
        };
        cx.notify();
    }

    fn navigate_files(
        &mut self,
        event: &gpui::KeyDownEvent,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if event.keystroke.modifiers.modified() {
            return;
        }

        let RepositoryState::Ready(loaded) = &self.state else {
            return;
        };

        if self.visible_files.is_empty() {
            return;
        }

        let current = self
            .selected
            .as_ref()
            .and_then(|key| loaded.index(key))
            .and_then(|index| {
                self.visible_files
                    .iter()
                    .position(|visible| *visible == index)
            })
            .unwrap_or(0);

        let next = match event.keystroke.key.as_str() {
            "up" => current.saturating_sub(1),
            "down" => (current + 1).min(self.visible_files.len() - 1),
            "home" => 0,
            "end" => self.visible_files.len() - 1,
            _ => return,
        };

        let key = loaded.files[self.visible_files[next]].key.clone();

        window.prevent_default();
        cx.stop_propagation();

        if self.selected.as_ref() != Some(&key) {
            self.select(key, cx);
        }
    }
}
