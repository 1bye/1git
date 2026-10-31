//! Frozen replacement/abort consent with bounded, demand-driven motion.
use super::{Action, Submit};
use gpui_ce_motion::{Easing, MotionValue, Transition};

use onegit_ui::{
    Button, ButtonVariant, ControlSize, ControlState, Dialog, DialogAvailability, DialogDismissal,
    DialogHostState, DialogKind, DialogPresentation, DialogState,
};

use rake::gpui::{self, prelude::*, px};
use std::time::{Duration, Instant};

pub(in crate::workspace) struct Form {
    dialog: gpui::Entity<DialogState>,
    request: Option<Action>,
    pub busy: bool,
    blocked: bool,
    pub error: Option<String>,
    cancel: gpui::FocusHandle,
    pub replace_anchor: onegit_ui::AnchorBounds,
    pub abort_anchor: onegit_ui::AnchorBounds,
    origin: gpui::Point<gpui::Pixels>,
    epoch: Instant,
    opacity: MotionValue,
    height: MotionValue,
    _events: gpui::Subscription,
}

impl Form {
    pub fn new(host: &DialogHostState, cx: &mut gpui::Context<Self>) -> Self {
        let dialog = host.dialog(cx);

        let events = cx.subscribe(
            &dialog,
            |this: &mut Self, _, _: &onegit_ui::DialogEvent, cx| {
                if !this.busy {
                    this.request = None;
                    this.error = None;
                }

                cx.notify();
            },
        );

        Self {
            dialog,
            request: None,
            busy: false,
            blocked: true,
            error: None,
            cancel: cx.focus_handle(),
            replace_anchor: Default::default(),
            abort_anchor: Default::default(),
            origin: gpui::point(px(64.), px(150.)),
            epoch: cx.background_executor().now(),
            opacity: MotionValue::new(0.),
            height: MotionValue::new(108.),
            _events: events,
        }
    }

    pub fn configure(&mut self, blocked: bool, cx: &mut gpui::Context<Self>) {
        if self.blocked != blocked {
            self.blocked = blocked;
            cx.notify();
        }
    }

    pub fn open(
        &mut self,
        request: Action,
        origin: gpui::Point<gpui::Pixels>,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.busy || self.blocked {
            return;
        }

        self.height = MotionValue::new(request.height());
        self.request = Some(request);
        self.error = None;
        self.origin = origin;
        self.epoch = cx.background_executor().now();
        self.opacity = MotionValue::new(0.);
        self.dialog.update(cx, |dialog, cx| dialog.open(window, cx));
        cx.notify();
    }

    pub fn submit_action(&mut self, action: Action, cx: &mut gpui::Context<Self>) {
        if self.busy || self.blocked {
            return;
        }

        self.error = None;
        self.busy = true;
        self.dialog.update(cx, |dialog, cx| {
            dialog.set_availability(DialogAvailability::Busy, cx)
        });
        cx.emit(Submit(action));
        cx.notify();
    }

    fn confirm(&mut self, cx: &mut gpui::Context<Self>) {
        if self.error.is_some() {
            return;
        }

        if let Some(action) = self.request.clone() {
            self.submit_action(action, cx);
        }
    }

    fn close(&mut self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        if !self.busy {
            self.dialog
                .update(cx, |dialog, cx| dialog.close(window, cx));
        }
    }

    pub fn finish(
        &mut self,
        result: Result<(), String>,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        self.busy = false;
        self.dialog.update(cx, |dialog, cx| {
            dialog.set_availability(DialogAvailability::Ready, cx)
        });

        match result {
            Ok(()) => self.close(window, cx),
            Err(error) => self.error = Some(error),
        }

        cx.notify();
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

        let Some(request) = &self.request else {
            return gpui::Empty.into_any_element();
        };

        let title = request.title();
        let confirm = request.confirm();

        let copy = if matches!(request, Action::Resolve { .. }) {
            "Replace the whole file and mark it resolved? Current edits to this file will be lost."
        } else {
            "Git will attempt to return to the pre-operation state. Conflict-resolution edits may be lost. Save any work you need before aborting."
        };

        let time = cx
            .background_executor()
            .now()
            .saturating_duration_since(self.epoch);

        let transition = Transition::Tween(Duration::from_millis(140), Easing::EaseOut);

        self.opacity.animate(1., transition, time);
        self.height.animate(
            if self.error.is_some() {
                request.height() + 120.
            } else {
                request.height()
            },
            transition,
            time,
        );
        let opacity = self.opacity.sample(time, cx.reduce_motion());
        let height = self.height.sample(time, cx.reduce_motion());

        if opacity.is_animating() || height.is_animating() {
            window.request_animation_frame();
        }

        rake::view! {
            <Dialog kind={DialogKind::Confirmation} width={px(320.)}
                presentation={DialogPresentation::Popover { origin: self.origin, height: px(height.value() as f32) }}
                dismissal={DialogDismissal::EscapeAndOutside} initial_focus={Some(self.cancel.clone())}
                availability={if self.busy { DialogAvailability::Busy } else { DialogAvailability::Ready }}
                {..Dialog::new("conflict-confirmation", &self.dialog, title.clone())}>
                <div class="size-full min-h-0 flex flex-col p-2 gap-2" style={|s|s.opacity(opacity.value() as f32).debug_selector(||"conflict-confirmation-content".into())}>
                    <p class="text-small font-medium">{title.clone()}</p>
                    <p class={if matches!(request,Action::Resolve { .. }) {"text-small"}else{"text-caption text-muted-ink"}}>{copy}</p>
                    if let Some(error) = &self.error {<div id="conflict-confirmation-error" role={gpui::accesskit::Role::Alert} class="flex-1 min-h-0 overflow-y-scroll"><p class="text-caption text-danger">{error.clone()}</p></div>}
                    <div class="flex-1 min-h-0"/>
                    <div class="flex flex-row justify-end gap-1.5 shrink-0">
                        <div class="shrink-0" style={|s|s.debug_selector(||"conflict-cancel-button".into())}><Button focus={Some(self.cancel.clone())} variant={if matches!(request,Action::Resolve { .. }) {ButtonVariant::Secondary}else{ButtonVariant::Ghost}} size={ControlSize::Small}
                            state={if self.busy { ControlState::Disabled } else { ControlState::Enabled }}
                            on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.close(window,cx))))}
                            {..Button::new("conflict-cancel","Cancel")}/></div>
                        <div class="shrink-0" style={|s|s.debug_selector(||"conflict-confirm-button".into())}><Button size={ControlSize::Small} variant={ButtonVariant::Primary}
                            state={if self.busy { ControlState::Busy } else if self.blocked || self.error.is_some() { ControlState::Disabled } else { ControlState::Enabled }}
                            on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.confirm(cx))))}
                            {..Button::new("conflict-confirm",confirm)}/></div>
                    </div>
                </div>
            </Dialog>
        }.into_any_element()
    }
}

#[cfg(all(test, feature = "test-support"))]
#[path = "native_tests.rs"]
mod tests;
