//! Frozen local tag intent; the shared replay queue owns writes and related-tab refresh.
use super::{Review, Submit};
use crate::workspace::read::Loaded;
use gpui_ce_motion::{Easing, MotionValue, Transition};
use onegit_git::{Cancellation, CommitInfo, Tag};

use onegit_ui::{
    Button, ButtonTone, ButtonVariant, ControlSize, ControlState, Dialog, DialogAvailability,
    DialogDismissal, DialogHostState, DialogPresentation, DialogState, DropdownMenu,
    InputAvailability, InputEvent, InputState, InputVariant, MenuItem, TextArea, TextInput,
};

use rake::gpui::{self, AppContext, Focusable, prelude::*, px};

use std::{
    sync::Arc,
    time::{Duration, Instant},
};

#[derive(Clone, Debug)]
pub(in crate::workspace) struct Open {
    pub commit: Arc<CommitInfo>,
    pub tag: Option<Tag>,
}

impl gpui::EventEmitter<Open> for crate::workspace::history::HistoryWorkspace {}

impl gpui::EventEmitter<Open> for crate::workspace::graph::Graph {}

#[derive(Clone, Debug)]
pub(in crate::workspace) enum Change {
    Create {
        name: String,
        annotation: Option<String>,
    },
    Delete(Tag),
}

#[derive(Clone, Debug)]
pub(in crate::workspace) struct Action {
    pub review: Review,
    pub change: Change,
    pub cancel: Cancellation,
}

impl Action {
    pub fn kind(&self) -> super::Kind {
        match self.change {
            Change::Create { .. } => super::Kind::CreateTag,
            Change::Delete(_) => super::Kind::DeleteTag,
        }
    }

    pub fn run(&self, source: &Loaded) -> Result<String, onegit_git::WriteError> {
        match &self.change {
            Change::Create { name, annotation } => {
                source.repository.create_reviewed_tag(
                    &onegit_git::ReviewedTag {
                        name,
                        annotation: annotation.as_deref(),
                        commit: &self.review.commit.oid,
                        expected: &self.review.expected,
                    },
                    Some(&self.cancel),
                )?;

                Ok(format!("Tag {name} created locally."))
            }
            Change::Delete(tag) => {
                source.repository.delete_reviewed_tag(
                    &onegit_git::DeleteReviewedTag {
                        name: &tag.name,
                        expected_oid: &tag.oid,
                        expected_target: &tag.target_oid,
                        expected: &self.review.expected,
                    },
                    Some(&self.cancel),
                )?;

                Ok(format!(
                    "Local tag {} deleted. Remote tags were kept. Original object: {}",
                    tag.name, tag.oid
                ))
            }
        }
    }
}

#[derive(Clone)]
pub(in crate::workspace) struct MenuContext {
    pub enabled: bool,
    pub tags: Arc<[Tag]>,
}

pub(in crate::workspace) fn context(source: Option<&Arc<Loaded>>, blocked: bool) -> MenuContext {
    MenuContext {
        enabled: !blocked
            && source.is_some_and(|s| {
                s.snapshot.status.head.oid.is_some() && crate::workspace::write::available(s)
            }),
        tags: source
            .and_then(|s| s.local_tags.as_ref().ok())
            .cloned()
            .unwrap_or_default(),
    }
}

pub(super) struct Form {
    dialog: gpui::Entity<DialogState>,
    review: Option<Review>,
    tag: Option<Tag>,
    source: Option<Arc<Loaded>>,
    name: gpui::Entity<InputState>,
    message: gpui::Entity<InputState>,
    annotated: bool,
    blocked: bool,
    busy: bool,
    error: Option<String>,
    epoch: Instant,
    height: MotionValue,
    opacity: MotionValue,
    deadline: Option<gpui::Task<()>>,
    cancel_focus: gpui::FocusHandle,
    _events: Vec<gpui::Subscription>,
}

impl gpui::EventEmitter<Submit> for Form {}

