//! Repository workspace; Git reads and serialized writes run outside the UI thread.
mod read;
#[cfg(test)]
mod tests;
mod view;
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

pub(crate) struct RepositoryWorkspace {
    state: RepositoryState,
    selected: Option<ChangeKey>,
    preview: PreviewState,
    view: DiffView,
    focus: gpui::FocusHandle,
    files_focus: gpui::FocusHandle,
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
    pub fn new(
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
        write_scope: Option<rake::tasks::TaskScope>,
    ) -> Self {
        let focus = cx.focus_handle();

        window.focus(&focus, cx);
        window.activate_window();

        let summary = cx.new(|cx| InputState::new("", window, cx));
        let description = cx.new(|cx| InputState::new("", window, cx));

        let subscriptions = vec![
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

        Self {
            state: RepositoryState::Welcome,
            selected: None,
            preview: PreviewState::Empty,
            view: DiffView::Unified,
            focus,
            files_focus: cx.focus_handle(),
            files_scroll: gpui::UniformListScrollHandle::new(),
            split: cx.new(|cx| SplitState::new(px(300.), window, cx)),
            process: read::process(),
            load_job: None,
            diff_job: None,
            picker: None,
            picker_error: None,
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
        self.selected = None;
        self.preview = PreviewState::Empty;
        self.picker_error = None;
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

        let worker = cx
            .background_executor()
            .spawn(async move { read::load(&worker_path, process, &worker_cancel) });

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

        if self.draft_root.as_ref() != Some(&root) {
            self.summary.update(cx, |input, cx| input.set_text("", cx));
            self.description
                .update(cx, |input, cx| input.set_text("", cx));
            self.draft_root = Some(root);
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
        self.state = RepositoryState::Ready(loaded);

        if let Some(key) = selected {
            self.select(key, cx);
        }
    }

    fn can_write(&self) -> bool {
        self.write_job.is_none()
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
            Ok(loaded) => self.apply_loaded(loaded, preferred, cx),
            Err(error) => {
                self.selected = None;
                self.preview = PreviewState::Empty;
                self.state = RepositoryState::Failed { path, error };
            }
        }

        cx.notify();
    }

    fn refresh(&mut self, cx: &mut gpui::Context<Self>) {
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
        self.preview = PreviewState::Loading;
        self.files_scroll
            .scroll_to_item(index, gpui::ScrollStrategy::Nearest);
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

        if loaded.files.is_empty() {
            return;
        }

        let current = self
            .selected
            .as_ref()
            .and_then(|key| loaded.index(key))
            .unwrap_or(0);

        let next = match event.keystroke.key.as_str() {
            "up" => current.saturating_sub(1),
            "down" => (current + 1).min(loaded.files.len() - 1),
            "home" => 0,
            "end" => loaded.files.len() - 1,
            _ => return,
        };

        let key = loaded.files[next].key.clone();

        window.prevent_default();
        cx.stop_propagation();

        if self.selected.as_ref() != Some(&key) {
            self.select(key, cx);
        }
    }
}
