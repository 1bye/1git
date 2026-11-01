//! Reviewed last-commit edits preserve ordinary drafts and unrelated tab intent.
mod form;
mod worker;

use super::{RepositoryState, RepositoryWorkspace, read::Loaded, write};
pub(super) use form::Form;
use onegit_git::{BranchIdentity, CommitInfo, CommitMode};
use onegit_ui::ControlState;
use rake::gpui::{self, Focusable};
use std::{path::PathBuf, sync::Arc};
pub(super) use worker::run;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::workspace) struct Draft {
    pub summary: String,
    pub description: String,
}

impl Draft {
    pub fn capture(view: &RepositoryWorkspace, cx: &gpui::App) -> Self {
        Self {
            summary: view.summary.read(cx).text().into(),
            description: view.description.read(cx).text().into(),
        }
    }

    pub fn from_message(message: &str) -> Self {
        let (summary, body) = message.split_once('\n').unwrap_or((message, ""));

        Self {
            summary: summary.into(),
            description: body.strip_prefix('\n').unwrap_or(body).into(),
        }
    }

    pub fn message(&self) -> String {
        if self.description.is_empty() {
            self.summary.clone()
        } else {
            format!("{}\n\n{}", self.summary, self.description)
        }
    }

    pub fn restore(
        &self,
        view: &mut RepositoryWorkspace,
        cx: &mut gpui::Context<RepositoryWorkspace>,
    ) {
        view.summary
            .update(cx, |input, cx| input.set_text(&self.summary, cx));
        view.description
            .update(cx, |input, cx| input.set_text(&self.description, cx));
    }

    pub fn is_empty(&self) -> bool {
        self.summary.is_empty() && self.description.is_empty()
    }
}

#[derive(Clone, Debug)]
pub(in crate::workspace) struct Review {
    pub root: PathBuf,
    pub expected: BranchIdentity,
    pub commit: Arc<CommitInfo>,
}

impl Review {
    pub fn new(source: &Loaded) -> Option<Self> {
        if source.last_commit_unavailable.is_some() || !write::available(source) {
            return None;
        }

        Some(Self {
            root: source.snapshot.repository.root.clone(),
            expected: BranchIdentity::from_snapshot(&source.snapshot),
            commit: source.last_commit.clone()?,
        })
    }

    pub fn matches(&self, source: &Loaded) -> bool {
        self.root == source.snapshot.repository.root
            && self.expected == BranchIdentity::from_snapshot(&source.snapshot)
            && source.last_commit_unavailable.is_none()
            && write::available(source)
    }
}

pub(in crate::workspace) struct Amend {
    pub review: Review,
    pub previous: Draft,
}

#[derive(Clone, Debug)]
pub(in crate::workspace) enum Action {
    Amend {
        review: Review,
        message: String,
        mode: CommitMode,
    },
    Undo(Review),
}

impl Action {
    pub fn review(&self) -> &Review {
        match self {
            Self::Amend { review, .. } | Self::Undo(review) => review,
        }
    }

    pub fn verb(&self) -> &'static str {
        match self {
            Self::Amend { .. } => "Amend",
            Self::Undo(_) => "Undo",
        }
    }
}

pub(in crate::workspace) struct Submit(pub Action);

#[derive(Clone, Debug)]
pub(in crate::workspace) enum Effect {
    Unchanged,
    Amended,
    Undone(String),
}

pub(in crate::workspace) struct Completed {
    pub snapshots: Vec<(PathBuf, Result<Arc<Loaded>, String>)>,
    pub effect: Effect,
    pub needs_review: bool,
    pub result: Result<(), String>,
}

impl gpui::EventEmitter<Submit> for Form {}

impl gpui::EventEmitter<Submit> for RepositoryWorkspace {}

impl gpui::EventEmitter<Completed> for RepositoryWorkspace {}

