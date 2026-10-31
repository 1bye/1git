//! Anchored create/delete forms retain the exact reviewed request through selection changes.
use super::Submit;
use gpui_ce_motion::{Easing, MotionValue, Transition};
use onegit_git::{StashAction, StashRequest};

use onegit_ui::{
    Button, ButtonTone, ButtonVariant, CheckState, Checkbox, ControlSize, ControlState, Dialog,
    DialogAvailability, DialogDismissal, DialogHostState, DialogKind, DialogPresentation,
    DialogState, InputAvailability, InputState, TextInput,
};

use rake::gpui::{self, Focusable, prelude::*, px};

use std::{
    cell::Cell,
    rc::Rc,
    time::{Duration, Instant},
};

impl gpui::EventEmitter<Submit> for Form {}

pub(in crate::workspace) struct Form {
    dialog: gpui::Entity<DialogState>,
    request: Option<StashRequest>,
    title: String,
    message: gpui::Entity<InputState>,
    untracked: bool,
    busy: bool,
    blocked: bool,
    error: Option<String>,
    cancel: gpui::FocusHandle,
    pub create_anchor: Rc<Cell<gpui::Bounds<gpui::Pixels>>>,
    pub more_anchor: Rc<Cell<gpui::Bounds<gpui::Pixels>>>,
    epoch: Instant,
    height: MotionValue,
    opacity: MotionValue,
    _events: Vec<gpui::Subscription>,
}

