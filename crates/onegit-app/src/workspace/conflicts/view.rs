//! Original compact operation strip and source/result comparison geometry.
use super::{Action, Preview, can_continue, finish_request, markers};
use crate::workspace::{RepositoryState, RepositoryWorkspace, view::notice};
use onegit_git::{ConflictSide, FileStatus, FinishKind, OperationState};

use onegit_ui::{
    Appearance, Button, ButtonVariant, ControlSize, ControlState, DiffView, DiffViewer, Theme,
};

use rake::gpui::{self, prelude::*, px};

fn color(light: u32, dark: u32) -> gpui::Hsla {
    gpui::rgb_to_hsla(gpui::rgb(
        if Theme::current().appearance == Appearance::Dark {
            dark
        } else {
            light
        },
    ))
}

impl RepositoryWorkspace {
    pub(in crate::workspace) fn conflict_available(&self) -> bool {
        self.write_job.is_none()
            && !self.repository_busy
            && !self.refresh_blocked
            && self.picker.is_none()
            && matches!(self.state, RepositoryState::Ready(_))
    }

    fn open_conflict_editor(&mut self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        if !self.conflict_available() || self.conflicts.read(cx).busy {
            return;
        }

        let (RepositoryState::Ready(source), Some(key)) = (&self.state, &self.selected) else {
            return;
        };

        let root = source.snapshot.repository.root.clone();
        let path = key.path.clone();
        let form = self.conflicts.downgrade();

        self.conflicts.update(cx, |form, cx| {
            form.busy = true;
            form.error = None;
            cx.notify();
        });
        let job = cx
            .background_executor()
            .spawn(async move { super::read::open_editor(&root, &path) });

        cx.spawn_in(window, async move |_, cx| {
            let result = job.await;
            let _ = form.update_in(cx, |form, window, cx| form.finish(result, window, cx));
        })
        .detach();
    }

    fn conflict_action(
        &mut self,
        action: Action,
        confirm: bool,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if !self.conflict_available() {
            return;
        }

        self.conflicts.update(cx, |form, cx| {
            form.configure(false, cx);

            if confirm {
                let replacement = matches!(action, Action::Resolve { .. });

                let anchor = if replacement {
                    form.replace_anchor.get()
                } else {
                    form.abort_anchor.get()
                };

                let origin = anchor
                    .map(|bounds| {
                        if replacement {
                            bounds.bottom_right() - gpui::point(px(320.), px(0.))
                        } else {
                            bounds.bottom_left()
                        }
                    })
                    .unwrap_or(window.mouse_position())
                    + gpui::point(px(0.), px(8.));

                form.open(action, origin, window, cx);
            } else {
                form.submit_action(action, cx);
            }
        });
    }

