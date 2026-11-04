//! Attached integration review retains exact source/target tips until explicit submission.
use super::{Phase, Picker};
use onegit_git::{Branch, BranchIdentity, IntegrationKind, IntegrationRequest};

use onegit_ui::{
    Button, ButtonVariant, ControlSize, ControlState, InputAvailability, InputVariant, ListRow,
    ListRowVariant, RowSelection, Text, TextArea, TextInput, TextRole, TextTone,
};

use rake::gpui::{self, Focusable, prelude::*, px};

// Content-sized controls from the reference's fixed 288-pixel attached form.
fn mode_width(kind: IntegrationKind) -> f32 {
    match kind {
        IntegrationKind::Merge => 69.5,
        IntegrationKind::SquashMerge => 112.,
        IntegrationKind::Rebase => 74.5,
    }
}

fn label(kind: IntegrationKind) -> &'static str {
    match kind {
        IntegrationKind::Merge => "Merge",
        IntegrationKind::Rebase => "Rebase",
        IntegrationKind::SquashMerge => "Squash merge",
    }
}

fn empty_search() -> gpui::AnyElement {
    let drawing = gpui::canvas(
        |_, _, _| {},
        |bounds, _, window, cx| {
            window
                .paint_svg(
                    bounds,
                    "onegit-app/state-search".into(),
                    Some(include_bytes!("../assets/state-search.svg")),
                    Default::default(),
                    onegit_ui::Theme::current().muted_ink,
                    cx,
                )
                .expect("original search artwork is valid");
        },
    )
    .w(px(80.))
    .h(px(56.))
    .flex_shrink_0();

    rake::view! {
        <div class="size-full min-h-0 flex flex-col items-center justify-center gap-2 p-3" role={gpui::accesskit::Role::Status} aria-label="No matching branches">
            {drawing}<p class="text-small font-medium text-center">{"No matching branches"}</p>
        </div>
    }.into_any_element()
}

impl Picker {
    pub(super) fn can_integrate(&self) -> bool {
        !self.busy
            && !self.operation_blocked()
            && !self.dirty()
            && !self.integration_blocked
            && self.source.as_ref().is_some_and(|source| {
                source.snapshot.status.head.oid.is_some()
                    && source.snapshot.status.head.branch.is_some()
            })
            && self.data.as_ref().is_some_and(|data| {
                data.branches.iter().any(|branch| {
                    !(branch.kind == onegit_git::BranchKind::Local
                        && Some(&branch.name) == data.current.as_ref())
                })
            })
    }

    pub(super) fn integrate(&mut self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        if !self.can_integrate() {
            return;
        }

        self.phase = Phase::Integrate {
            kind: IntegrationKind::Merge,
            target: None,
        };
        self.error = None;
        self.integration_query
            .update(cx, |input, cx| input.set_text("", cx));
        self.integration_message
            .update(cx, |input, cx| input.set_text("", cx));
        self.filter(cx);
        window.focus(&self.integration_query.read(cx).focus_handle(cx), cx);
        cx.notify();
    }

    pub(super) fn select_integration(&mut self, branch: Branch, cx: &mut gpui::Context<Self>) {
        if !self.can_integrate()
            || !self.data.as_ref().is_some_and(|data| {
                self.visible
                    .iter()
                    .any(|&i| data.branches[i].full_name == branch.full_name)
            })
        {
            return;
        }

        let source = self
            .source
            .as_ref()
            .and_then(|source| source.snapshot.status.head.branch.as_deref())
            .unwrap_or_default();

        self.integration_message.update(cx, |input, cx| {
            input.set_text(format!("Squash merge {} into {source}", branch.name), cx)
        });

        if let Phase::Integrate { target, .. } = &mut self.phase {
            *target = Some(branch);
        }

        cx.notify();
    }