impl Form {
    pub fn new(
        host: &DialogHostState,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> Self {
        let dialog = host.dialog(cx);
        let message = cx.new(|cx| InputState::new("", window, cx));

        let events = vec![cx.subscribe(
            &dialog,
            |this: &mut Self, _, _: &onegit_ui::DialogEvent, cx| {
                if !this.busy {
                    this.request = None;
                    this.error = None;
                }
                cx.notify();
            },
        )];

        Self {
            dialog,
            request: None,
            title: String::new(),
            message,
            untracked: false,
            busy: false,
            blocked: true,
            error: None,
            cancel: cx.focus_handle(),
            create_anchor: Rc::new(Cell::new(gpui::Bounds::default())),
            more_anchor: Rc::new(Cell::new(gpui::Bounds::default())),
            epoch: cx.background_executor().now(),
            height: MotionValue::new(160.),
            opacity: MotionValue::new(0.),
            _events: events,
        }
    }

    pub fn blocked(&mut self, blocked: bool, cx: &mut gpui::Context<Self>) {
        if self.blocked != blocked {
            self.blocked = blocked;
            cx.notify();
        }
    }

    pub fn open(
        &mut self,
        request: StashRequest,
        title: String,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.busy || self.blocked {
            return;
        }

        self.request = Some(request);
        self.title = title;
        self.error = None;
        self.epoch = cx.background_executor().now();
        self.opacity = MotionValue::new(0.);
        self.height = MotionValue::new(if self.saving() { 136. } else { 118. });
        self.dialog.update(cx, |state, cx| state.open(window, cx));
        cx.notify();
    }

    fn saving(&self) -> bool {
        self.request
            .as_ref()
            .is_some_and(|r| matches!(r.action, StashAction::Save { .. }))
    }

    fn close(&mut self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        if !self.busy {
            self.dialog.update(cx, |state, cx| state.close(window, cx));
        }
    }

    fn submit(&mut self, cx: &mut gpui::Context<Self>) {
        if self.blocked || self.busy {
            return;
        }

        let Some(mut request) = self.request.clone() else {
            return;
        };

        if let StashAction::Save {
            message,
            include_untracked,
        } = &mut request.action
        {
            *message = self.message.read(cx).text().to_owned();
            *include_untracked = self.untracked;
        }

        self.busy = true;
        self.error = None;
        self.dialog.update(cx, |state, cx| {
            state.set_availability(DialogAvailability::Busy, cx)
        });
        cx.emit(Submit(request));
        cx.notify();
    }

    pub fn finish(
        &mut self,
        result: Result<(), String>,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let saved_form = self.busy && self.saving();

        self.busy = false;
        self.dialog.update(cx, |state, cx| {
            state.set_availability(DialogAvailability::Ready, cx)
        });

        match result {
            Ok(()) => {
                if saved_form {
                    self.message.update(cx, |input, cx| input.set_text("", cx));
                }

                self.close(window, cx);
            }
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

        let saving = self.saving();
        let busy = self.busy;

        let enabled = if self.blocked || busy {
            ControlState::Disabled
        } else {
            ControlState::Enabled
        };

        let time = cx
            .background_executor()
            .now()
            .saturating_duration_since(self.epoch);

        let transition = Transition::Tween(Duration::from_millis(140), Easing::EaseOut);

        self.height.animate(
            if saving { 136. } else { 118. } + if self.error.is_some() { 100. } else { 0. },
            transition,
            time,
        );
        self.opacity.animate(1., transition, time);
        let height = self.height.sample(time, cx.reduce_motion());
        let opacity = self.opacity.sample(time, cx.reduce_motion());

        if height.is_animating() || opacity.is_animating() {
            window.request_animation_frame();
        }

        let initial = if saving {
            self.message.read(cx).focus_handle(cx)
        } else {
            self.cancel.clone()
        };

        let anchor = if saving {
            self.create_anchor.get()
        } else {
            self.more_anchor.get()
        };

        let origin = gpui::point(
            if saving {
                anchor.right() - px(300.)
            } else {
                anchor.left()
            },
            anchor.top() - px(height.value() as f32) - px(8.),
        );

        rake::view! {
            <Dialog width={px(300.)} presentation={DialogPresentation::Popover{origin,height:px(height.value()as f32)}}
                kind={if saving{DialogKind::Standard}else{DialogKind::Confirmation}} availability={if busy{DialogAvailability::Busy}else{DialogAvailability::Ready}}
                dismissal={DialogDismissal::EscapeAndOutside} initial_focus={Some(initial)}
                {..Dialog::new("stash-form",&self.dialog,if saving{"New stash"}else{"Delete stash?"})}>
                <div class="size-full min-h-0 flex flex-col gap-1.5 p-2" style={|s|s.opacity(opacity.value()as f32).debug_selector(||"stash-form-content".into())}>
                    <p class="text-small" role={gpui::accesskit::Role::Heading} style={|s|s.aria_level(2)}>{if saving{"Stash changes"}else{"Delete stash?"}}</p>
                    if saving {
                        <TextInput placeholder={"Message (optional)".into()} size={ControlSize::Medium} availability={if busy{InputAvailability::ReadOnly}else{InputAvailability::Enabled}} {..TextInput::new("stash-message",&self.message,"Stash message (optional)")}/>
                        <Checkbox checked={if self.untracked{CheckState::Checked}else{CheckState::Unchecked}} state={if busy{ControlState::Disabled}else{ControlState::Enabled}}
                            on_change={Some(Box::new(cx.listener(|this,value:&CheckState,_,cx|{this.untracked=*value==CheckState::Checked;cx.notify();})))} {..Checkbox::new("stash-untracked","Include untracked files")}/>
                    }else {
                        <p class="text-small" style={|s|s.line_clamp(2)}>{self.title.clone()}</p>
                        <p class="text-caption text-muted-ink">{"Removes this saved stash, not your working files. There is no undo in this app."}</p>
                    }
                    if let Some(error)=&self.error {<div id="stash-form-error" role={gpui::accesskit::Role::Alert} class="flex-1 min-h-0 overflow-y-scroll"><p class="text-caption text-danger">{error.clone()}</p></div>}
                    <div class="flex-1 min-h-0"/>
                    <div class="flex flex-row justify-end items-center gap-1.5 shrink-0">
                        <Button focus={Some(self.cancel.clone())} variant={ButtonVariant::Ghost} size={ControlSize::Small} state={if busy{ControlState::Disabled}else{ControlState::Enabled}}
                            on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.close(window,cx))))} {..Button::new("stash-cancel","Cancel")}/>
                        <Button variant={ButtonVariant::Primary} tone={ButtonTone::Normal} size={ControlSize::Small} state={if busy{ControlState::Busy}else{enabled}}
                            on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.submit(cx))))} {..Button::new("stash-confirm",if busy{"Working…"}else if saving{"Create stash"}else{"Delete stash"})}/>
                    </div>
                </div>
            </Dialog>
        }.into_any_element()
    }
}

#[cfg(all(test, feature = "test-support"))]
#[path = "form_tests.rs"]
mod tests;
