//! App-owned commit history and selection, independent from uncommitted changes.
mod read;
mod session;
#[cfg(test)]
mod tests;
mod view;

use super::{Preview, PreviewState, ReadJob, read::Loaded};
use onegit_git::{Cancellation, CommitFile, CommitInfo, GitPath};
use onegit_ui::{CommitListData, DiffView, SplitState};
use rake::gpui::{self, AppContext, px};
use std::{collections::HashMap, sync::Arc};

struct Details {
    commit: Arc<CommitInfo>,
    files: Vec<CommitFile>,
}

enum DetailState {
    Empty,
    Loading,
    Ready(Arc<Details>),
    Failed(String),
}

pub(super) struct Refresh;

impl gpui::EventEmitter<Refresh> for HistoryWorkspace {}

pub(super) struct HistoryWorkspace {
    source: Option<Arc<Loaded>>,
    data: CommitListData,
    list_state: gpui::Entity<onegit_ui::CommitListState>,
    commits: HashMap<gpui::SharedString, Arc<CommitInfo>>,
    page_loaded: bool,
    restore_rows: Option<usize>,
    restoring_file: Option<GitPath>,
    total: Option<u64>,
    next_offset: Option<u64>,
    page_error: Option<String>,
    pub(super) selected: Option<gpui::SharedString>,
    detail: DetailState,
    file: Option<GitPath>,
    preview: PreviewState,
    diff_state: Option<gpui::Entity<onegit_ui::DiffViewerState>>,
    view: DiffView,
    files_focus: gpui::FocusHandle,
    files_scroll: gpui::UniformListScrollHandle,
    sidebar: gpui::Entity<SplitState>,
    detail_split: gpui::Entity<SplitState>,
    page_job: Option<ReadJob>,
    detail_job: Option<ReadJob>,
    patch_job: Option<ReadJob>,
}

fn spawn_read<T: Send + 'static>(
    cx: &mut gpui::Context<HistoryWorkspace>,
    work: impl FnOnce(Cancellation) -> Result<T, String> + Send + 'static,
    apply: impl FnOnce(&mut HistoryWorkspace, Result<T, String>, &mut gpui::Context<HistoryWorkspace>)
    + 'static,
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

impl HistoryWorkspace {
    pub fn new(window: &mut gpui::Window, cx: &mut gpui::Context<Self>) -> Self {
        Self {
            source: None,
            data: CommitListData::default(),
            list_state: cx.new(onegit_ui::CommitListState::new),
            commits: HashMap::new(),
            page_loaded: false,
            restore_rows: None,
            restoring_file: None,
            total: None,
            next_offset: None,
            page_error: None,
            selected: None,
            detail: DetailState::Empty,
            file: None,
            preview: PreviewState::Empty,
            diff_state: None,
            view: DiffView::Unified,
            files_focus: cx.focus_handle(),
            files_scroll: gpui::UniformListScrollHandle::new(),
            sidebar: cx.new(|cx| SplitState::new(px(310.), window, cx)),
            detail_split: cx.new(|cx| SplitState::proportional(0.5, window, cx)),
            page_job: None,
            detail_job: None,
            patch_job: None,
        }
    }

    pub fn sidebar_width(
        &mut self,
        width: gpui::Pixels,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        self.sidebar
            .update(cx, |split, cx| split.resize(width, window, cx));
    }

    pub fn set_source(&mut self, source: Option<Arc<Loaded>>, cx: &mut gpui::Context<Self>) {
        let same = self
            .source
            .as_ref()
            .zip(source.as_ref())
            .is_some_and(|(old, new)| {
                old.snapshot.repository.root == new.snapshot.repository.root
                    && old.snapshot.status.head == new.snapshot.status.head
            });

        self.source = source;

        if same {
            return;
        }

        self.restore_rows = None;
        self.restoring_file = None;
        self.page_job = None;
        self.detail_job = None;
        self.patch_job = None;
        self.data = CommitListData::default();
        self.commits.clear();
        self.page_loaded = false;
        self.total = None;
        self.next_offset = None;
        self.page_error = None;
        self.selected = None;
        self.detail = DetailState::Empty;
        self.file = None;
        self.preview = PreviewState::Empty;
        cx.notify();
    }