impl RepositoryWorkspace {
    pub(super) fn begin_amend(
        &mut self,
        review: Review,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if !self.can_write()
            || self.amend.is_some()
            || !matches!(&self.state,RepositoryState::Ready(source) if review.matches(source))
        {
            return;
        }

        let previous = Draft::capture(self, cx);

        let message = if review.commit.body.is_empty() {
            &review.commit.summary
        } else {
            &review.commit.body
        };

        Draft::from_message(message).restore(self, cx);
        self.amend = Some(Amend { review, previous });
        window.focus(&self.summary.read(cx).focus_handle(cx), cx);
        cx.notify();
    }

    pub(super) fn cancel_amend(&mut self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        if self.write_job.is_some() || self.repository_busy || self.recovery.read(cx).busy {
            return;
        }

        if let Some(amend) = self.amend.take() {
            amend.previous.restore(self, cx);
        }

        window.focus(&self.summary.read(cx).focus_handle(cx), cx);
        cx.notify();
    }

    pub(super) fn amend_current(&self) -> bool {
        self.amend.as_ref().is_some_and(|amend|matches!(&self.state,RepositoryState::Ready(source) if amend.review.matches(source)))
    }

    pub(super) fn review_undo(
        &mut self,
        review: Review,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if !self.can_write()
            || self.amend.is_some()
            || !matches!(&self.state,RepositoryState::Ready(source) if review.matches(source))
        {
            return;
        }

        self.recovery.update(cx, |form, cx| {
            form.open(Action::Undo(review), 0, window, cx)
        });
    }

    pub(super) fn review_amend(&mut self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        let Some(amend) = &self.amend else {
            return;
        };

        let action = Action::Amend {
            review: amend.review.clone(),
            message: Draft::capture(self, cx).message(),
            mode: CommitMode::Staged,
        };

        let count = match &self.state {
            RepositoryState::Ready(source) => write::staged_count(source),
            _ => 0,
        };

        self.recovery
            .update(cx, |form, cx| form.open(action, count, window, cx));
    }

    pub(super) fn configure_recovery(&self, cx: &mut gpui::Context<Self>) {
        let source = match &self.state {
            RepositoryState::Ready(source) => Some(source.as_ref()),
            _ => None,
        };

        let state = if self.write_job.is_some() {
            ControlState::Busy
        } else if self.can_write() {
            ControlState::Enabled
        } else {
            ControlState::Disabled
        };

        self.recovery
            .update(cx, |form, cx| form.configure(source, state, cx));
    }

    pub(super) fn recovery_finished(
        &mut self,
        event: &Completed,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        match &event.effect {
            Effect::Amended => {
                if let Some(amend) = self.amend.take() {
                    amend.previous.restore(self, cx);
                }
            }
            Effect::Undone(message) if Draft::capture(self, cx).is_empty() => {
                Draft::from_message(message).restore(self, cx)
            }
            Effect::Unchanged | Effect::Undone(_) => {}
        }

        if event.needs_review {
            self.refresh_blocked = true;
            self.refresh_error =
                Some("Review the result in History, then refresh before writing again.".into());
        }

        self.recovery
            .update(cx, |form, cx| form.finish(event.result.clone(), window, cx));
        cx.notify();
    }
}

pub(super) struct Composer {
    height: gpui_ce_motion::MotionValue,
    epoch: std::time::Instant,
}

impl Composer {
    pub fn new(epoch: std::time::Instant) -> Self {
        Self {
            height: gpui_ce_motion::MotionValue::new(140.),
            epoch,
        }
    }

    pub fn sample(
        &mut self,
        amend: Option<&Amend>,
        window: &mut gpui::Window,
        cx: &gpui::App,
    ) -> gpui::Pixels {
        let time = cx
            .background_executor()
            .now()
            .saturating_duration_since(self.epoch);

        self.height.animate(
            if amend.is_some() { 172. } else { 140. },
            gpui_ce_motion::Transition::Tween(
                std::time::Duration::from_millis(120),
                gpui_ce_motion::Easing::EaseOut,
            ),
            time,
        );
        let height = self.height.sample(time, cx.reduce_motion());

        if height.is_animating() {
            window.request_animation_frame();
        }

        gpui::px(height.value() as f32)
    }
}
