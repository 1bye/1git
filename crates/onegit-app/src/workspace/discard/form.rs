//! Cancel-first confirmation retains exact paths and branch through automatic refreshes.
use super::{Action, Recovery, Selection, Submit};
use gpui_ce_motion::{Easing, MotionValue, Transition};
use onegit_git::DiscardScope;

use onegit_ui::{
    Button, ButtonVariant, ControlSize, ControlState, Dialog, DialogAvailability, DialogDismissal,
    DialogHostState, DialogKind, DialogPresentation, DialogState,
};

use rake::gpui::{self, prelude::*, px};

use std::{
    path::PathBuf,
    time::{Duration, Instant},
};

pub(in crate::workspace) struct Form {
    dialog: gpui::Entity<DialogState>,
    request: Option<Selection>,
    busy: bool,
    blocked: bool,
    error: Option<String>,
    cancel: gpui::FocusHandle,
    epoch: Instant,
    height: MotionValue,
    opacity: MotionValue,
    pub recovery_parent: Option<PathBuf>,
    pub recovery: Option<Recovery>,
    _events: gpui::Subscription,
}

impl Form {
    pub fn new(
        host: &DialogHostState,
        _window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> Self {
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
            epoch: cx.background_executor().now(),
            height: MotionValue::new(316.),
            opacity: MotionValue::new(0.),
            recovery_parent: crate::workspace::home::library::data_directory("1git-rust")
                .map(|dir| dir.join("discard-recovery")),
            recovery: None,
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
        request: Selection,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.busy || self.blocked {
            return;
        }

        self.request = Some(request);
        self.error = None;
        self.epoch = cx.background_executor().now();
        self.height = MotionValue::new(316.);
        self.opacity = MotionValue::new(0.);
        self.dialog.update(cx, |dialog, cx| dialog.open(window, cx));
        cx.notify();
    }

    fn close(&mut self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        if !self.busy {
            self.dialog
                .update(cx, |dialog, cx| dialog.close(window, cx));
        }
    }

    fn submit(&mut self, cx: &mut gpui::Context<Self>) {
        if self.busy || self.blocked || self.error.is_some() {
            return;
        }

        let Some(selection) = self.request.clone() else {
            return;
        };

        let Some(parent) = self.recovery_parent.clone() else {
            self.error = Some("Recovery storage is unavailable. Nothing was discarded.".into());
            cx.notify();

            return;
        };

        self.busy = true;
        self.dialog.update(cx, |dialog, cx| {
            dialog.set_availability(DialogAvailability::Busy, cx)
        });
        cx.emit(Submit(Action::Discard { selection, parent }));
        cx.notify();
    }

    pub fn restore(&mut self, cx: &mut gpui::Context<Self>) {
        if self.busy || self.blocked {
            return;
        }

        let Some(saved) = self.recovery.clone() else {
            return;
        };

        self.restore_saved(saved, cx);
    }

    pub fn restore_saved(&mut self, saved: Recovery, cx: &mut gpui::Context<Self>) {
        if self.busy || self.blocked {
            return;
        }

        self.busy = true;
        cx.emit(Submit(Action::Restore(saved)));
        cx.notify();
    }

    pub fn finish(
        &mut self,
        result: Result<(), String>,
        recovery: Option<Recovery>,
        restored: Option<&str>,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        self.busy = false;
        self.dialog.update(cx, |dialog, cx| {
            dialog.set_availability(DialogAvailability::Ready, cx)
        });

        if recovery.is_some() {
            self.recovery = recovery;
        }

        if result.is_ok()
            && self
                .recovery
                .as_ref()
                .is_some_and(|saved| Some(saved.undo.token.as_str()) == restored)
        {
            self.recovery = None;
        }

        match result {
            Ok(()) => self.close(window, cx),
            Err(error) => {
                self.error = Some(error);
            }
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

        let untracked = self
            .request
            .as_ref()
            .is_some_and(|request| request.scope == DiscardScope::Untracked);

        let label = self
            .request
            .as_ref()
            .map(|request| request.label.as_str())
            .unwrap_or("the selected files");

        let title = if untracked {
            format!("Delete {label}?")
        } else {
            format!("Discard changes to {label}?")
        };

        let time = cx
            .background_executor()
            .now()
            .saturating_duration_since(self.epoch);

        let transition = Transition::Tween(Duration::from_millis(140), Easing::EaseOut);

        self.height.animate(
            if self.error.is_some() { 416. } else { 316. },
            transition,
            time,
        );
        self.opacity.animate(1., transition, time);
        let height = self.height.sample(time, cx.reduce_motion());
        let opacity = self.opacity.sample(time, cx.reduce_motion());

        // Only an active transition requests another GPU frame.
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

        // Keep path separators with their preceding component, as the native alert does.
        let display_title = title.replace("/", "\u{2060}/\u{200b}");
        let cancel_focused = self.cancel.is_focused(window);
        let width = px(228.).min((window.viewport_size().width - px(48.)).max(px(1.)));

        rake::view! {
            <Dialog kind={DialogKind::Confirmation} width={px(260.)}
                presentation={DialogPresentation::Alert { height: px(height.value() as f32) }}
                initial_focus={Some(self.cancel.clone())} dismissal={DialogDismissal::Escape}
                availability={if self.busy { DialogAvailability::Busy } else { DialogAvailability::Ready }}
                {..Dialog::new("discard-confirmation", &self.dialog, title.clone())}>
                <div class="size-full min-h-0 flex flex-col items-start p-4"
                    style={|s|s.opacity(opacity.value() as f32).debug_selector(||"discard-content".into())}>
                    <div class="relative size-[52px] ml-2.5 mt-2.5 mb-6 shrink-0">{gpui::img(icon).absolute().left(px(-6.)).top(px(-6.)).size(px(64.))}</div>
                    <div id="discard-text" class="w-full min-h-0 overflow-y-scroll flex flex-col px-1.5" style={|s|s.debug_selector(||"discard-copy-viewport".into())}>
                        <p class="text-[13px] leading-[16px] font-bold mb-2.5" role={gpui::accesskit::Role::Heading} style={|s|s.aria_level(2)}>{display_title}</p>
                        <p class="text-[13px] leading-[16px] font-normal" style={|s|s.debug_selector(||"discard-copy".into())}>{if untracked {
                            "Removes the selected untracked files from disk. Tracked and staged files are kept. A recovery backup of the entire selection is saved on disk first."
                        } else {
                            "Removes all staged and unstaged changes to the selected files. Untracked files are kept. A recovery backup of the entire selection is saved on disk first."
                        }}</p>
                        if let Some(error) = &self.error {<div id="discard-error" role={gpui::accesskit::Role::Alert} class="mt-2"><p class="text-small text-danger">{error.clone()}</p></div>}
                    </div>
                    <div class="flex-1 min-h-[14px]"/>
                    <div class="w-full shrink-0 flex flex-col items-center gap-[4px]">
                        <div style={|s|s.debug_selector(||"discard-confirm-button".into())}>
                        <Button width={Some(width)} radius={Some(px(14.))} size={ControlSize::Medium} variant={ButtonVariant::Alert}
                            state={if self.busy { ControlState::Busy } else if self.blocked || self.request.is_none() || self.error.is_some() { ControlState::Disabled } else { ControlState::Enabled }}
                            on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.submit(cx))))}
                            {..Button::new("discard-confirm", if self.busy { "Working…" } else if untracked { "Delete files" } else { "Discard changes" })}/>
                        </div>
                        <div class="border-2 rounded-[16px]" style={|s|s.debug_selector(||"discard-cancel-button".into()).border_color(if cancel_focused {onegit_ui::Theme::current().focus_ring}else{gpui::transparent_black()})}>
                            <Button focus={Some(self.cancel.clone())} width={Some(width)} radius={Some(px(14.))} size={ControlSize::Medium}
                                state={if self.busy { ControlState::Disabled } else { ControlState::Enabled }}
                                variant={ButtonVariant::Alert} on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.close(window,cx))))}
                                {..Button::new("discard-cancel", "Cancel")}/>
                        </div>
                    </div>
                </div>
            </Dialog>
        }.into_any_element()
    }
}

#[cfg(all(test, feature = "test-support"))]
#[path = "native_tests.rs"]
mod tests;
