//! Per-tab saved-work browsing; accepted mutations are owned by the repository workspace.
mod form;
#[cfg(all(test, feature = "test-support"))]
mod native_tests;
mod read;
mod session;
#[cfg(test)]
mod tests;
mod view;

use super::{Preview, PreviewState, ReadJob, read::Loaded};
use onegit_git::{BranchIdentity, Cancellation, Stash, StashAction, StashRequest};
use onegit_ui::{DialogHostState, DiffView, SplitState};
use rake::gpui::{self, AppContext, px};
use std::{collections::HashMap, path::PathBuf, sync::Arc};

pub(super) struct Submit(pub StashRequest);

pub(super) struct Refresh;

pub(super) struct Completed {
    pub snapshots: Vec<(PathBuf, Result<Arc<Loaded>, String>)>,
    pub result: Result<(), String>,
    pub applied: bool,
}

impl gpui::EventEmitter<Submit> for Stashes {}

impl gpui::EventEmitter<Submit> for super::RepositoryWorkspace {}

impl gpui::EventEmitter<Completed> for super::RepositoryWorkspace {}

impl gpui::EventEmitter<Refresh> for Stashes {}

enum Files {
    Empty,
    Loading,
    Ready(Arc<Vec<read::File>>),
    Failed(String),
}

pub(super) struct Stashes {
    source: Option<Arc<Loaded>>,
    entries: Arc<Vec<Stash>>,
    selected: Option<String>,
    restoring: Option<super::tabs::session::StashView>,
    files: Files,
    file: Option<read::File>,
    cache: HashMap<String, Arc<Vec<read::File>>>,
    preview: PreviewState,
    diff_state: Option<gpui::Entity<onegit_ui::DiffViewerState>>,
    view: DiffView,
    pub(super) sidebar: gpui::Entity<SplitState>,
    pub(super) detail_split: gpui::Entity<SplitState>,
    list_focus: gpui::FocusHandle,
    files_focus: gpui::FocusHandle,
    scroll: gpui::UniformListScrollHandle,
    files_scroll: gpui::UniformListScrollHandle,
    activated: bool,
    loaded: bool,
    blocked: bool,
    error: Option<String>,
    list_job: Option<ReadJob>,
    files_job: Option<ReadJob>,
    patch_job: Option<ReadJob>,
    pub(super) form: gpui::Entity<form::Form>,
    host: Option<DialogHostState>,
    _events: Vec<gpui::Subscription>,
}

fn spawn_read<T: Send + 'static>(
    cx: &mut gpui::Context<Stashes>,
    work: impl FnOnce(Cancellation) -> Result<T, String> + Send + 'static,
    apply: impl FnOnce(&mut Stashes, Result<T, String>, &mut gpui::Context<Stashes>) + 'static,
) -> ReadJob {
    let cancel = Cancellation::default();
    let worker_cancel = cancel.clone();
    let completion_cancel = cancel.clone();

    let worker = cx
        .background_executor()
        .spawn(async move { work(worker_cancel) });

    let task = cx.spawn(async move |this, cx| {
        let result = worker.await;

        if !completion_cancel.is_cancelled() {
            let _ = this.update(cx, |this, cx| apply(this, result, cx));
        }
    });

    ReadJob {
        cancel,
        task: Some(task),
    }
}