    pub(in crate::workspace) fn operation_strip(
        &self,
        source: &super::super::read::Loaded,
        cx: &mut gpui::Context<Self>,
    ) -> gpui::AnyElement {
        let snapshot = &source.snapshot;

        let conflicts = source
            .files
            .iter()
            .filter(|file| file.status == FileStatus::Unmerged)
            .count();

        let supported = matches!(
            snapshot.operation,
            OperationState::Merge | OperationState::Rebase
        );

        if snapshot.operation == OperationState::Normal && conflicts == 0 {
            return gpui::Empty.into_any_element();
        }

        let name = super::operation_name(snapshot.operation);

        let title = if snapshot.operation == OperationState::Merge {
            "Merge"
        } else if snapshot.operation == OperationState::Rebase {
            "Rebase"
        } else {
            name
        };

        let status = if snapshot.operation == OperationState::Normal {
            format!("Conflicts · {conflicts} unresolved files")
        } else if conflicts > 0 {
            format!(
                "{} paused · {conflicts} unresolved {}",
                title,
                if conflicts == 1 { "file" } else { "files" }
            )
        } else {
            format!("{title} in progress · ready to continue")
        };

        let available = self.conflict_available();
        let abort_anchor = self.conflicts.read(cx).abort_anchor.clone();

        let ready =
            available && supported && can_continue(snapshot) && snapshot.operation_token.is_some();

        rake::view! {
            <div class="p-2 gap-1.5 flex flex-col shrink-0 border-b-1 border-hairline"
                style={|s|s.debug_selector(||"operation-strip".into()).bg(if conflicts>0 {color(0xfff6df,0x332b1d)} else {Theme::current().surface})}>
                <p class="text-small" role={gpui::accesskit::Role::Status} style={|s|s.text_color(if conflicts>0 {color(0x916116,0xedc581)} else {Theme::current().ink})}>{status}</p>
                if supported {
                    <div class="flex flex-row gap-1.5">
                        <div class="shrink-0" style={|s|s.debug_selector(||"operation-continue-button".into())}><Button size={ControlSize::Small} variant={ButtonVariant::Primary} state={if ready {ControlState::Enabled}else{ControlState::Disabled}}
                            on_press={Some(Box::new(cx.listener(|this,_,window,cx|{
                                if let RepositoryState::Ready(source)=&this.state && let Some(action)=finish_request(&source.snapshot,FinishKind::Continue) {this.conflict_action(action,false,window,cx);}
                            })))} {..Button::new("operation-continue",format!("Continue {name}"))}/></div>
                        {onegit_ui::track_anchor(rake::view! {<div class="shrink-0" style={|s|s.debug_selector(||"operation-abort-button".into())}><Button size={ControlSize::Small} variant={ButtonVariant::Ghost} state={if available {ControlState::Enabled}else{ControlState::Disabled}}
                            on_press={Some(Box::new(cx.listener(|this,_,window,cx|{
                                if let RepositoryState::Ready(source)=&this.state && let Some(action)=finish_request(&source.snapshot,FinishKind::Abort) {this.conflict_action(action,true,window,cx);}
                            })))} {..Button::new("operation-abort","Abort…")}/></div>}, abort_anchor.clone())}
                    </div>
                }
                <p class="text-caption text-muted-ink">{if conflicts>0 {if conflicts==1 {"Resolve this file before continuing."}else{"Resolve these files before continuing."}} else if !can_continue(snapshot) {"Additional tracked edits remain. Review and stage them in Git before continuing."} else if supported {"All conflicts resolved. Continue when ready."} else {"Finish this operation using Git outside the app."}}</p>
            </div>
        }.into_any_element()
    }

