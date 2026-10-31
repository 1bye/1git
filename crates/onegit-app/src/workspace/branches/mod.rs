//! Attached branch navigation; accepted writes remain owned by the repository workspace.
pub(super) mod model;
mod view;

use super::{
    ReadJob,
    read::{self, Loaded},
    write,
};

use gpui_ce_motion::{Easing, MotionValue, Transition};

use onegit_git::{
    BranchAction, BranchChanges, BranchCollection, BranchIdentity, BranchRequest, Cancellation,
    RecordType, SavedBranchChanges,
};

use onegit_ui::{DialogEvent, DialogHostState, DialogState, InputEvent, InputState};
use rake::gpui::{self, Focusable, prelude::*, px};

use std::{
    sync::Arc,
    time::{Duration, Instant},
};

pub(super) enum Phase {
    List,
    Create {
        remote: Option<String>,
    },
    Changes {
        request: Box<BranchRequest>,
        destination: String,
        choice: BranchChanges,
    },
    Restore(SavedBranchChanges),
}

pub(super) struct Submit {
    pub tab: u64,
    pub request: BranchRequest,
}

impl gpui::EventEmitter<Submit> for Picker {}

pub(super) struct Picker {
    pub(super) dialog: gpui::Entity<DialogState>,
    home: gpui::Entity<super::home::Home>,
    source: Option<Arc<Loaded>>,
    tab: Option<u64>,
    pub(super) query: gpui::Entity<InputState>,
    pub(super) name: gpui::Entity<InputState>,
    pub(super) data: Option<BranchCollection>,
    pub(super) saved: Vec<SavedBranchChanges>,
    pub(super) visible: Vec<usize>,
    expanded: bool,
    highlighted: Option<usize>,
    list_focus: gpui::FocusHandle,
    scroll: gpui::UniformListScrollHandle,
    pub(super) phase: Phase,
    pub(super) busy: bool,
    pub(super) error: Option<String>,
    stale: bool,
    dirty: bool,
    blocked: bool,
    origin: gpui::Point<gpui::Pixels>,
    epoch: Instant,
    height: MotionValue,
    opacity: MotionValue,
    read: Option<ReadJob>,
    _subscriptions: Vec<gpui::Subscription>,
}

impl Picker {
    pub fn owns(&self, tab: u64) -> bool {
        self.tab == Some(tab)
    }