impl Stashes {
    pub fn new(
        host: Option<&DialogHostState>,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> Self {
        let local = host.is_none().then(|| DialogHostState::new(cx));

        let form =
            cx.new(|cx| form::Form::new(host.or(local.as_ref()).expect("dialog host"), window, cx));

        let events = vec![cx.subscribe(&form, |_: &mut Self, _, event: &Submit, cx| {
            cx.emit(Submit(event.0.clone()))
        })];

        Self {
            source: None,
            entries: Arc::new(Vec::new()),
            selected: None,
            restoring: None,
            files: Files::Empty,
            file: None,
            cache: HashMap::new(),
            preview: PreviewState::Empty,
            diff_state: None,
            view: DiffView::Unified,
            sidebar: cx.new(|cx| SplitState::new(px(310.), window, cx)),
            detail_split: cx.new(|cx| SplitState::proportional(0.5, window, cx)),
            list_focus: cx.focus_handle(),
            files_focus: cx.focus_handle(),
            scroll: gpui::UniformListScrollHandle::new(),
            files_scroll: gpui::UniformListScrollHandle::new(),
            activated: false,
            loaded: false,
            blocked: true,
            error: None,
            list_job: None,
            files_job: None,
            patch_job: None,
            form,
            host: local,
            _events: events,
        }
    }

    pub fn suspend(&mut self, cx: &mut gpui::Context<Self>) {
        self.list_job = None;
        self.loaded = false;
        cx.notify();
    }

    pub fn source(&mut self, source: Option<Arc<Loaded>>, cx: &mut gpui::Context<Self>) {
        let same = self
            .source
            .as_ref()
            .zip(source.as_ref())
            .is_some_and(|(a, b)| a.snapshot.repository.root == b.snapshot.repository.root);

        self.source = source;
        self.list_job = None;
        self.loaded = false;
        self.error = None;

        if !same {
            self.entries = Arc::new(Vec::new());
            self.selected = None;
            self.files = Files::Empty;
            self.file = None;
            self.cache.clear();
            self.preview = PreviewState::Empty;
            self.diff_state = None;
            self.files_job = None;
            self.patch_job = None;
        }

        if self.activated && self.source.is_some() {
            self.load(cx);
        }

        cx.notify();
    }

    pub fn configure(&mut self, blocked: bool, cx: &mut gpui::Context<Self>) {
        if self.blocked != blocked {
            self.blocked = blocked;
            cx.notify();
        }

        self.form.update(cx, |form, cx| form.blocked(blocked, cx));
    }

    pub fn activate(&mut self, cx: &mut gpui::Context<Self>) {
        self.activated = true;

        if !self.loaded && self.list_job.is_none() {
            self.load(cx);
        }
    }

    fn load(&mut self, cx: &mut gpui::Context<Self>) {
        let Some(source) = self.source.clone() else {
            return;
        };

        self.list_job = None;
        self.error = None;
        self.list_job = Some(spawn_read(
            cx,
            move |cancel| {
                source
                    .repository
                    .stashes(Some(&cancel))
                    .map_err(super::read::message)
            },
            |this, result, cx| {
                this.list_job = None;

                match result {
                    Ok(entries) => this.replace(entries, cx),
                    Err(error) => {
                        this.loaded = false;
                        this.error = Some(error);
                    }
                }

                cx.notify();
            },
        ));
        cx.notify();
    }

    fn replace(&mut self, entries: Vec<Stash>, cx: &mut gpui::Context<Self>) {
        let old_index = self
            .selected
            .as_ref()
            .and_then(|oid| self.entries.iter().position(|s| &s.oid == oid))
            .unwrap_or(0);

        if self.selected.is_none() {
            self.selected = self.restoring.as_ref().and_then(|s| s.selected.clone());
        }

        let retained = self
            .selected
            .as_ref()
            .is_some_and(|oid| entries.iter().any(|s| &s.oid == oid));

        self.cache
            .retain(|oid, _| entries.iter().any(|s| &s.oid == oid));
        self.entries = Arc::new(entries);
        self.loaded = true;
        self.error = None;

        if retained
            && matches!(self.files, Files::Empty)
            && let Some(oid) = self.selected.clone()
        {
            self.select(oid, cx);
        }

        if !retained {
            self.restoring = None;

            if self.entries.is_empty() {
                self.scroll
                    .0
                    .borrow()
                    .base_handle
                    .set_offset(gpui::point(px(0.), px(0.)));
            }

            self.files_job = None;
            self.patch_job = None;
            self.selected = None;
            self.files = Files::Empty;
            self.file = None;
            self.preview = PreviewState::Empty;
            self.diff_state = None;

            if let Some(entry) = self
                .entries
                .get(old_index.min(self.entries.len().saturating_sub(1)))
            {
                self.select(entry.oid.clone(), cx);
            }
        }
    }

    fn select(&mut self, oid: String, cx: &mut gpui::Context<Self>) {
        if !self.entries.iter().any(|s| s.oid == oid) {
            return;
        }

        self.files_job = None;
        self.patch_job = None;
        self.selected = Some(oid.clone());
        self.file = None;
        self.preview = PreviewState::Empty;
        self.diff_state = None;
        self.files_scroll
            .0
            .borrow()
            .base_handle
            .set_offset(gpui::point(px(0.), px(0.)));

        if let Some(files) = self.cache.get(&oid).cloned() {
            self.install_files(files, cx);

            return;
        }

        let Some(source) = self.source.clone() else {
            return;
        };

        self.files = Files::Loading;
        self.files_job = Some(spawn_read(
            cx,
            move |cancel| read::files(&source.repository, &oid, &cancel).map(Arc::new),
            |this, result, cx| {
                this.files_job = None;

                match result {
                    Ok(files) => {
                        if let Some(oid) = &this.selected {
                            this.cache.insert(oid.clone(), files.clone());
                        }

                        this.install_files(files, cx);
                    }
                    Err(error) => this.files = Files::Failed(error),
                }

                cx.notify();
            },
        ));
        cx.notify();
    }

    fn install_files(&mut self, files: Arc<Vec<read::File>>, cx: &mut gpui::Context<Self>) {
        let first = self
            .restoring
            .take()
            .and_then(|saved| saved.file)
            .and_then(|(revision, path)| {
                files
                    .iter()
                    .find(|f| f.revision == revision && f.file.path.as_bytes() == path)
                    .cloned()
            })
            .or_else(|| files.first().cloned());

        self.files = Files::Ready(files);

        if let Some(file) = first {
            self.select_file(file, cx);
        }

        cx.notify();
    }

    fn select_file(&mut self, file: read::File, cx: &mut gpui::Context<Self>) {
        let Some(source) = self.source.clone() else {
            return;
        };

        self.patch_job = None;
        self.diff_state = None;
        self.file = Some(file.clone());
        self.preview = PreviewState::Loading;
        self.patch_job = Some(spawn_read(
            cx,
            move |cancel| read::patch(&source.repository, &file, &cancel),
            |this, result, cx| {
                this.patch_job = None;

                if let Ok(Preview::Patch(document)) = &result {
                    this.diff_state = Some(cx.new(|cx| {
                        onegit_ui::DiffViewerState::new(
                            document.without_file_metadata(),
                            this.view,
                            cx,
                        )
                    }));
                }

                this.preview = match result {
                    Ok(p) => PreviewState::Ready(p),
                    Err(e) => PreviewState::Failed(e),
                };
                cx.notify();
            },
        ));
        cx.notify();
    }

    fn request(
        &mut self,
        action: StashAction,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.blocked || !self.loaded {
            return;
        }

        let Some(source) = &self.source else {
            return;
        };

        let request = StashRequest {
            source: BranchIdentity::from_snapshot(&source.snapshot),
            action,
        };

        if matches!(
            request.action,
            StashAction::Save { .. } | StashAction::Delete(_)
        ) {
            let title = if let StashAction::Delete(oid) = &request.action {
                self.entries
                    .iter()
                    .find(|s| s.oid == *oid)
                    .map(|s| s.summary.clone())
                    .unwrap_or_else(|| "Unavailable stash".into())
            } else {
                String::new()
            };

            self.form
                .update(cx, |form, cx| form.open(request, title, window, cx));
        } else {
            cx.emit(Submit(request));
        }
    }

    pub fn finish(
        &mut self,
        result: Result<(), String>,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        self.form
            .update(cx, |form, cx| form.finish(result, window, cx));
    }

    fn navigate(
        &mut self,
        files: bool,
        event: &gpui::KeyDownEvent,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if event.keystroke.modifiers.modified() {
            return;
        }

        let (count, current) = if files {
            let Files::Ready(data) = &self.files else {
                return;
            };

            (
                data.len(),
                self.file
                    .as_ref()
                    .and_then(|f| data.iter().position(|v| v == f))
                    .unwrap_or(0),
            )
        } else {
            (
                self.entries.len(),
                self.selected
                    .as_ref()
                    .and_then(|oid| self.entries.iter().position(|s| &s.oid == oid))
                    .unwrap_or(0),
            )
        };

        if count == 0 {
            return;
        }

        let next = match event.keystroke.key.as_str() {
            "up" => current.saturating_sub(1),
            "down" => (current + 1).min(count - 1),
            "home" => 0,
            "end" => count - 1,
            _ => return,
        };

        window.prevent_default();
        cx.stop_propagation();

        if next == current {
            return;
        }

        if files {
            let Files::Ready(data) = &self.files else {
                return;
            };

            self.select_file(data[next].clone(), cx);
            self.files_scroll
                .scroll_to_item(next, gpui::ScrollStrategy::Nearest);
        } else {
            self.select(self.entries[next].oid.clone(), cx);
            self.scroll
                .scroll_to_item(next, gpui::ScrollStrategy::Nearest);
        }
    }
}