    pub fn refresh_source(&mut self, source: Arc<Loaded>, cx: &mut gpui::Context<Self>) {
        let new_head = self
            .source
            .as_ref()
            .is_none_or(|old| old.snapshot.status.head != source.snapshot.status.head);

        self.source = Some(source);

        if new_head {
            let activated = self.page_loaded || self.page_job.is_some() || self.selected.is_some();

            self.commits
                .retain(|oid, _| self.selected.as_ref() == Some(oid));
            self.page_job = None;
            self.data = CommitListData::default();
            self.page_loaded = false;
            self.total = None;
            self.next_offset = None;
            self.page_error = None;

            // The chosen commit and file are immutable; retain their detail/patch.
            if activated {
                self.load_page(cx);
            }
        }

        cx.notify();
    }

    pub fn activate(&mut self, cx: &mut gpui::Context<Self>) {
        if !self.page_loaded && self.page_job.is_none() {
            self.load_page(cx);
        }
    }

    fn load_page(&mut self, cx: &mut gpui::Context<Self>) {
        if self.page_job.is_some() {
            return;
        }

        let Some(source) = self.source.clone() else {
            return;
        };

        let offset = if self.page_loaded {
            let Some(offset) = self.next_offset else {
                return;
            };

            offset
        } else {
            0
        };

        let previous = self.data.clone();

        self.page_error = None;
        let limit = self.restore_rows.unwrap_or(50).max(50);

        self.page_job = Some(spawn_read(
            cx,
            move |cancel| read::page_with_limit(&source, offset, previous, limit, &cancel),
            |this, result, cx| {
                this.page_job = None;

                match result {
                    Ok(page) => {
                        this.commits.extend(
                            page.commits
                                .into_iter()
                                .map(|commit| (commit.oid.clone().into(), Arc::new(commit))),
                        );
                        this.data = page.data;
                        this.restore_rows = None;

                        if page.total.is_some() {
                            this.total = page.total;
                        }

                        this.next_offset = page.next_offset;
                        this.page_loaded = true;

                        if this.selected.is_none()
                            && let Some(first) = this.data.items().first()
                        {
                            this.select_commit(first.id.clone(), cx);
                        }
                    }
                    Err(error) => this.page_error = Some(error),
                }

                cx.notify();
            },
        ));
        cx.notify();
    }

    fn select_commit(&mut self, oid: gpui::SharedString, cx: &mut gpui::Context<Self>) {
        if let Some(commit) = self.commits.get(&oid).cloned() {
            self.load_commit(oid, Some(commit), None, cx);
        }
    }

    fn select_file(&mut self, path: GitPath, cx: &mut gpui::Context<Self>) {
        let Some(source) = &self.source else {
            return;
        };

        let DetailState::Ready(details) = &self.detail else {
            return;
        };

        let Some(index) = details.files.iter().position(|file| file.path == path) else {
            return;
        };

        let file = details.files[index].clone();
        let oid = details.commit.oid.clone();
        let repository = source.repository.clone();

        self.patch_job = None;
        self.diff_state = None;
        self.file = Some(path);
        self.preview = PreviewState::Loading;
        self.files_scroll
            .scroll_to_item(index, gpui::ScrollStrategy::Nearest);
        self.patch_job = Some(spawn_read(
            cx,
            move |cancel| read::patch(&repository, &oid, &file, &cancel),
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
                    Ok(preview) => PreviewState::Ready(preview),
                    Err(error) => PreviewState::Failed(error),
                };
                cx.notify();
            },
        ));
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

        let DetailState::Ready(details) = &self.detail else {
            return;
        };

        if details.files.is_empty() {
            return;
        }

        let current = self
            .file
            .as_ref()
            .and_then(|path| details.files.iter().position(|file| &file.path == path))
            .unwrap_or(0);

        let next = match event.keystroke.key.as_str() {
            "up" => current.saturating_sub(1),
            "down" => (current + 1).min(details.files.len() - 1),
            "home" => 0,
            "end" => details.files.len() - 1,
            _ => return,
        };

        let path = details.files[next].path.clone();

        window.prevent_default();
        cx.stop_propagation();

        if self.file.as_ref() != Some(&path) {
            self.select_file(path, cx);
        }
    }
}