    pub(super) fn integration_request(&self, cx: &gpui::App) -> Option<IntegrationRequest> {
        if !self.can_integrate() {
            return None;
        }

        let Phase::Integrate {
            kind,
            target: Some(target),
        } = &self.phase
        else {
            return None;
        };

        let data = self.data.as_ref()?;

        if !self.visible.iter().any(|&i| {
            data.branches[i].full_name == target.full_name && data.branches[i].oid == target.oid
        }) {
            return None;
        }

        let message = self.integration_message.read(cx).text();

        if *kind == IntegrationKind::SquashMerge
            && (message.contains('\0')
                || message
                    .lines()
                    .next()
                    .is_none_or(|line| line.trim().is_empty()))
        {
            return None;
        }

        let expected = BranchIdentity::from_snapshot(&self.source.as_ref()?.snapshot);

        Some(IntegrationRequest {
            kind: *kind,
            target: target.full_name.clone(),
            expected_target: target.oid.clone(),
            reviewed_source: Some(expected.clone()),
            expected,
            message: (*kind == IntegrationKind::SquashMerge).then(|| message.to_owned()),
        })
    }

    pub(super) fn integration_key(
        &mut self,
        event: &gpui::KeyDownEvent,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if matches!(self.phase, Phase::Integrate { .. })
            && event.keystroke.key == "enter"
            && !event.keystroke.modifiers.modified()
            && self
                .row_focus
                .values()
                .any(|focus| focus.contains_focused(window, cx))
        {
            self.confirm(window, cx);
            window.prevent_default();
            cx.stop_propagation();
        }
    }

    fn integration_rows(&self, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        gpui::uniform_list("integration-targets",self.visible.len(),cx.processor(|this,range:std::ops::Range<usize>,_,cx| {
            range.map(|position| {
                let index = this.visible[position];
                let branch = this.data.as_ref().expect("integration branches loaded").branches[index].clone();
                let focus = this.row_focus.entry(branch.full_name.clone()).or_insert_with(||cx.focus_handle()).clone();
                let selected = matches!(&this.phase,Phase::Integrate{target:Some(target),..} if target.full_name == branch.full_name);
                let interactive = this.can_integrate();

                rake::view! {
                    <div class="w-full h-[28px] min-w-0" style={|s|s.track_focus(&focus).debug_selector(move||format!("integration-target-{position}"))}>
                        <ListRow tab_index={-1} variant={ListRowVariant::Menu} state={if interactive{ControlState::Enabled}else{ControlState::Disabled}} selection={if selected{RowSelection::Selected}else{RowSelection::Unselected}}
                            label_content={Some(rake::view!{<Text role={TextRole::Small} max_lines={Some(1)} {..Text::new("target-name",branch.name.clone())}/>}.into_any_element())}
                            on_press={Some(Box::new(cx.listener(move|this,_,window,cx|this.choose(index,window,cx))))}
                            {..ListRow::new(("integration-target",index),branch.name)}/>
                    </div>
                }.into_any_element()
            }).collect()
        })).size_full().min_h_0().track_scroll(&self.scroll).into_any_element()
    }