impl Form {
    pub fn new(
        host: &DialogHostState,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> Self {
        let name = cx.new(|cx| InputState::new("", window, cx));
        let message = cx.new(|cx| InputState::new("", window, cx));

        let events = [&name, &message]
            .into_iter()
            .map(|input| cx.subscribe(input, |_, _, _: &InputEvent, cx| cx.notify()))
            .collect();

        Self {
            dialog: host.dialog(cx),
            review: None,
            tag: None,
            source: None,
            name,
            message,
            annotated: true,
            blocked: true,
            busy: false,
            error: None,
            epoch: cx.background_executor().now(),
            height: MotionValue::new(280.),
            opacity: MotionValue::new(0.),
            deadline: None,
            cancel_focus: cx.focus_handle(),
            _events: events,
        }
    }

    pub fn configure(
        &mut self,
        source: Option<Arc<Loaded>>,
        blocked: bool,
        cx: &mut gpui::Context<Self>,
    ) {
        let changed = self.blocked != blocked
            || match (&self.source, &source) {
                (Some(a), Some(b)) => !Arc::ptr_eq(a, b),
                (None, None) => false,
                _ => true,
            };

        self.source = source;
        self.blocked = blocked;

        if changed && self.dialog.read(cx).is_open() {
            cx.notify();
        }
    }

    pub fn open(
        &mut self,
        source: Arc<Loaded>,
        event: &Open,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.busy || self.blocked {
            return;
        }

        self.review = Some(Review::new(&source, event.commit.clone()));
        self.tag = event.tag.clone();
        self.source = Some(source);
        self.error = None;
        self.annotated = true;
        self.name.update(cx, |input, cx| input.set_text("", cx));
        self.message.update(cx, |input, cx| input.set_text("", cx));
        self.epoch = cx.background_executor().now();
        self.height = MotionValue::new(self.base_height());
        self.opacity = MotionValue::new(0.);
        self.dialog.update(cx, |dialog, cx| dialog.open(window, cx));
        cx.notify();
    }

    fn reason(&self) -> Option<&str> {
        let review = self.review.as_ref()?;

        let Some(source) = &self.source else {
            return Some("The repository is unavailable. Cancel and review the tag again.");
        };

        if !review.matches(source) {
            return Some("The repository changed. Cancel and review the tag again.");
        }

        if self.blocked || !crate::workspace::write::available(source) {
            return Some("The repository is busy or needs a refresh.");
        }

        if let Some(tag) = &self.tag {
            match &source.local_tags {
                Ok(tags) if tags.iter().any(|t| t == tag) => {}
                _ => return Some("The tag changed or is unavailable. Cancel and review it again."),
            }
        }

        None
    }

    fn disabled(&self, cx: &gpui::App) -> bool {
        self.busy
            || self.error.is_some()
            || self.reason().is_some()
            || self.review.is_none()
            || (self.tag.is_none() && self.name.read(cx).text().trim().is_empty())
    }

    fn submit(&mut self, cx: &mut gpui::Context<Self>) {
        if self.disabled(cx) {
            return;
        }

        let Some(review) = self.review.clone() else {
            return;
        };

        let change = if let Some(tag) = &self.tag {
            Change::Delete(tag.clone())
        } else {
            let name = self.name.read(cx).text().trim().to_owned();

            let annotation = self.annotated.then(|| {
                let message = self.message.read(cx).text().trim();

                if message.is_empty() {
                    format!("Release {name}")
                } else {
                    message.into()
                }
            });

            Change::Create { name, annotation }
        };

        let cancel = Cancellation::default();

        self.busy = true;
        self.dialog.update(cx, |dialog, cx| {
            dialog.set_availability(DialogAvailability::Busy, cx)
        });
        let timer_cancel = cancel.clone();

        self.deadline = Some(cx.spawn(async move |_, cx| {
            cx.background_executor()
                .timer(Duration::from_secs(120))
                .await;
            timer_cancel.cancel();
        }));
        cx.emit(Submit(super::Action::Tag(Action {
            review,
            change,
            cancel,
        })));
        cx.notify();
    }

    pub fn finish(
        &mut self,
        result: Result<(), String>,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if !self.busy {
            return;
        }

        self.busy = false;
        self.deadline = None;
        self.dialog.update(cx, |dialog, cx| {
            dialog.set_availability(DialogAvailability::Ready, cx)
        });

        match result {
            Ok(()) => {
                self.dialog.update(cx, |dialog, cx| {
                    dialog.close(window, cx);
                });
            }
            Err(error) => self.error = Some(error),
        }

        cx.notify();
    }

    fn cancel(&mut self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        if self.busy {
            return;
        }

        self.dialog
            .update(cx, |dialog, cx| dialog.close(window, cx));
        cx.notify();
    }

    #[cfg(test)]
    pub(super) fn is_open(&self, cx: &gpui::App) -> bool {
        self.dialog.read(cx).is_open()
    }

    fn base_height(&self) -> f64 {
        if self.tag.is_some() {
            182.
        } else if self.annotated {
            280.
        } else {
            198.
        }
    }
}

impl Render for Form {
    fn render(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        if !self.dialog.read(cx).is_open() {
            return gpui::Empty.into_any_element();
        }

        let Some(review) = self.review.clone() else {
            return gpui::Empty.into_any_element();
        };

        let error = if self.busy {
            None
        } else {
            self.reason()
                .map(str::to_owned)
                .or_else(|| self.error.clone())
        };

        let transition = Transition::Tween(Duration::from_millis(120), Easing::EaseOut);

        let time = cx
            .background_executor()
            .now()
            .saturating_duration_since(self.epoch);

        self.opacity.animate(1., transition, time);
        self.height.animate(
            self.base_height() + if error.is_some() { 76. } else { 0. },
            transition,
            time,
        );
        let height = self.height.sample(time, cx.reduce_motion());
        let opacity = self.opacity.sample(time, cx.reduce_motion());

        if height.is_animating() || opacity.is_animating() {
            window.request_animation_frame();
        }

        let deleting = self.tag.is_some();
        let disabled = self.disabled(cx);

        let availability = if self.busy {
            InputAvailability::ReadOnly
        } else {
            InputAvailability::Enabled
        };

        let mut kind = DropdownMenu::new(
            "tag-kind",
            if self.annotated {
                "Annotated"
            } else {
                "Lightweight"
            },
        );

        kind.size = ControlSize::Small;
        kind.variant = ButtonVariant::Ghost;
        kind.state = if self.busy {
            ControlState::Disabled
        } else {
            ControlState::Enabled
        };
        kind.entries = vec![
            MenuItem {
                selected: Some(self.annotated),
                ..MenuItem::new("annotated", "Annotated")
            }
            .into(),
            MenuItem {
                selected: Some(!self.annotated),
                ..MenuItem::new("lightweight", "Lightweight")
            }
            .into(),
        ];
        kind.on_select = Some(Box::new(cx.listener(
            |this, id: &gpui::ElementId, _, cx| {
                if !this.busy {
                    this.annotated = *id == gpui::ElementId::from("annotated");
                    cx.notify();
                }
            },
        )));
        let tag = self.tag.clone();

        let title = if let Some(tag) = &tag {
            format!("Delete tag {}?", tag.name)
        } else {
            "Create tag".into()
        };

        rake::view! {
            <Dialog width={px(420.)} presentation={DialogPresentation::Compact{height:px(height.value()as f32)}}
                dismissal={DialogDismissal::EscapeAndOutside} availability={if self.busy{DialogAvailability::Busy}else{DialogAvailability::Ready}}
                initial_focus={Some(if deleting{self.cancel_focus.clone()}else{self.name.read(cx).focus_handle(cx)})}
                {..Dialog::new("tag-confirmation",&self.dialog,title.clone())}>
                <div class="size-full min-h-0 flex flex-col gap-3 p-2 overflow-y-scroll" style={|s|s.opacity(opacity.value()as f32).debug_selector(||"tag-panel".into())}>
                    <div class="shrink-0 h-[20px] flex flex-row items-center gap-2">
                        <p class="flex-1 min-w-0 text-title" wrap={false} ellipsis={true} style={|s|s.font_weight(gpui::FontWeight::NORMAL)}>{title.clone()}</p>
                        if !deleting {{kind}}
                    </div>
                    <p class="shrink-0 text-body" wrap={false} ellipsis={true}>{review.commit.summary.clone()}</p>
                    <p class="shrink-0 text-caption text-muted-ink">{review.commit.oid.chars().take(7).collect::<String>()}</p>
                    if let Some(tag)=&tag {
                        <p class="shrink-0 text-small text-muted-ink">"Delete only this local tag. The commit and remote tags stay unchanged."</p>
                        <p class="shrink-0 text-caption text-muted-ink" wrap={false} ellipsis={true}>{format!("Tag object: {}",tag.oid)}</p>
                    } else {
                        <TextInput variant={InputVariant::Surface} show_label={false} height={Some(px(30.))} availability={availability} placeholder={"v1.0.0".into()} {..TextInput::new("tag-name",&self.name,"Tag name")}/>
                        if self.annotated {
                            <TextArea variant={InputVariant::Surface} show_label={false} height={Some(px(70.))} availability={availability} placeholder={"Release message (optional)".into()} {..TextArea::new("tag-message",&self.message,"Tag message")}/>
                        }
                        <p class="shrink-0 text-small text-muted-ink">{if self.annotated{"Create an annotated local tag. Remote tags stay unchanged."}else{"Create a lightweight local tag. Remote tags stay unchanged."}}</p>
                    }
                    if let Some(error)=error {<div role={gpui::accesskit::Role::Alert} class="flex-1 min-h-0 overflow-y-scroll"><p class="text-body text-danger">{error}</p></div>}
                    <div class="shrink-0 flex flex-row justify-end gap-1" style={|s|s.debug_selector(||"tag-actions".into())}>
                        <Button focus={Some(self.cancel_focus.clone())} size={ControlSize::Small} variant={ButtonVariant::Secondary}
                            state={if self.busy{ControlState::Disabled}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.cancel(window,cx))))}
                            {..Button::new("tag-cancel","Cancel")}/>
                        <Button tone={if deleting{ButtonTone::Danger}else{ButtonTone::Normal}} size={ControlSize::Small} variant={ButtonVariant::Primary}
                            state={if self.busy{ControlState::Busy}else if disabled{ControlState::Disabled}else{ControlState::Enabled}}
                            on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.submit(cx))))}
                            {..Button::new("tag-confirm",if self.busy{if deleting{"Deleting…"}else{"Creating…"}}else if deleting{"Delete tag"}else{"Create tag"})}/>
                    </div>
                </div>
            </Dialog>
        }.into_any_element()
    }
}

#[cfg(all(test, feature = "test-support"))]
#[path = "tags_tests.rs"]
mod tests;
