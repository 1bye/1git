//! Per-tab graph navigation; reads never check out references or mutate drafts.
mod form;
mod read;

pub(in crate::workspace) use form::Submit;

mod session;
#[cfg(all(test, feature = "test-support"))]
mod tests;
mod view;

use super::{ReadJob, history::HistoryWorkspace, read::Loaded};
use onegit_git::{Cancellation, CommitInfo};

use onegit_ui::{
    CommitGraphData, CommitGraphState, CommitRefKind, InputEvent, InputState, SplitState,
};

use rake::gpui::{self, AppContext, px};
use std::sync::Arc;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(in crate::workspace) enum Kind {
    #[default]
    All,
    Local,
    Remote,
    Tags,
}

impl Kind {
    fn matches(self, kind: CommitRefKind) -> bool {
        match self {
            Self::All => true,
            Self::Local => kind == CommitRefKind::Branch,
            Self::Remote => kind == CommitRefKind::Remote,
            Self::Tags => kind == CommitRefKind::Tag,
        }
    }
}

pub(super) struct Graph {
    pub(in crate::workspace) form: gpui::Entity<form::Form>,
    source: Option<Arc<Loaded>>,
    refs: Arc<read::References>,
    refs_job: Option<ReadJob>,
    page_job: Option<ReadJob>,
    actions_blocked: bool,
    dirty: bool,
    activated: bool,
    page_loaded: bool,
    tips: Vec<String>,
    commits: Vec<Arc<CommitInfo>>,
    data: CommitGraphData,
    selected: Option<gpui::SharedString>,
    reference: Option<String>,
    kind: Kind,
    query: gpui::Entity<InputState>,
    visible: Vec<usize>,
    refs_focus: gpui::FocusHandle,
    refs_cursor: Option<String>,
    refs_scroll: gpui::UniformListScrollHandle,
    pub(in crate::workspace) state: gpui::Entity<CommitGraphState>,
    pub(in crate::workspace) inspector: gpui::Entity<HistoryWorkspace>,
    pub(in crate::workspace) sidebar: gpui::Entity<SplitState>,
    pub(in crate::workspace) detail_split: gpui::Entity<SplitState>,
    next_offset: Option<u64>,
    refs_error: Option<String>,
    page_error: Option<String>,
    restoring_rows: usize,
    restoring_anchor: Option<String>,
    pending_details: Option<super::tabs::session::History>,
    _subscriptions: Vec<gpui::Subscription>,
}

fn spawn_read<T: Send + 'static>(
    cx: &mut gpui::Context<Graph>,
    work: impl FnOnce(Cancellation) -> Result<T, String> + Send + 'static,
    apply: impl FnOnce(&mut Graph, Result<T, String>, &mut gpui::Context<Graph>) + 'static,
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

impl gpui::EventEmitter<Submit> for Graph {}

