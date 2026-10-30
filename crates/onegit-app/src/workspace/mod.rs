//! Read-only repository workspace; Git processes never run on the UI thread.
mod read;
#[cfg(test)]
mod tests;
mod view;

use onegit_git::{Cancellation, GitProcess};
use onegit_ui::{DiffView, SplitState};
use rake::gpui::{self, prelude::*, px};
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
}

impl RepositoryWorkspace {
    pub fn new(window: &mut gpui::Window, cx: &mut gpui::Context<Self>) -> Self {
        let focus = cx.focus_handle();

        window.focus(&focus, cx);
        window.activate_window();

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
        }
    }

    fn choose_repository(&mut self, cx: &mut gpui::Context<Self>) {
        if self.picker.is_some() {
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
            Ok(loaded) => {
                let selected = preferred
                    .filter(|key| loaded.file(key).is_some())
                    .or_else(|| loaded.files.first().map(|file| file.key.clone()));

                self.state = RepositoryState::Ready(loaded);

                if let Some(key) = selected {
                    self.select(key, cx);
                }
            }
            Err(error) => self.state = RepositoryState::Failed { path, error },
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
