use super::{Phase, Picker, model};
use onegit_git::{BranchChanges, BranchKind};

use onegit_ui::{
    Button, ButtonVariant, ControlSize, ControlState, Dialog, DialogAvailability, DialogDismissal,
    DialogPresentation, Icon, IconName, IconSize, InputAvailability, ListRow, ListRowVariant,
    RowSelection, Text, TextInput, TextRole, TextTone,
};

use rake::gpui::{self, Focusable, prelude::*, px};
use std::ops::Range;

impl Picker {
    fn notice(&self) -> Option<String> {
        self.error.clone().or_else(|| {
            if self.busy {Some("Updating workspace…".into())}
            else if self.stale {Some("The repository changed. Close and reopen Branches to review it.".into())}
            else if self.operation_blocked() {Some("Finish the current Git operation before switching branches.".into())}
            else if self.dirty() {Some("Choose a branch to leave or bring your changes. Commit or stash before creating a branch.".into())}
            else {None}
        })
    }

    fn preview(&self, cx: &mut gpui::Context<Self>) -> Option<gpui::AnyElement> {
        let source = self.source.as_ref().filter(|_| self.origin.y < px(42.))?;
        let root = &source.snapshot.repository.root;

        let name = root
            .file_name()
            .unwrap_or(root.as_os_str())
            .to_string_lossy()
            .escape_debug()
            .to_string();

        let branch = source
            .snapshot
            .status
            .head
            .branch
            .as_deref()
            .unwrap_or("Detached HEAD");

        let avatar = self.home.read(cx).repository_avatar(Some(root), &name, 14.);
        let surface = super::super::chrome::tab_surface();

        let label = gpui::StyledText::new(gpui::SharedString::from(format!("{name} / {branch}")))
            .with_highlights([(
                name.len()..name.len() + 3 + branch.len(),
                gpui::HighlightStyle {
                    color: Some(onegit_ui::Theme::current().muted_ink),
                    ..Default::default()
                },
            )]);

        Some(rake::view! {
            <div class="absolute top-[6px] w-[210px] h-[36px] flex items-center px-3 pb-2 gap-2" style={|s|s.left(self.origin.x+px(39.)).occlude().cursor(gpui::CursorStyle::PointingHand).debug_selector(||"branch-tab-preview".into()).a11y_synthetic_children(|builder|builder.parent_node().set_hidden())}
                on:click={cx.listener(|this,_,window,cx|this.close(window,cx))}>
                {surface}
                {avatar}
                <div class="flex-1 min-w-0 overflow-hidden whitespace-nowrap text-small">{label}</div>
                <Icon size={IconSize::Supporting} {..Icon::new("close-preview",IconName::Close)}/>
            </div>
        }.into_any_element())
    }

    fn rows(&self, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let count = self.visible.len();

        gpui::uniform_list("branch-list",count,cx.processor(|this,range:Range<usize>,_,cx| {
            range.map(|position| {
                let index=this.visible[position];let branch=&this.data.as_ref().expect("visible branches have data").branches[index];
                let blocked=this.blocked(index);let current=branch.checked_out;

                let detail=if branch.kind==BranchKind::Remote{if model::remote_target(branch,this.data.as_ref().expect("branch data loaded")).is_err(){"Local branch exists".into()}else{"Remote".into()}}
                    else if !current&&branch.worktree_path.is_some(){"Other worktree".into()}
                    else{model::commit_age(branch.committed_at.as_deref(),chrono::Utc::now().timestamp_millis())};

                let leading=rake::view!{<div class="shrink-0" style={|s|s.text_color(if current{onegit_ui::Theme::current().accent}else{onegit_ui::Theme::current().muted_ink})}><Icon size={IconSize::Supporting} {..Icon::new("branch",if current{IconName::Check}else{IconName::Branch})}/></div>}.into_any_element();
                let trailing=rake::view!{<Text role={TextRole::Caption} tone={TextTone::Muted} max_lines={Some(1)} {..Text::new("age",detail)}/>}.into_any_element();
                let label=if current{format!("{}, current branch",branch.name)}else{branch.name.clone()};

                rake::view!{<div class="w-full h-[28px] min-w-0" style={|s|s.debug_selector(move||format!("branch-row-{position}"))}>
                    <ListRow variant={ListRowVariant::Menu} accessibility_label={Some(label.into())} leading={Some(leading)} trailing={Some(trailing)} selection={if this.highlighted==Some(position){RowSelection::Selected}else{RowSelection::Unselected}}
                        state={if this.busy||blocked.is_some(){ControlState::Disabled}else{ControlState::Enabled}}
                        on_press={Some(Box::new(cx.listener(move|this,_,window,cx|this.choose(index,window,cx))))}
                        {..ListRow::new(("branch",index),branch.name.clone())}/>
                </div>}.into_any_element()
            }).collect()
        })).size_full().min_h_0().track_scroll(&self.scroll).with_sizing_behavior(gpui::ListSizingBehavior::Auto).into_any_element()
    }
}

