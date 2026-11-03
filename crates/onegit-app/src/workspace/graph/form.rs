//! Review an immutable graph commit; creation never checks out or replaces a branch.
use super::super::read::Loaded;
use gpui_ce_motion::{Easing, MotionValue, Transition};

use onegit_ui::{
    Button, ButtonVariant, ControlSize, ControlState, Dialog, DialogAvailability, DialogDismissal,
    DialogHostState, DialogPresentation, DialogState, InputAvailability, InputEvent, InputState,
    TextInput,
};

use rake::gpui::{self, Focusable, prelude::*, px};

use std::{
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};

#[derive(Clone, Debug)]
pub(in crate::workspace) struct Submit {
    pub root: PathBuf,
    pub name: String,
    pub oid: String,
}

pub(in crate::workspace) struct Form {
    dialog: gpui::Entity<DialogState>,
    pub(super) name: gpui::Entity<InputState>,
    target: Option<(PathBuf, Arc<onegit_git::CommitInfo>)>,
    names: Vec<String>,
    pub(super) busy: bool,
    blocked: bool,
    error: Option<String>,
    uncertain: bool,
    epoch: Instant,
    opacity: MotionValue,
    height: MotionValue,
    _events: Vec<gpui::Subscription>,
}

impl gpui::EventEmitter<Submit> for Form {}