    pub(in crate::workspace) fn unsupported_conflict_toolbar(
        &self,
        cx: &mut gpui::Context<Self>,
    ) -> gpui::AnyElement {
        let available = self.conflict_available() && !self.conflicts.read(cx).busy;

        let state = if available {
            ControlState::Enabled
        } else {
            ControlState::Disabled
        };

        rake::view! {
            <div class="flex flex-row items-center justify-end gap-1.5 p-2 border-b-1 border-hairline">
                <Button size={ControlSize::Small} state={state} on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.open_conflict_editor(window,cx))))}
                    {..Button::new("unsupported-conflict-editor","Open editor")}/>
                <Button size={ControlSize::Small} state={state} variant={ButtonVariant::Ghost} on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.refresh(cx))))}
                    {..Button::new("unsupported-conflict-refresh","Refresh")}/>
            </div>
        }.into_any_element()
    }

    pub(in crate::workspace) fn conflict_preview_view(
        &self,
        preview: &Preview,
        cx: &mut gpui::Context<Self>,
    ) -> gpui::AnyElement {
        let side = self.conflict_side;
        let source = preview.version(side);
        let (blocks, unresolved) = markers(&preview.working.text);

        let available =
            self.conflict_available() && self.diff_job.is_none() && !self.conflicts.read(cx).busy;

        let ready = if available {
            ControlState::Enabled
        } else {
            ControlState::Disabled
        };

        let tone = if side == ConflictSide::Ours {
            color(0xeef4ff, 0x1d2a40)
        } else {
            color(0xf5effc, 0x2d233c)
        };

        let ink = if side == ConflictSide::Ours {
            color(0x315fbd, 0xa8c7ff)
        } else {
            color(0x7952af, 0xceb2f5)
        };

        let replace_anchor = self.conflicts.read(cx).replace_anchor.clone();
        let request = preview.resolve(Some(side));
        let manual = preview.resolve(None);

        let content = if let Some(document) = &source.document {
            rake::view! {
                <DiffViewer gutter_style={onegit_ui::DiffGutterStyle::Continuous} split_layout={onegit_ui::DiffSplitLayout::Aligned} show_header={false} view={DiffView::Split}
                    {..DiffViewer::new("conflict-diff","Indexed version compared with working result",document.without_file_metadata())}/>
            }.into_any_element()
        } else {
            notice(
                "conflict-comparison-notice",
                "Indexed version compared with working result",
                source.notice.clone().unwrap_or_default(),
            )
        };

        rake::view! {
            <div class="size-full min-h-0 min-w-0 flex flex-col" style={|s|s.debug_selector(||"conflict-preview".into())}>
                <div class="flex flex-row flex-wrap items-center gap-1.5 p-2 shrink-0 border-b-1 border-hairline">
                    <div class="flex-1 flex flex-row min-w-0 gap-1">
                        <div class="shrink-0" style={|s|s.debug_selector(||"conflict-compare-ours-button".into()).rounded(px(4.)).bg(if side==ConflictSide::Ours{color(0xeef4ff,0x1d2a40)}else{gpui::transparent_black()})}><Button accessibility_label={Some((format!("Compare {} with working result",preview.ours.label)).into())} pressed={Some(side==ConflictSide::Ours)} variant={ButtonVariant::Ghost} size={ControlSize::Small} state={ready}
                            on_press={Some(Box::new(cx.listener(|this,_,_,cx|{this.conflict_side=ConflictSide::Ours;cx.notify();})))}
                            {..Button::new("conflict-compare-ours",if preview.operation==OperationState::Rebase {"Upstream version"}else{"Current"})}/></div>
                        <div class="shrink-0" style={|s|s.debug_selector(||"conflict-compare-theirs-button".into()).rounded(px(4.)).bg(if side==ConflictSide::Theirs{color(0xf5effc,0x2d233c)}else{gpui::transparent_black()})}><Button accessibility_label={Some((format!("Compare {} with working result",preview.theirs.label)).into())} pressed={Some(side==ConflictSide::Theirs)} variant={ButtonVariant::Ghost} size={ControlSize::Small} state={ready}
                            on_press={Some(Box::new(cx.listener(|this,_,_,cx|{this.conflict_side=ConflictSide::Theirs;cx.notify();})))}
                            {..Button::new("conflict-compare-theirs",if preview.operation==OperationState::Rebase {"Replayed commit"}else{"Incoming"})}/></div>
                    </div>
                    <Button variant={ButtonVariant::Secondary} size={ControlSize::Small} state={ready}
                        on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.open_conflict_editor(window,cx))))}
                        {..Button::new("conflict-open-editor","Open editor")}/>
                    <Button variant={ButtonVariant::Ghost} size={ControlSize::Small} state={ready}
                        on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.refresh(cx))))}
                        {..Button::new("conflict-refresh","Refresh")}/>
                    <div class="shrink-0" style={|s|s.debug_selector(||"conflict-mark-resolved-button".into())}><Button variant={ButtonVariant::Primary} size={ControlSize::Small} state={if available&&!unresolved {ControlState::Enabled}else{ControlState::Disabled}}
                        on_press={Some(Box::new(cx.listener(move|this,_,window,cx|this.conflict_action(manual.clone(),false,window,cx))))}
                        {..Button::new("conflict-mark-resolved","Mark resolved")}/></div>
                </div>
                <div class="flex flex-row shrink-0 border-b-1 border-hairline">
                    <div class="w-1/2 min-w-0 p-2 flex flex-row flex-wrap items-center gap-1 border-r-1 border-hairline" style={|s|s.bg(tone)}>
                        <p class="text-small font-medium flex-1 min-w-0" wrap={false} ellipsis={true} aria-description={source.description.clone()} style={|s|s.text_color(ink)}>{source.label.clone()}</p>
                        {onegit_ui::track_anchor(rake::view! {<div class="shrink-0" style={|s|s.debug_selector(||"conflict-use-version-button".into())}><Button accessibility_label={Some((format!("Use {} for the whole file",source.label)).into())} variant={ButtonVariant::Ghost} size={ControlSize::Small} state={if available&&source.usable&&source.oid.is_some(){ControlState::Enabled}else{ControlState::Disabled}}
                            on_press={Some(Box::new(cx.listener(move|this,_,window,cx|this.conflict_action(request.clone(),true,window,cx))))}
                            {..Button::new("conflict-use-version","Use this version…")}/></div>}, replace_anchor.clone())}
                    </div>
                    <div class="w-1/2 min-w-0 p-2 flex flex-col justify-center" style={|s|s.bg(if unresolved{color(0xfff6df,0x332b1d)}else{Theme::current().surface})}>
                        <p class="text-small font-medium" style={|s|s.text_color(if unresolved{color(0x916116,0xedc581)}else{Theme::current().ink})}>{ "Working result" }</p>
                        <p class="text-caption text-muted-ink">{if unresolved {format!("{blocks} conflict {} · unresolved",if blocks==1{"block"}else{"blocks"})}else{"Ready to mark resolved".into()}}</p>
                    </div>
                </div>
                <div class="flex-1 min-w-0 min-h-0">{content}</div>
                <div class="p-2 shrink-0 border-t-1 border-hairline"><p class="text-caption text-muted-ink">{if unresolved {"Save edits in your editor, then Refresh."}else{"Mark resolved stages the file. Continue separately."}}</p></div>
                if let Some(error)=&self.conflicts.read(cx).error {<div id="conflict-error" role={gpui::accesskit::Role::Alert} class="p-2"><p class="text-caption text-danger">{error.clone()}</p></div>}
            </div>
        }.into_any_element()
    }

    pub(in crate::workspace) fn operation_files(
        &self,
        loaded: std::sync::Arc<super::super::read::Loaded>,
        window: &gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> gpui::AnyElement {
        use onegit_ui::{IconButton, IconName, InputAvailability, InputVariant, SearchField};
        let owned = self.files_focus.is_focused(window);

        let focus = self
            .files_focus
            .clone()
            .tab_stop(!self.visible_files.is_empty());

        let mut groups = Vec::new();

        let other_exists = self
            .visible_files
            .iter()
            .any(|index| loaded.files[*index].status != FileStatus::Unmerged);

        for (name, title, conflicts) in [
            ("operation-conflicts", "Conflicts", true),
            ("operation-changes", "Other changes", false),
        ] {
            let indices: Vec<usize> = self
                .visible_files
                .iter()
                .copied()
                .filter(|index| (loaded.files[*index].status == FileStatus::Unmerged) == conflicts)
                .collect();

            let count = indices.len();

            if count == 0 {
                continue;
            }

            let source = loaded.clone();
            let selected = self.selected.clone();

            let select = std::rc::Rc::new(cx.listener(
                |this, key: &super::super::read::ChangeKey, window, cx| {
                    window.focus(&this.files_focus, cx);

                    if this.selected.as_ref() != Some(key) {
                        this.select(key.clone(), cx);
                    }
                },
            ));

            let list = gpui::uniform_list(name, count, move |range, _, _| range.map(|position| {
                let index = indices[position];
                let file = &source.files[index];
                let key = file.key.clone();
                let active = selected.as_ref() == Some(&key);
                let select = select.clone();
                let theme = Theme::current();
                let icon = crate::workspace::chrome::status_icon(file.status);
                let identity = crate::workspace::chrome::file_identity(&file.key.path);

                rake::view! {
                    <div id={format!("operation-file-{}:{}", file.key.side.label(),file.label)} role={gpui::accesskit::Role::Row}
                        aria-label={format!("{}, {}",file.label,file.description)}
                        class="w-full h-[28px] min-w-0 flex flex-row items-center gap-2 px-2 rounded-[4px]"
                        style={|s|s.bg(if active{theme.selection}else{gpui::transparent_black()}).aria_selected(active)
                            .when(active&&owned,|s|s.aria_active_descendant()).hover(|s|s.bg(if active{theme.selection}else{theme.hover}))
                            .cursor(gpui::CursorStyle::PointingHand).debug_selector(move||format!("operation-file-{index}"))}
                        on:click={move|_,window,cx|select(&key,window,cx)}>
                        {icon}
                        <div class="flex-1 min-w-0">{identity}</div>
                        if conflicts {<div class="px-1.5 rounded-[4px]" style={|s|s.bg(color(0xfff6df,0x332b1d))}><p class="text-caption" style={|s|s.text_color(color(0x916116,0xedc581))}>{"Unresolved"}</p></div>}
                    </div>
                }.into_any_element()
            }).collect()).size_full().min_h_0().with_sizing_behavior(gpui::ListSizingBehavior::Auto);

            groups.push(rake::view! {
                <div id={name} class="flex flex-col min-h-[64px] min-w-0"
                    style={|s| if conflicts&&other_exists {s.h(px((count*28+40) as f32)).max_h(gpui::relative(0.6)).flex_shrink(1.)} else {s.flex_1()}}>
                    <div class="px-2.5 py-2.5 shrink-0"><p class="text-caption" style={|s|s.text_color(if conflicts{color(0x916116,0xedc581)}else{Theme::current().muted_ink})}>{format!("{title} · {count}")}</p></div>
                    <div class="flex-1 min-h-0 px-1.5">{list}</div>
                </div>
            }.into_any_element());
        }

        let empty = groups.is_empty();
        let strip = self.operation_strip(&loaded, cx);

        rake::view! {
            <div class="size-full min-h-0 min-w-0 flex flex-col">
                <div class="h-[36px] flex flex-row items-center gap-1 pl-3.5 pr-2 shrink-0">
                    <div class="flex-1 min-w-0">
                        if self.filter_visible {
                            <SearchField show_label={false} variant={InputVariant::Plain} size={ControlSize::Small} placeholder={"Filter files…".into()}
                                availability={if self.write_job.is_some(){InputAvailability::Disabled}else{InputAvailability::Enabled}}
                                {..SearchField::new("operation-filter",&self.filter,"Filter changed files")}/>
                        } else {<p class="text-body font-medium">{"Changes"}</p>}
                    </div>
                    <IconButton size={ControlSize::Small} state={if self.conflict_available(){ControlState::Enabled}else{ControlState::Disabled}}
                        on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.refresh(cx))))}
                        {..IconButton::new("operation-refresh",IconName::Refresh,"Refresh changed files")}/>
                    <IconButton size={ControlSize::Small} state={if self.write_job.is_none(){ControlState::Enabled}else{ControlState::Disabled}}
                        on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.toggle_filter(window,cx))))}
                        {..IconButton::new("operation-filter-toggle",if self.filter_visible{IconName::Close}else{IconName::Search},"Filter changed files")}/>
                </div>
                {strip}
                <div id="operation-file-list" class="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden"
                    role={gpui::accesskit::Role::Grid} aria-label="Conflict resolution files"
                    style={|s|s.track_focus(&focus).on_key_down(cx.listener(|this,event,window,cx|this.navigate_files(event,window,cx))).children(groups)}>
                    if empty {<div class="p-3"><p class="text-small text-muted-ink">{"No files to show."}</p></div>}
                </div>
            </div>
        }.into_any_element()
    }
}