impl gpui::Render for Picker {
    fn render(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> impl gpui::IntoElement {
        if !self.dialog.read(cx).is_open() {
            return gpui::Empty.into_any_element();
        }

        let notice = self.notice();

        let current = self
            .source
            .as_ref()
            .and_then(|source| source.snapshot.status.head.branch.clone())
            .unwrap_or_else(|| "Detached HEAD".into());

        let restore = self
            .saved
            .iter()
            .find(|saved| saved.branch == current)
            .cloned();

        let more = self
            .data
            .as_ref()
            .is_some_and(|data| model::visible(data, "", true).len() > 3)
            && self.query.read(cx).text().trim().is_empty();

        let empty = self.data.is_some() && self.visible.is_empty();
        let empty_search = empty && !self.query.read(cx).text().trim().is_empty();

        let target = match &self.phase {
            Phase::List => {
                8. + 32.
                    + if empty {
                        156.
                    } else {
                        self.visible.len().max(1) as f64 * 28.
                    }
                    + if more { 28. } else { 0. }
                    + 9.
                    + 28.
                    + if restore.is_some() { 28. } else { 0. }
            }
            Phase::Create { .. } => 150.,
            Phase::Changes { .. } => 300.,
            Phase::Restore(_) => 164.,
        } + if self.error.is_some() {
            112.
        } else if notice.is_some() {
            56.
        } else {
            0.
        };

        let max = if self.expanded { 650. } else { 398. };

        let target = target
            .min(max)
            .min((f64::from(window.viewport_size().height) - 92.).max(100.));

        let time = cx
            .background_executor()
            .now()
            .saturating_duration_since(self.epoch);

        let transition =
            super::Transition::Tween(super::Duration::from_millis(160), super::Easing::EaseOut);

        self.height.animate(target, transition, time);
        self.opacity.animate(1., transition, time);
        let height = self.height.sample(time, cx.reduce_motion());
        let opacity = self.opacity.sample(time, cx.reduce_motion());

        if height.is_animating() || opacity.is_animating() {
            window.request_animation_frame();
        }

        let availability = if self.busy {
            ControlState::Disabled
        } else {
            ControlState::Enabled
        };

        let can_create =
            self.data.is_some() && !self.operation_blocked() && !self.dirty() && !self.busy;

        let rows = if matches!(self.phase, Phase::List) && !empty {
            self.rows(cx)
        } else {
            gpui::Empty.into_any_element()
        };

        let confirm_disabled = self.busy
            || self.operation_blocked()
            || match &self.phase {
                Phase::Create { remote } => {
                    self.name.read(cx).text().trim().is_empty()
                        || (remote.is_none() && self.dirty())
                }
                Phase::Restore(_) => self.dirty(),
                _ => false,
            };

        let body=rake::view! {
            <div class="size-full min-h-0 flex flex-col p-1" focus={&self.list_focus}
                style={|s|s.opacity(opacity.value()as f32).debug_selector(||"workspace-branch-body".into())}
                on:key-down={cx.listener(|this,event:&gpui::KeyDownEvent,window,cx|this.key(event,window,cx))}>
                if matches!(self.phase,Phase::List) {
                    <div class="h-[32px] shrink-0"><TextInput show_label={false} size={ControlSize::Rail} placeholder={"Find a branch…".into()}
                        availability={if self.busy{InputAvailability::Disabled}else{InputAvailability::Enabled}}
                        {..TextInput::new("branch-search",&self.query,"Find a branch")}/></div>
                    <div class="flex-1 min-h-0">
                        if empty_search {<div class="h-[156px] flex flex-col items-center justify-center gap-2 px-3"><Text role={TextRole::Small} {..Text::new("empty-title","No matching branches")}/><Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("empty-description","Try another name, or create a new branch.")}/></div>}
                        else if empty {<div class="p-2"><Text role={TextRole::Small} tone={TextTone::Muted} {..Text::new("no-branches","No local branches available.")}/></div>}
                        else if self.data.is_none(){<div class="p-2"><Text role={TextRole::Small} tone={TextTone::Muted} {..Text::new("loading","Loading branches…")}/></div>}
                        else {{rows}}
                    </div>
                    if more {<ListRow variant={ListRowVariant::Menu} state={availability}
                        accessibility_label={Some(if self.expanded{"Show fewer branches"}else{"Show all branches"}.into())}
                        trailing={Some(rake::view!{<Icon size={IconSize::Supporting} {..Icon::new("more-branches",if self.expanded{IconName::ChevronDown}else{IconName::ChevronRight})}/>}.into_any_element())}
                        on_press={Some(Box::new(cx.listener(|this,_,_,cx|{this.expanded = !this.expanded;this.filter(cx);})))} {..ListRow::new("show-more-branches","More")}/>}
                    <div class="h-[1px] my-1 bg-hairline shrink-0"/>
                    <ListRow variant={ListRowVariant::Menu} leading={Some(rake::view!{<Icon size={IconSize::Supporting} {..Icon::new("new-icon",IconName::Plus)}/>}.into_any_element())} state={if can_create{ControlState::Enabled}else{ControlState::Disabled}}
                        on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.create(window,cx))))} {..ListRow::new("new-branch","New Branch")}/>
                    if let Some(saved)=restore {<ListRow variant={ListRowVariant::Menu} state={if can_create{ControlState::Enabled}else{ControlState::Disabled}}
                        on_press={Some(Box::new(cx.listener(move|this,_,_,cx|{this.phase=Phase::Restore(saved.clone());cx.notify();})))} {..ListRow::new("restore-branch-work","Restore saved changes…")}/>}
                } else {
                    <div class="flex-1 min-h-0 flex flex-col gap-2.5 p-2 overflow-y-scroll">
                        if let Phase::Create{remote}=&self.phase {
                            <Text role={TextRole::Body} {..Text::new("branch-title",if remote.is_some(){"Check out remote branch"}else{"Create new branch"})}/>
                            <TextInput show_label={false} size={ControlSize::Small} placeholder={"New branch name…".into()}
                                availability={if self.busy||remote.is_some(){InputAvailability::ReadOnly}else{InputAvailability::Enabled}}
                                {..TextInput::new("branch-name",&self.name,"New branch name")}/>
                            <Text role={TextRole::Small} tone={TextTone::Muted} {..Text::new("branch-detail",remote.as_ref().map(|remote|format!("Tracks {} in this workspace.",remote.trim_start_matches("refs/remotes/"))).unwrap_or_else(||format!("Create locally from {current} and switch to it. Publish later to share it.")))}/>
                        }
                        if let Phase::Changes{destination,choice,..}=&self.phase {
                            <Text role={TextRole::Body} {..Text::new("changes-title","What about your changes?")}/>
                            <Text role={TextRole::Small} tone={TextTone::Muted} {..Text::new("changes-description",format!("Switch to “{destination}” without losing your uncommitted work."))}/>
                            for (kind,label,description) in [(BranchChanges::Leave,format!("Leave on {current}"),"Save the work on this branch for later."),(BranchChanges::Bring,format!("Bring to {destination}"),"Move the work; keep a backup if conflicts occur.")] {
                                <div id={if kind==BranchChanges::Leave{"leave-choice"}else{"bring-choice"}} class="shrink-0" style={|s|s.debug_selector(move||if kind==BranchChanges::Leave{"branch-leave".into()}else{"branch-bring".into()})}>
                                    <ListRow variant={ListRowVariant::Menu} selection={if *choice==kind{RowSelection::Selected}else{RowSelection::Unselected}} description={Some(description.into())} state={availability}
                                        on_press={Some(Box::new(cx.listener(move|this,_,_,cx|{if let Phase::Changes{choice,..}=&mut this.phase{*choice=kind;cx.notify();}})))}
                                        {..ListRow::new(if kind==BranchChanges::Leave{"leave"}else{"bring"},label)}/>
                                </div>
                            }
                        }
                        if let Phase::Restore(saved)=&self.phase {
                            <Text role={TextRole::Body} {..Text::new("restore-title","Restore saved changes?")}/>
                            <Text role={TextRole::Small} tone={TextTone::Muted} {..Text::new("restore-detail",format!("Saved work is available for “{}”. Restore it now or keep it in Stashes for later.",saved.branch))}/>
                        }
                    </div>
                    <div class="flex flex-row items-center justify-between gap-1.5 px-2 pb-2 shrink-0">
                        <Button size={ControlSize::Small} variant={ButtonVariant::Ghost} state={availability} on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.back(window,cx))))} {..Button::new("cancel-branch",if matches!(self.phase,Phase::Restore(_)){"Not now"}else{"Cancel"})}/>
                        <Button size={ControlSize::Small} variant={ButtonVariant::Primary} state={if self.busy{ControlState::Busy}else if confirm_disabled{ControlState::Disabled}else{ControlState::Enabled}}
                            on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.confirm(window,cx))))}
                            {..Button::new("confirm-branch",match self.phase {Phase::Create{..}=>"Create and switch",Phase::Changes{..}=>"Switch branch",_=>"Restore changes"})}/>
                    </div>
                }
                if let Some(notice)=notice {<div class="px-2 py-1 shrink-0"><Text role={TextRole::Caption} tone={if self.error.is_some(){TextTone::Danger}else{TextTone::Muted}} max_lines={Some(5)} {..Text::new("branch-notice",notice)}/>
                    if self.error.is_some()&&self.data.is_none(){<Button size={ControlSize::Small} variant={ButtonVariant::Ghost} state={availability} on_press={Some(Box::new(cx.listener(|this,_,_,cx|{this.error=None;this.load(cx);cx.notify();})))} {..Button::new("retry-branches","Retry branches")}/>}
                </div>}
            </div>
        }.into_any_element();

        let preview = self.preview(cx);

        rake::view!{<Dialog trigger_preview={preview} width={px(288.)} presentation={DialogPresentation::Attached{origin:self.origin,height:px(height.value()as f32)}}
            dismissal={DialogDismissal::EscapeAndOutside} availability={if self.busy{DialogAvailability::Busy}else{DialogAvailability::Ready}}
            initial_focus={Some(if matches!(self.phase,Phase::List){self.query.read(cx).focus_handle(cx)}else if matches!(self.phase,Phase::Create{..}){self.name.read(cx).focus_handle(cx)}else{self.list_focus.clone()})}
            {..Dialog::new("workspace-branches",&self.dialog,"Workspace branches")}>
            {body}
        </Dialog>}.into_any_element()
    }
}