impl Form {
    pub fn new(
        host: &DialogHostState,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> Self {
        let dialog = host.dialog(cx);
        let name = cx.new(|cx| InputState::new("", window, cx));

        let events = vec![
            cx.subscribe_in(&name, window, |this, _, event: &InputEvent, _, cx| {
                if *event == InputEvent::Changed && !this.uncertain {
                    this.error = None;
                }
                if *event == InputEvent::Submitted {
                    this.submit(cx);
                }
                cx.notify();
            }),
        ];

        Self {
            dialog,
            name,
            target: None,
            names: Vec::new(),
            busy: false,
            blocked: true,
            error: None,
            uncertain: false,
            epoch: cx.background_executor().now(),
            opacity: MotionValue::new(0.),
            height: MotionValue::new(220.),
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
        source: &Loaded,
        commit: Arc<onegit_git::CommitInfo>,
        names: Vec<String>,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.busy || self.blocked {
            return;
        }

        self.target = Some((source.snapshot.repository.root.clone(), commit));
        self.names = names;
        self.error = None;
        self.uncertain = false;
        self.name.update(cx, |input, cx| input.set_text("", cx));
        self.epoch = cx.background_executor().now();
        self.opacity = MotionValue::new(0.);
        self.dialog.update(cx, |state, cx| state.open(window, cx));
        cx.notify();
    }

    #[cfg(test)]
    pub(super) fn is_open(&self, cx: &gpui::App) -> bool {
        self.dialog.read(cx).is_open()
    }

    fn name_error(&self, cx: &gpui::App) -> Option<&'static str> {
        let name = self.name.read(cx).text().trim();

        if name.is_empty() {
            return None;
        }

        if self.names.iter().any(|existing| existing == name) {
            Some("This branch already exists. Choose another name.")
        } else if name.starts_with('-')
            || name.contains(char::is_whitespace)
            || name.contains("..")
            || name.contains("@{")
            || name.contains(['~', '^', ':', '?', '*', '[', '\\'])
            || name.starts_with('/')
            || name.ends_with('/')
            || name.ends_with('.')
            || name
                .split('/')
                .any(|part| part.is_empty() || part.starts_with('.') || part.ends_with(".lock"))
            || name == "@"
        {
            Some("Choose a valid Git branch name.")
        } else {
            None
        }
    }

    pub(super) fn submit(&mut self, cx: &mut gpui::Context<Self>) {
        if self.busy || self.blocked || self.uncertain || self.name_error(cx).is_some() {
            return;
        }

        let name = self.name.read(cx).text().trim().to_owned();

        let Some((root, commit)) = &self.target else {
            return;
        };

        if name.is_empty() {
            return;
        }

        let submit = Submit {
            root: root.clone(),
            name,
            oid: commit.oid.clone(),
        };

        self.busy = true;
        self.error = None;
        self.dialog.update(cx, |state, cx| {
            state.set_availability(DialogAvailability::Busy, cx)
        });
        cx.emit(submit);
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
        self.dialog.update(cx, |state, cx| {
            state.set_availability(DialogAvailability::Ready, cx)
        });

        match result {
            Ok(()) => {
                self.dialog.update(cx, |state, cx| state.close(window, cx));
            }
            Err(error) => {
                self.uncertain = !error.contains("The branch operation did not start.");
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

        let Some((_, commit)) = &self.target else {
            return gpui::Empty.into_any_element();
        };

        let name_error = self.name_error(cx);

        let blocked = self.busy
            || self.blocked
            || self.uncertain
            || self.name.read(cx).text().trim().is_empty()
            || name_error.is_some();

        let time = cx
            .background_executor()
            .now()
            .saturating_duration_since(self.epoch);

        self.opacity.animate(
            1.,
            Transition::Tween(Duration::from_millis(120), Easing::EaseOut),
            time,
        );
        self.height.animate(
            if self.error.is_some() || name_error.is_some() {
                286.
            } else {
                220.
            },
            Transition::Tween(Duration::from_millis(120), Easing::EaseOut),
            time,
        );
        let height = self.height.sample(time, cx.reduce_motion());
        let opacity = self.opacity.sample(time, cx.reduce_motion());

        if opacity.is_animating() || height.is_animating() {
            window.request_animation_frame();
        }

        rake::view! {
            <Dialog width={px(400.)} presentation={DialogPresentation::Compact{height:px(height.value()as f32)}} dismissal={DialogDismissal::EscapeAndOutside}
                availability={if self.busy{DialogAvailability::Busy}else{DialogAvailability::Ready}} initial_focus={Some(self.name.read(cx).focus_handle(cx))}
                {..Dialog::new("graph-create-branch",&self.dialog,"Create branch here")}>
                <div class="size-full min-h-0 flex flex-col gap-3 p-2" style={|s|s.opacity(opacity.value()as f32)}>
                    <p class="shrink-0 text-title" style={|s|s.font_weight(gpui::FontWeight::NORMAL)}>{"Create branch here"}</p>
                    <p class="shrink-0 text-body" style={|s|s.line_clamp(2)}>{commit.summary.clone()}</p>
                    <p class="shrink-0 text-caption text-muted-ink">{commit.oid.chars().take(7).collect::<String>()}</p>
                    <TextInput show_label={false} height={Some(px(32.))} availability={if self.busy||self.uncertain{InputAvailability::ReadOnly}else{InputAvailability::Enabled}} placeholder={"New branch name…".into()} {..TextInput::new("graph-branch-name",&self.name,"New branch name")}/>
                    <p class="shrink-0 text-small text-muted-ink">{"Your current branch and working files stay in place. Switch to the new branch when you're ready."}</p>
                    if let Some(error)=self.error.as_deref().or(name_error){<div id="graph-branch-error" role={gpui::accesskit::Role::Alert} class="flex-1 min-h-0 overflow-y-scroll"><p class="text-small text-danger">{error}</p></div>}
                    <div class="shrink-0 flex flex-row justify-end gap-2">
                        <Button variant={ButtonVariant::Ghost} size={ControlSize::Small} state={if self.busy{ControlState::Disabled}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(|this,_,window,cx|{this.dialog.update(cx,|state,cx|state.close(window,cx));})))} {..Button::new("graph-branch-cancel","Cancel")}/>
                        <Button variant={ButtonVariant::Primary} size={ControlSize::Small} state={if self.busy{ControlState::Busy}else if blocked{ControlState::Disabled}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.submit(cx))))} {..Button::new("graph-branch-create","Create branch")}/>
                    </div>
                </div>
            </Dialog>
        }.into_any_element()
    }
}