    pub fn new(
        host: &DialogHostState,
        home: gpui::Entity<super::home::Home>,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> Self {
        let dialog = host.dialog(cx);
        let query = cx.new(|cx| InputState::new("", window, cx));
        let name = cx.new(|cx| InputState::new("", window, cx));

        let subscriptions = vec![
            cx.subscribe(&dialog, |this: &mut Self, _, _: &DialogEvent, cx| {
                this.read = None;
                if !this.busy {
                    this.source = None;
                    this.tab = None;
                    this.data = None;
                    this.saved.clear();
                    this.visible.clear();
                }
                cx.notify();
            }),
            cx.subscribe_in(&query, window, |this: &mut Self, _, event, window, cx| {
                if *event == InputEvent::Changed {
                    this.filter(cx);
                } else if *event == InputEvent::Submitted
                    && let Some(index) = this
                        .highlighted
                        .and_then(|i| this.visible.get(i).copied())
                        .or_else(|| {
                            this.visible
                                .iter()
                                .copied()
                                .find(|&i| this.blocked(i).is_none())
                        })
                {
                    this.choose(index, window, cx);
                }
            }),
            cx.subscribe_in(&name, window, |this: &mut Self, _, event, window, cx| {
                if *event == InputEvent::Submitted {
                    this.confirm(window, cx);
                } else {
                    cx.notify();
                }
            }),
        ];

        Self {
            dialog,
            home,
            source: None,
            tab: None,
            query,
            name,
            data: None,
            saved: Vec::new(),
            visible: Vec::new(),
            expanded: false,
            highlighted: None,
            list_focus: cx.focus_handle().tab_stop(true),
            scroll: gpui::UniformListScrollHandle::new(),
            phase: Phase::List,
            busy: false,
            error: None,
            stale: false,
            dirty: false,
            blocked: true,
            origin: gpui::point(px(48.), px(84.)),
            epoch: cx.background_executor().now(),
            height: MotionValue::new(0.),
            opacity: MotionValue::new(0.),
            read: None,
            _subscriptions: subscriptions,
        }
    }

    pub fn open(
        &mut self,
        tab: u64,
        source: Arc<Loaded>,
        origin: gpui::Point<gpui::Pixels>,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.busy {
            return;
        }

        // Source review is immutable until reopen; avoid scanning every file for each branch row.
        self.dirty = source
            .snapshot
            .status
            .files
            .iter()
            .any(|file| file.record_type != RecordType::Ignored);
        self.blocked = !write::available(&source);
        self.source = Some(source);
        self.origin = origin;
        self.stale = false;
        self.tab = Some(tab);
        self.phase = Phase::List;
        self.expanded = false;
        self.error = None;
        self.data = None;
        self.saved.clear();
        self.visible.clear();
        self.highlighted = None;
        self.query.update(cx, |input, cx| input.set_text("", cx));
        self.name.update(cx, |input, cx| input.set_text("", cx));
        self.epoch = cx.background_executor().now();
        self.height = MotionValue::new(0.);
        self.opacity = MotionValue::new(0.);
        self.dialog.update(cx, |dialog, cx| {
            dialog.open(window, cx);
        });
        self.load(cx);
        cx.notify();
    }

    fn load(&mut self, cx: &mut gpui::Context<Self>) {
        self.read = None;

        let Some(source) = &self.source else {
            return;
        };

        let repository = source.repository.clone();
        let cancel = Cancellation::default();
        let worker_cancel = cancel.clone();
        let completion_cancel = cancel.clone();

        let worker = cx.background_executor().spawn(async move {
            let branches = repository
                .branches(Some(&worker_cancel))
                .map_err(read::message)?;

            let saved = repository
                .saved_branch_changes(Some(&worker_cancel))
                .map_err(read::message)?;

            Ok::<_, String>((branches, saved))
        });

        let task = cx.spawn(async move |this, cx| {
            let result = worker.await;

            if !completion_cancel.is_cancelled() {
                let _ = this.update(cx, |this, cx| {
                    this.read = None;

                    match result {
                        Ok((data, saved)) => {
                            this.data = Some(data);
                            this.saved = saved;
                            this.filter(cx);
                        }
                        Err(error) => this.error = Some(error),
                    }

                    cx.notify();
                });
            }
        });

        self.read = Some(ReadJob {
            cancel,
            task: Some(task),
        });
    }

    fn filter(&mut self, cx: &mut gpui::Context<Self>) {
        self.visible = self
            .data
            .as_ref()
            .map(|data| model::visible(data, self.query.read(cx).text(), self.expanded))
            .unwrap_or_default();
        self.highlighted = None;
        self.scroll
            .0
            .borrow()
            .base_handle
            .set_offset(gpui::point(px(0.), px(0.)));
        cx.notify();
    }

    fn operation_blocked(&self) -> bool {
        self.stale || self.blocked
    }

    fn dirty(&self) -> bool {
        self.dirty
    }

    fn blocked(&self, index: usize) -> Option<String> {
        let data = self.data.as_ref()?;
        let branch = data.branches.get(index)?;

        if branch.checked_out {
            return None;
        }

        if self.operation_blocked() {
            return Some("Finish the current Git operation before switching branches.".into());
        }

        if branch.worktree_path.is_some() {
            return Some("Checked out in another worktree".into());
        }

        if branch.kind == onegit_git::BranchKind::Remote {
            model::remote_target(branch, data).err()
        } else {
            None
        }
    }

    pub(super) fn choose(
        &mut self,
        index: usize,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.busy || self.blocked(index).is_some() {
            return;
        }

        let Some(branch) = self.data.as_ref().and_then(|data| data.branches.get(index)) else {
            return;
        };

        if branch.checked_out {
            self.close(window, cx);

            return;
        }

        if branch.kind == onegit_git::BranchKind::Remote {
            let name =
                model::remote_target(branch, self.data.as_ref().expect("branch data loaded"));

            if let Ok(name) = name {
                self.phase = Phase::Create {
                    remote: Some(branch.full_name.clone()),
                };
                self.name.update(cx, |input, cx| input.set_text(name, cx));
                cx.notify();
            }
        } else {
            self.request(BranchAction::Switch(branch.name.clone()), window, cx);
        }
    }

    pub(super) fn create(&mut self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        if self.busy || self.data.is_none() || self.operation_blocked() || self.dirty() {
            return;
        }

        self.phase = Phase::Create { remote: None };
        self.error = None;
        self.name.update(cx, |input, cx| input.set_text("", cx));
        window.focus(&self.name.read(cx).focus_handle(cx), cx);
        cx.notify();
    }

    fn request(
        &mut self,
        action: BranchAction,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let Some(source) = &self.source else {
            return;
        };

        let mut request = BranchRequest::new(action, &source.snapshot);

        if self.dirty()
            && matches!(
                &request.action,
                BranchAction::Switch(_) | BranchAction::Remote(_)
            )
        {
            let destination = match &request.action {
                BranchAction::Switch(name) => name.clone(),
                _ => self.name.read(cx).text().into(),
            };

            request.reviewed_source = Some(BranchIdentity::from_snapshot(&source.snapshot));
            self.phase = Phase::Changes {
                request: Box::new(request),
                destination,
                choice: BranchChanges::Leave,
            };
            self.error = None;
            window.focus(&self.list_focus, cx);
            cx.notify();
        } else {
            self.submit(request, cx);
        }
    }

    pub(super) fn confirm(&mut self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        if self.busy || self.operation_blocked() {
            return;
        }

        match &self.phase {
            Phase::Create { remote } => {
                let name = self.name.read(cx).text().trim().to_owned();

                if name.is_empty() {
                    return;
                }

                if remote.is_none() && self.dirty() {
                    return;
                }

                let action = remote
                    .clone()
                    .map_or(BranchAction::Create(name), BranchAction::Remote);

                self.request(action, window, cx);
            }
            Phase::Changes {
                request, choice, ..
            } => {
                let mut request = request.as_ref().clone();

                request.changes = Some(*choice);
                self.submit(request, cx);
            }
            Phase::Restore(saved) => {
                if let Some(source) = &self.source {
                    self.submit(
                        BranchRequest::new(
                            BranchAction::Restore {
                                branch: saved.branch.clone(),
                                oid: saved.oid.clone(),
                            },
                            &source.snapshot,
                        ),
                        cx,
                    );
                }
            }
            Phase::List => {}
        }
    }

    fn submit(&mut self, request: BranchRequest, cx: &mut gpui::Context<Self>) {
        if let Some(tab) = self.tab {
            self.busy = true;
            self.dialog.update(cx, |dialog, cx| {
                dialog.set_availability(onegit_ui::DialogAvailability::Busy, cx)
            });
            self.error = None;
            cx.emit(Submit { tab, request });
            cx.notify();
        }
    }

    pub fn finish(
        &mut self,
        result: Result<(), String>,
        loaded: Option<&Loaded>,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        self.busy = false;
        self.dialog.update(cx, |dialog, cx| {
            dialog.set_availability(onegit_ui::DialogAvailability::Ready, cx)
        });

        match result {
            Ok(()) => self.close(window, cx),
            Err(mut error) => {
                self.stale = loaded.is_none_or(|loaded| {
                    self.source.as_ref().is_some_and(|source| {
                        BranchIdentity::from_snapshot(&loaded.snapshot)
                            != BranchIdentity::from_snapshot(&source.snapshot)
                    }) || !write::available(loaded)
                        || loaded
                            .snapshot
                            .status
                            .files
                            .iter()
                            .any(|file| file.record_type != RecordType::Ignored)
                            != self.dirty
                });

                if self.stale {
                    error.push_str(" Close and reopen Branches to review the current repository.");
                }

                self.error = Some(error);
                cx.notify();
            }
        }
    }

    fn close(&mut self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        if !self.busy {
            self.dialog
                .update(cx, |dialog, cx| dialog.close(window, cx));
        }
    }

    fn back(&mut self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        if !self.busy {
            self.phase = Phase::List;
            self.error = None;
            window.focus(&self.query.read(cx).focus_handle(cx), cx);
            cx.notify();
        }
    }

    fn key(
        &mut self,
        event: &gpui::KeyDownEvent,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.busy || event.keystroke.modifiers.modified() {
            return;
        }

        let key = event.keystroke.key.as_str();

        if key == "escape" && !matches!(self.phase, Phase::List) {
            self.back(window, cx);
        } else if matches!(self.phase, Phase::List)
            && matches!(key, "down" | "up" | "enter" | "home" | "end")
        {
            if key == "enter" {
                if let Some(index) = self.highlighted.and_then(|i| self.visible.get(i).copied()) {
                    self.choose(index, window, cx);
                } else {
                    return;
                }
            } else {
                let enabled = self
                    .visible
                    .iter()
                    .enumerate()
                    .filter(|(_, index)| self.blocked(**index).is_none())
                    .map(|(i, _)| i)
                    .collect::<Vec<_>>();

                let next = match key {
                    "home" => enabled.first().copied(),
                    "end" => enabled.last().copied(),
                    "down" => enabled
                        .iter()
                        .find(|&&i| self.highlighted.is_none_or(|old| i > old))
                        .copied(),
                    _ => self
                        .highlighted
                        .and_then(|old| enabled.iter().rfind(|&&i| i < old).copied()),
                };

                self.highlighted = next;

                if let Some(index) = next {
                    window.focus(&self.list_focus, cx);
                    self.scroll
                        .scroll_to_item(index, gpui::ScrollStrategy::Nearest);
                } else {
                    window.focus(&self.query.read(cx).focus_handle(cx), cx);
                }

                cx.notify();
            }
        } else {
            return;
        }

        window.prevent_default();
        cx.stop_propagation();
    }
}

pub(super) struct Completed {
    pub root: std::path::PathBuf,
    pub loaded: Result<Arc<Loaded>, String>,
    pub result: Result<(), String>,
}

impl gpui::EventEmitter<Completed> for super::RepositoryWorkspace {}
