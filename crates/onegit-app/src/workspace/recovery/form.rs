//! Cancel-first confirmations with bounded GPU-driven resize and reveal transitions.
use super::{Action, Submit};
use crate::workspace::read::Loaded;
use gpui_ce_motion::{Easing, MotionValue, Transition};
use onegit_git::CommitMode;

use onegit_ui::{
    Button, ButtonVariant, CheckState, Checkbox, ControlSize, ControlState, Dialog,
    DialogAvailability, DialogDismissal, DialogHostState, DialogKind, DialogPresentation,
    DialogState,
};

use rake::gpui::{self, prelude::*, px};
use std::time::{Duration, Instant};

pub(in crate::workspace) struct Form {
    dialog: gpui::Entity<DialogState>,
    request: Option<Action>,
    pub busy: bool,
    blocked: bool,
    pub error: Option<String>,
    pub include_staged: bool,
    staged: usize,
    cancel: gpui::FocusHandle,
    epoch: Instant,
    height: MotionValue,
    opacity: MotionValue,
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
            include_staged: false,
            staged: 0,
            cancel: cx.focus_handle(),
            epoch: cx.background_executor().now(),
            height: MotionValue::new(380.),
            opacity: MotionValue::new(0.),
            _events: events,
        }
    }

    pub fn configure(
        &mut self,
        source: Option<&Loaded>,
        state: ControlState,
        cx: &mut gpui::Context<Self>,
    ) {
        let blocked = state == ControlState::Disabled;

        if !self.busy
            && let Some(request) = &self.request
            && !source.is_some_and(|source| request.review().matches(source))
        {
            let reason = source
                .and_then(|source| source.last_commit_unavailable.clone())
                .unwrap_or_else(|| {
                    "The repository or last commit changed. Cancel and review it again.".into()
                });

            if self.error.as_ref() != Some(&reason) {
                self.error = Some(reason);
                cx.notify();
            }
        }

        if self.blocked != blocked {
            self.blocked = blocked;
            cx.notify();
        }
    }

    pub fn open(
        &mut self,
        action: Action,
        staged: usize,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.busy || self.blocked {
            return;
        }

        self.request = Some(action);
        self.error = None;
        self.staged = staged;
        self.include_staged = staged > 0;
        self.epoch = cx.background_executor().now();
        self.opacity = MotionValue::new(0.);
        self.height = MotionValue::new(380.);
        self.dialog.update(cx, |dialog, cx| dialog.open(window, cx));
        cx.notify();
    }

    pub fn close(&mut self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        if !self.busy {
            self.dialog
                .update(cx, |dialog, cx| dialog.close(window, cx));
        }
    }

    pub fn submit(&mut self, cx: &mut gpui::Context<Self>) {
        if self.busy || self.blocked || self.error.is_some() {
            return;
        }

        let Some(mut action) = self.request.clone() else {
            return;
        };

        if let Action::Amend { mode, .. } = &mut action {
            *mode = if self.include_staged && self.staged > 0 {
                CommitMode::Staged
            } else {
                CommitMode::Files
            };
        }

        self.busy = true;
        cx.emit(Submit(action));
        cx.notify();
    }

    pub fn finish(
        &mut self,
        result: Result<(), String>,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        self.busy = false;

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

        let Some(request) = self.request.clone() else {
            return gpui::Empty.into_any_element();
        };

        let undo = matches!(request, Action::Undo(_));
        let verb = request.verb();
        let title = format!("{verb} last commit?");
        let commit = &request.review().commit;
        let short = commit.oid.chars().take(7).collect::<String>();

        let time = cx
            .background_executor()
            .now()
            .saturating_duration_since(self.epoch);

        let transition = Transition::Tween(Duration::from_millis(120), Easing::EaseOut);

        self.height.animate(
            if self.error.is_some() {
                468.
            } else if !undo && self.staged > 0 {
                416.
            } else {
                380.
            },
            transition,
            time,
        );
        self.opacity.animate(1., transition, time);
        let height = self.height.sample(time, cx.reduce_motion());
        let opacity = self.opacity.sample(time, cx.reduce_motion());

        if height.is_animating() || opacity.is_animating() {
            window.request_animation_frame();
        }

        static ICON: std::sync::OnceLock<std::sync::Arc<gpui::Image>> = std::sync::OnceLock::new();
        let icon = ICON
            .get_or_init(|| {
                std::sync::Arc::new(gpui::Image::from_bytes(
                    gpui::ImageFormat::Png,
                    include_bytes!("../assets/app-icon.png").to_vec(),
                ))
            })
            .clone();

        let state = if self.busy {
            ControlState::Busy
        } else if self.blocked || self.error.is_some() {
            ControlState::Disabled
        } else {
            ControlState::Enabled
        };

        let focused = self.cancel.is_focused(window);

        rake::view!{
            <Dialog kind={DialogKind::Confirmation} width={px(320.)}
                presentation={DialogPresentation::Alert {height:px(height.value() as f32)}}
                initial_focus={Some(self.cancel.clone())} dismissal={DialogDismissal::Escape}
                availability={if self.busy{DialogAvailability::Busy}else{DialogAvailability::Ready}}
                {..Dialog::new("last-commit-confirmation",&self.dialog,title.clone())}>
                <div class="size-full min-h-0 p-4 flex flex-col items-start"
                    style={|s|s.opacity(opacity.value() as f32).debug_selector(||"recovery-content".into())}>
                    <div class="relative size-[52px] ml-2.5 mt-2.5 mb-5 shrink-0">{gpui::img(icon).absolute().left(px(-6.)).top(px(-6.)).size(px(64.))}</div>
                    <div id="recovery-copy" class="w-full min-h-0 overflow-y-scroll flex flex-col px-1.5 gap-2">
                        <p class="text-[13px] leading-[16px] font-bold" role={gpui::accesskit::Role::Heading} style={|s|s.aria_level(2)}>{title.clone()}</p>
                        <p class="text-small font-medium">{format!("{short} · {}",commit.summary)}</p>
                        <p class="text-small">{if undo {
                            "Move this branch to the previous commit. Your working files and existing staging stay unchanged. The removed commit is retained in a recovery ref."
                        }else{
                            "Replace this unpublished commit with the edited message. Your ordinary draft will be restored afterward. The previous commit is retained in a recovery ref."
                        }}</p>
                        <p class="text-caption text-muted-ink">{"Publication is checked against known remote branches. This action does not fetch."}</p>
                        if !undo && self.staged>0 {
                            <Checkbox checked={if self.include_staged{CheckState::Checked}else{CheckState::Unchecked}}
                                state={if self.busy{ControlState::Disabled}else{ControlState::Enabled}}
                                on_change={Some(Box::new(cx.listener(|this,next:&CheckState,_,cx|{this.include_staged=*next==CheckState::Checked;cx.notify();})))}
                                {..Checkbox::new("amend-include-staged",format!("Include {} staged {}",self.staged,if self.staged==1{"file"}else{"files"}))}/>
                        }
                        if let Some(error)=&self.error {<div id="recovery-error" role={gpui::accesskit::Role::Alert}><p class="text-small text-danger">{error.clone()}</p></div>}
                    </div>
                    <div class="flex-1 min-h-[14px]"/>
                    <div class="w-full shrink-0 flex flex-col gap-1 items-center">
                        <div style={|s|s.debug_selector(||"recovery-confirm-button".into())}><Button width={Some(px(288.))} radius={Some(px(14.))} size={ControlSize::Medium} variant={ButtonVariant::Alert} state={state}
                            on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.submit(cx))))}
                            {..Button::new("recovery-confirm",if self.busy{"Working…".to_owned()}else{format!("{verb} commit")})}/></div>
                        <div class="border-2 rounded-[16px]" style={|s|s.border_color(if focused{onegit_ui::Theme::current().focus_ring}else{gpui::transparent_black()}).debug_selector(||"recovery-cancel-button".into())}>
                            <Button focus={Some(self.cancel.clone())} width={Some(px(288.))} radius={Some(px(14.))} size={ControlSize::Medium} variant={ButtonVariant::Alert}
                                state={if self.busy{ControlState::Disabled}else{ControlState::Enabled}}
                                on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.close(window,cx))))}
                                {..Button::new("recovery-cancel","Cancel")}/>
                        </div>
                    </div>
                </div>
            </Dialog>
        }.into_any_element()
    }
}