    pub(super) fn integration_form(&self, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let Phase::Integrate { kind, target } = &self.phase else {
            return gpui::Empty.into_any_element();
        };

        let kind = *kind;

        let branch = self
            .source
            .as_ref()
            .and_then(|source| source.snapshot.status.head.branch.as_deref())
            .unwrap_or_default();

        let title = if kind == IntegrationKind::Rebase {
            format!("Rebase {branch} onto…")
        } else {
            format!("{} into {branch}", label(kind))
        };

        let detail = if let Some(target) = target {
            match kind {
                IntegrationKind::Merge => format!(
                    "Merge {} into {branch}. Conflicts can be resolved in Changes.",
                    target.name
                ),
                IntegrationKind::Rebase => format!(
                    "Replay {branch} onto {}. Only unpublished commits can be rewritten.",
                    target.name
                ),
                IntegrationKind::SquashMerge => format!(
                    "Combine {} into one new commit on {branch}. The source branch is kept.",
                    target.name
                ),
            }
        } else {
            "Choose another branch. Your current branch stays selected.".into()
        };

        let availability = if self.busy {
            InputAvailability::ReadOnly
        } else {
            InputAvailability::Enabled
        };

        let rows = self.integration_rows(cx);

        rake::view! {
            <div class="flex-1 min-h-0 flex flex-col p-2 gap-2" style={|s|s.debug_selector(||"branch-integration-form".into())}>
                <p class="text-body font-medium shrink-0">{title}</p>
                <div role={gpui::accesskit::Role::Group} aria-label="Branch integration method" class="flex flex-row gap-1 shrink-0">
                    for mode in [IntegrationKind::Merge,IntegrationKind::SquashMerge,IntegrationKind::Rebase] {
                        <div id={format!("integration-mode-wrap-{}",label(mode))} class="min-w-0 shrink-0" style={|s|s.w(px(mode_width(mode))).debug_selector(move||format!("integration-mode-{}",label(mode).replace(' ',"-").to_lowercase()))}>
                            <Button width={Some(px(mode_width(mode)))} padding={Some(px(4.))} size={ControlSize::Small}
                                accessibility_label={Some(format!("{}{}",label(mode),if kind==mode{", selected"}else{""}).into())}
                                variant={if kind==mode{ButtonVariant::Secondary}else{ButtonVariant::Ghost}} state={if self.busy{ControlState::Disabled}else{ControlState::Enabled}}
                                on_press={Some(Box::new(cx.listener(move|this,_,_,cx|{if !this.busy {if let Phase::Integrate{kind,..}=&mut this.phase{*kind=mode;}cx.notify();}})))}
                                {..Button::new(format!("integration-mode-{}",label(mode)),label(mode))}/>
                        </div>
                    }
                </div>
                <div class="h-[30px] shrink-0">
                    <TextInput variant={InputVariant::Surface} height={Some(px(30.))} show_label={false} size={ControlSize::Medium} placeholder={"Search branches…".into()} availability={availability}
                        {..TextInput::new("integration-search",&self.integration_query,if kind==IntegrationKind::Rebase{"Search branches to rebase onto"}else{"Search branches to merge"})}/>
                </div>
                <div class="flex-1 min-h-0 px-1.5" style={|s|s.debug_selector(||"integration-target-list".into())}>
                    if self.visible.is_empty() {
                        {empty_search()}
                    } else {{rows}}
                </div>
                if kind == IntegrationKind::SquashMerge {
                    <div class="h-[54px] shrink-0"><TextArea show_label={false} variant={InputVariant::Surface} text_role={Some(TextRole::Small)} size={ControlSize::Medium} height={Some(px(54.))} availability={availability} placeholder={"Commit message…".into()}
                        {..TextArea::new("squash-integration-message",&self.integration_message,"Squash commit message")}/></div>
                }
                <div class="shrink-0" style={|s|s.debug_selector(||"integration-guidance".into())}><Text role={TextRole::Small} tone={TextTone::Muted} {..Text::new("integration-summary",detail)}/></div>
                <div class="flex flex-row justify-between gap-2 shrink-0" style={|s|s.debug_selector(||"integration-actions".into())}>
                    <Button focus={Some(self.cancel_focus.clone())} size={ControlSize::Small} variant={ButtonVariant::Secondary} state={if self.busy{ControlState::Disabled}else{ControlState::Enabled}}
                        on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.back(window,cx))))} {..Button::new("cancel-integration","Cancel")}/>
                    <Button size={ControlSize::Small} variant={ButtonVariant::Primary} state={if self.busy{ControlState::Busy}else if self.integration_request(cx).is_some(){ControlState::Enabled}else{ControlState::Disabled}}
                        on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.confirm(window,cx))))}
                        {..Button::new("confirm-integration",if self.busy{if kind==IntegrationKind::Rebase{"Rebasing…"}else{"Merging…"}}else if kind==IntegrationKind::Merge{"Merge branch"}else{label(kind)})}/>
                </div>
            </div>
        }.into_any_element()
    }
}