impl Graph {
    pub fn new(
        host: &onegit_ui::DialogHostState,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> Self {
        let form = cx.new(|cx| form::Form::new(host, window, cx));
        let query = cx.new(|cx| InputState::new("", window, cx));
        let inspector = cx.new(|cx| HistoryWorkspace::inspector(window, cx));
        let state = cx.new(CommitGraphState::new);

        let subscriptions = vec![
            cx.subscribe(&form, |_, _, event: &Submit, cx| cx.emit(event.clone())),
            cx.subscribe_in(
                &inspector,
                window,
                |this, _, event: &super::history::CreateBranch, window, cx| {
                    if let Some(source) = &this.source {
                        let names = this
                            .refs
                            .items
                            .iter()
                            .filter(|r| r.kind == CommitRefKind::Branch)
                            .map(|r| r.label.clone())
                            .collect();
                        this.form.update(cx, |form, cx| {
                            form.open(source, event.0.clone(), names, window, cx)
                        });
                    }
                },
            ),
            cx.subscribe(&query, |this, _, event: &InputEvent, cx| {
                if *event == InputEvent::Changed {
                    this.refs_scroll
                        .scroll_to_item(0, gpui::ScrollStrategy::Top);
                    this.filter(cx);
                    cx.notify();
                }
            }),
            cx.subscribe_in(
                &inspector,
                window,
                |this, _, _: &super::history::Close, window, cx| {
                    use gpui::Focusable;
                    window.focus(&this.state.read(cx).focus_handle(cx), cx);
                    this.selected = None;
                    cx.notify();
                },
            ),
            cx.subscribe(
                &state,
                |this, _, event: &onegit_ui::CommitGraphScroll, cx| {
                    if event.near_end && this.page_error.is_none() {
                        this.load_page(cx);
                    }
                    cx.notify();
                },
            ),
        ];

        Self {
            form,
            source: None,
            refs: Arc::default(),
            refs_job: None,
            page_job: None,
            actions_blocked: true,
            dirty: false,
            activated: false,
            page_loaded: false,
            tips: Vec::new(),
            commits: Vec::new(),
            data: CommitGraphData::default(),
            selected: None,
            reference: None,
            kind: Kind::All,
            query,
            visible: Vec::new(),
            refs_focus: cx.focus_handle(),
            refs_cursor: None,
            refs_scroll: gpui::UniformListScrollHandle::new(),
            state,
            inspector,
            sidebar: cx.new(|cx| SplitState::new(px(229.), window, cx)),
            detail_split: cx.new(|cx| SplitState::proportional(0.52, window, cx)),
            next_offset: None,
            refs_error: None,
            page_error: None,
            restoring_rows: 0,
            restoring_anchor: None,
            pending_details: None,
            _subscriptions: subscriptions,
        }
    }

    pub fn suspend_for(&mut self, path: &std::path::Path, cx: &mut gpui::Context<Self>) {
        self.refs_job = None;
        self.page_job = None;
        self.dirty = true;

        if self
            .source
            .as_ref()
            .is_none_or(|source| source.snapshot.repository.root != path)
        {
            self.set_source(None, cx);
        }
    }

    pub fn configure_actions(&mut self, blocked: bool, cx: &mut gpui::Context<Self>) {
        if self.actions_blocked != blocked {
            self.actions_blocked = blocked;
            cx.notify();
        }

        self.inspector
            .update(cx, |view, cx| view.configure_actions(blocked, cx));
    }

    pub fn configure(&mut self, blocked: bool, cx: &mut gpui::Context<Self>) {
        self.form.update(cx, |form, cx| form.configure(blocked, cx));
        self.inspector
            .update(cx, |view, cx| view.branch_available(!blocked, cx));
    }

    pub fn set_source(&mut self, source: Option<Arc<Loaded>>, cx: &mut gpui::Context<Self>) {
        let same = self
            .source
            .as_ref()
            .zip(source.as_ref())
            .is_some_and(|(a, b)| a.snapshot.repository.root == b.snapshot.repository.root);

        if same {
            let source = source.expect("same source");

            self.inspector
                .update(cx, |view, cx| view.refresh_source(source.clone(), cx));
            self.source = Some(source);
        } else {
            self.refs_job = None;
            self.page_job = None;
            self.inspector
                .update(cx, |view, cx| view.set_source(source.clone(), cx));
            self.source = source;
            self.refs = Arc::default();
            self.visible.clear();
            self.tips.clear();
            self.commits.clear();
            self.data = CommitGraphData::default();
            self.selected = None;
            self.page_loaded = false;
            self.next_offset = None;

            if self.restoring_rows == 0 && self.restoring_anchor.is_none() {
                self.state.update(cx, |state, _| state.reset());
            }
        }

        if self.source.is_some()
            && let Some(saved) = self.pending_details.take()
        {
            self.selected = saved.commit.clone().map(Into::into);
            self.inspector
                .update(cx, |view, cx| view.restore_selection(&saved, cx));
        }

        self.configure(
            self.source
                .as_ref()
                .is_none_or(|source| !super::write::available(source)),
            cx,
        );
        self.dirty = true;

        if self.activated {
            self.activate(cx);
        }

        cx.notify();
    }

    pub fn activate(&mut self, cx: &mut gpui::Context<Self>) {
        self.activated = true;

        if !self.dirty || self.refs_job.is_some() {
            return;
        }

        let Some(source) = self.source.clone() else {
            return;
        };

        self.dirty = false;
        self.refs_error = None;
        self.refs_job = Some(spawn_read(
            cx,
            move |cancel| read::references(&source, &cancel),
            |this, result, cx| {
                this.refs_job = None;

                match result {
                    Ok(refs) => {
                        if this
                            .reference
                            .as_ref()
                            .is_some_and(|id| !refs.items.iter().any(|r| &r.id == id))
                        {
                            this.reference = None;
                        }

                        let tips = refs.tips(this.reference.as_deref());
                        let changed = this.tips != tips || !this.page_loaded;
                        let labels_changed = *this.refs != refs;

                        this.refs = Arc::new(refs);
                        this.filter(cx);
                        this.update_tags(cx);

                        if changed {
                            // A new captured set supersedes all pages from the old tips.
                            let viewport = this.state.read(cx).viewport();

                            if !this.commits.is_empty() {
                                this.restoring_rows =
                                    this.restoring_rows.max(this.commits.len().min(10_000));
                                this.restoring_anchor =
                                    viewport.anchor.as_ref().map(ToString::to_string);
                                this.state.update(cx, |state, _| state.restore(viewport));
                            }

                            this.page_job = None;
                            this.tips = tips;
                            this.page_loaded = false;
                            this.next_offset = None;
                            this.load_page(cx);
                        } else if labels_changed {
                            this.relabel(cx);
                        }
                    }
                    Err(error) => {
                        this.refs_error = Some(error);
                        this.dirty = true;
                    }
                }

                if this.dirty && this.refs_error.is_none() {
                    this.activate(cx);
                }

                cx.notify();
            },
        ));
        cx.notify();
    }

    fn relabel(&mut self, cx: &mut gpui::Context<Self>) {
        let refs = self.refs.clone();
        let commits = self.commits.clone();

        self.page_job = None;
        self.page_job = Some(spawn_read(
            cx,
            move |_| read::data(&commits, &refs),
            |this, result, cx| {
                this.page_job = None;

                match result {
                    Ok(data) => this.data = data,
                    Err(error) => this.page_error = Some(error),
                }

                cx.notify();
            },
        ));
    }

    fn load_page(&mut self, cx: &mut gpui::Context<Self>) {
        if self.page_job.is_some() || (self.page_loaded && self.next_offset.is_none()) {
            return;
        }

        let Some(source) = self.source.clone() else {
            return;
        };

        let previous = if self.page_loaded {
            self.commits.clone()
        } else {
            Vec::new()
        };

        let refs = self.refs.clone();
        let tips = self.tips.clone();

        self.page_error = None;
        self.page_job = Some(spawn_read(
            cx,
            move |cancel| read::page(&source, &refs, &tips, previous, &cancel),
            |this, result, cx| {
                this.page_job = None;

                match result {
                    Ok(page) => {
                        this.commits = page.commits;
                        this.data = page.data;
                        this.next_offset = page.next_offset;
                        this.page_loaded = true;
                        let missing = this
                            .restoring_anchor
                            .as_ref()
                            .is_some_and(|id| this.data.position(id).is_none());

                        let restore = (this.commits.len() < this.restoring_rows || missing)
                            && this.commits.len() < 10_000;

                        if restore && this.next_offset.is_some() {
                            this.load_page(cx);
                        } else {
                            this.restoring_rows = 0;
                            this.restoring_anchor = None;
                            this.state
                                .update(cx, |state, _| state.finish_restore(&this.data));
                        }
                    }
                    Err(error) => this.page_error = Some(error),
                }

                cx.notify();
            },
        ));
        cx.notify();
    }

    fn update_tags(&self, cx: &mut gpui::Context<Self>) {
        let tags = self
            .refs
            .items
            .iter()
            .filter(|r| {
                r.kind == CommitRefKind::Tag && self.selected.as_deref() == Some(r.oid.as_str())
            })
            .map(|r| r.label.clone().into())
            .collect();

        self.inspector.update(cx, |view, cx| view.tags(tags, cx));
    }

    fn select(&mut self, id: &gpui::SharedString, cx: &mut gpui::Context<Self>) {
        if let Some(commit) = self.commits.iter().find(|c| c.oid == id.as_ref()).cloned() {
            self.selected = Some(id.clone());
            self.update_tags(cx);
            self.inspector
                .update(cx, |view, cx| view.inspect(commit, cx));
            cx.notify();
        }
    }

    fn filter(&mut self, cx: &gpui::App) {
        let query = self.query.read(cx).text().trim().to_lowercase();

        self.visible = self
            .refs
            .items
            .iter()
            .enumerate()
            .filter(|(_, r)| self.kind.matches(r.kind) && r.label.to_lowercase().contains(&query))
            .map(|(i, _)| i)
            .collect();
    }

    fn scope(&mut self, id: Option<String>, cx: &mut gpui::Context<Self>) {
        if self.reference == id {
            return;
        }

        self.reference = id;
        self.page_job = None;
        self.page_loaded = false;
        self.next_offset = None;
        self.selected = None;
        self.restoring_rows = 0;
        self.restoring_anchor = None;
        self.commits.clear();
        self.data = CommitGraphData::default();
        self.tips = self.refs.tips(self.reference.as_deref());
        self.state.update(cx, |state, _| state.reset());
        self.load_page(cx);
        cx.notify();
    }

    fn navigate_refs(
        &mut self,
        event: &gpui::KeyDownEvent,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if event.keystroke.modifiers.modified() || self.visible.is_empty() {
            return;
        }

        let at = self
            .visible
            .iter()
            .position(|i| Some(&self.refs.items[*i].id) == self.refs_cursor.as_ref())
            .unwrap_or(0);

        let next = match event.keystroke.key.as_str() {
            "up" => at.saturating_sub(1),
            "down" => (at + 1).min(self.visible.len() - 1),
            "home" => 0,
            "end" => self.visible.len() - 1,
            "enter" | "space" => at,
            _ => return,
        };

        let id = self.refs.items[self.visible[next]].id.clone();

        self.refs_cursor = Some(id.clone());
        self.refs_scroll
            .scroll_to_item(next, gpui::ScrollStrategy::Nearest);
        window.prevent_default();
        cx.stop_propagation();
        self.scope(Some(id), cx);
    }
}
