use super::{
    PreviewState, RepositoryState, RepositoryWorkspace, Section, chrome,
    read::{self, Loaded, Preview},
    write,
};

use onegit_ui::{
    Button, ButtonVariant, CheckState, Checkbox, ControlSize, ControlState, DiffView, DiffViewer,
    DropdownMenu, IconButton, IconName, InputAvailability, InputVariant, MenuAlignment, MenuEntry,
    MenuItem, ResizableSplit, SearchField, Text, TextArea, TextInput, TextRole, TextTone, Theme,
    ToastHost, Tooltip,
};

use rake::gpui::{self, accesskit, prelude::*, px};
use std::{rc::Rc, sync::Arc};

pub(super) fn notice(
    id: &'static str,
    title: impl Into<gpui::SharedString>,
    detail: impl Into<gpui::SharedString>,
) -> gpui::AnyElement {
    let title: gpui::SharedString = title.into();
    let detail: gpui::SharedString = detail.into();
    let announcement = format!("{title}. {detail}");

    rake::view! {
        <div id={id} role={accesskit::Role::Status} aria-label={announcement}
            class="size-full flex flex-col items-start gap-2 p-7 overflow-y-scroll"
            style={|s|s.a11y_synthetic_children(|builder|{let node=builder.parent_node();node.set_live(accesskit::Live::Polite);node.set_live_atomic();})}>
            <Text role={TextRole::Title} {..Text::new("title",title)}/>
            <Text tone={TextTone::Muted} {..Text::new("detail",detail)}/>
        </div>
    }.into_any_element()
}

impl RepositoryWorkspace {
    fn files(
        &self,
        loaded: Arc<Loaded>,
        window: &gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> gpui::AnyElement {
        let total = loaded.files.len();
        let count = self.visible_files.len();
        let indices = self.visible_files.clone();
        let staged = write::staged_count(&loaded);
        let writable = self.can_write();
        let allowed = write::available(&loaded);
        let selected = self.selected.clone();
        let owns_focus = self.files_focus.is_focused(window);
        let focused = owns_focus && window.last_input_was_keyboard();
        let focus = self.files_focus.clone().tab_stop(count > 0);

        let callback = Rc::new(cx.listener(|this, key: &read::ChangeKey, window, cx| {
            window.focus(&this.files_focus, cx);

            if this.selected.as_ref() != Some(key) {
                this.select(key.clone(), cx);
            }
        }));

        let stage = Rc::new(cx.listener(|this, file: &read::ChangedFile, window, cx| {
            this.start_write(write::Operation::File(file.clone()), window, cx)
        }));

        let entries = vec![
            MenuItem {
                disabled: !writable || staged == total,
                ..MenuItem::new("stage-all", "Stage all files")
            }
            .into(),
            MenuItem {
                disabled: !writable || staged == 0,
                ..MenuItem::new("unstage-all", "Unstage all files")
            }
            .into(),
        ];

        let last_commit = loaded.last_commit.clone();

        let list=gpui::uniform_list("files",count,move |range,_,_|range.map(|position| {
            let index=indices[position];
            let file=&loaded.files[index];
            let key=file.key.clone();
            let stage_file=file.clone();
            let row_id=gpui::ElementId::from(gpui::SharedString::from(format!("{}:{}",file.key.side.label(),file.label)));
            let active=selected.as_ref()==Some(&key);
            let theme=Theme::current();
            let callback=callback.clone();
            let stage=stage.clone();
            let icon=chrome::status_icon(file.status);
            let identity=chrome::file_identity(&file.key.path);
            let staged=file.key.side==read::Side::Staged;

            rake::view! {
                <div id={row_id} role={accesskit::Role::Row} aria-label={format!("{}, {}",file.label,file.description)}
                    class="w-full h-[28px] min-w-0 flex flex-row items-center gap-2 pl-2 pr-1 rounded-[4px] border-1 overflow-hidden"
                    style={|s|s.bg(if active{theme.selection}else{gpui::transparent_black()}).border_color(if active&&focused{theme.focus_ring}else{gpui::transparent_black()})
                        .aria_selected(active).when(active && owns_focus,|s|s.aria_active_descendant()).hover(|s|s.bg(if active{theme.selection}else{theme.hover})).cursor(gpui::CursorStyle::PointingHand)
                        .debug_selector(||format!("workspace-file-{index}"))
                        .a11y_synthetic_children(move |builder|{builder.parent_node().set_position_in_set(position+1);builder.parent_node().set_size_of_set(count);})}
                    on:click={move |_,window,cx|{cx.stop_propagation();callback(&key,window,cx);}}>
                    {icon}
                    <div class="flex-1 min-w-0">{identity}</div>
                    <div class="shrink-0" style={|s|s.debug_selector(||format!("workspace-stage-{index}"))}>
                    <Checkbox show_label={false} checked={if staged{CheckState::Checked}else{CheckState::Unchecked}} state={if writable{ControlState::Enabled}else{ControlState::Disabled}}
                        on_change={Some(Box::new(move |_,window,cx|stage(&stage_file,window,cx)))}
                        {..Checkbox::new("stage",format!("{} {}",if staged{"Unstage"}else{"Stage"},file.label))}/>
                    </div>
                </div>
            }.into_any_element()
        }).collect()).size_full().min_w_0().min_h_0().track_scroll(&self.files_scroll).with_sizing_behavior(gpui::ListSizingBehavior::Auto);

        rake::view! {
            <div class="size-full flex flex-col min-w-0 min-h-0">
                <div class="h-[36px] flex flex-row items-center gap-1 pl-3.5 pr-2 shrink-0" style={|s|s.debug_selector(||"workspace-files-toolbar".into())}>
                    <div class="flex-1 min-w-0">
                        if self.filter_visible {<SearchField show_label={false} variant={InputVariant::Plain} size={ControlSize::Small} placeholder={"Filter files…".into()} availability={if self.write_job.is_some(){InputAvailability::Disabled}else{InputAvailability::Enabled}} {..SearchField::new("file-filter",&self.filter,"Filter changed files")}/>}
                        else {<p class="text-body font-medium">{"Changes"}</p>}
                    </div>
                    <Tooltip {..Tooltip::new("tree-unavailable","List view. Tree view is not ported to Rust yet")}><div class="size-[24px] flex items-center justify-center text-muted-ink"><onegit_ui::Icon size={onegit_ui::IconSize::Navigation} {..onegit_ui::Icon::new("file-layout",IconName::List)}/></div></Tooltip>
                    <IconButton size={ControlSize::Small} state={if writable{ControlState::Enabled}else{ControlState::Disabled}} on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.refresh(cx))))} {..IconButton::new("refresh-files",IconName::Refresh,"Refresh changed files")}/>
                    <IconButton size={ControlSize::Small} state={if self.write_job.is_some(){ControlState::Disabled}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.toggle_filter(window,cx))))} {..IconButton::new("filter-files",if self.filter_visible{IconName::Close}else{IconName::Search},if self.filter_visible{"Close file filter"}else{"Filter changed files"})}/>
                </div>
                <div class="h-[24px] flex flex-row items-center pl-[5px] pr-[18px] shrink-0">
                    <div class="flex-1 min-w-0"><DropdownMenu size={ControlSize::Small} label_role={TextRole::Caption} show_chevron={false} variant={ButtonVariant::Ghost} entries={entries}
                        on_select={Some(Box::new(cx.listener(|this,id:&gpui::ElementId,window,cx|this.start_write(if *id==gpui::ElementId::from("stage-all"){write::Operation::StageAll}else{write::Operation::UnstageAll},window,cx))))}
                        {..DropdownMenu::new("index-actions",format!("{staged} of {total} staged"))}/></div>
                    if self.filter_visible {<Text role={TextRole::Caption} tone={TextTone::Faint} {..Text::new("shown",format!("{count} shown"))}/>}
                    <div class="shrink-0" style={|s|s.debug_selector(||"workspace-stage-all".into())}>
                    <Checkbox show_label={false} checked={if staged==0{CheckState::Unchecked}else if staged==total{CheckState::Checked}else{CheckState::Mixed}} state={if writable&&total>0{ControlState::Enabled}else{ControlState::Disabled}}
                        on_change={Some(Box::new(cx.listener(|this,next:&CheckState,window,cx|this.start_write(if *next==CheckState::Unchecked{write::Operation::UnstageAll}else{write::Operation::StageAll},window,cx))))}
                        {..Checkbox::new("stage-all","Stage or unstage all changed files")}/>
                    </div>
                </div>
                <div id="file-list" role={accesskit::Role::Grid} aria-label="Changed files" class="flex-1 min-h-0 min-w-0 overflow-hidden pl-1.5 pr-3"
                    style={|s|s.track_focus(&focus).debug_selector(||"workspace-files".into()).on_key_down(cx.listener(|this,event,window,cx|this.navigate_files(event,window,cx)))}>
                    if count==0 && total>0 {<div class="p-3"><Text role={TextRole::Small} tone={TextTone::Muted} {..Text::new("no-matches","No matching files")}/></div>}
                    else {{list}}
                </div>
                if !allowed {<div class="px-3 py-2"><Text role={TextRole::Caption} tone={TextTone::Danger} {..Text::new("operation-blocked","Finish the current Git operation and resolve conflicts in your editor first.")}/></div>}
                <div class="h-[140px] p-2 shrink-0 border-t-1 border-hairline flex flex-col" style={|s|s.debug_selector(||"workspace-commit-composer".into())}>
                    <TextInput show_label={false} variant={InputVariant::Plain} size={ControlSize::Small} placeholder={"Commit message…".into()} availability={if writable{InputAvailability::Enabled}else{InputAvailability::Disabled}} {..TextInput::new("commit-summary",&self.summary,"Summary")}/>
                    <div class="flex-1 min-h-0"><TextArea show_label={false} variant={InputVariant::Plain} size={ControlSize::Small} rows={4} placeholder={"".into()} availability={if writable{InputAvailability::Enabled}else{InputAvailability::Disabled}} {..TextArea::new("commit-description",&self.description,"Description")}/></div>
                    <div class="h-[24px] shrink-0 flex flex-row items-center justify-end gap-1.5">
                        <Tooltip {..Tooltip::new("ai-unavailable","AI commit messages are not ported to Rust yet")}><IconButton size={ControlSize::Small} state={ControlState::Disabled} {..IconButton::new("ai-commit",IconName::Sparkles,"Generate commit message unavailable")}/></Tooltip>
                        <Button size={ControlSize::Small} variant={ButtonVariant::Primary} accessibility_label={Some("Commit staged changes".into())} state={if self.write_job.is_some(){ControlState::Busy}else if self.can_commit(cx){ControlState::Enabled}else{ControlState::Disabled}}
                            on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.commit(window,cx))))} {..Button::new("commit",format!("Commit {staged} {}",if staged==1{"file"}else{"files"}))}/>
                    </div>
                </div>
                if let Some(commit)=&last_commit {
                    <div class="h-[52px] shrink-0 p-2.5 border-t-1 border-hairline flex flex-row items-center gap-1">
                        <div class="flex-1 min-w-0 flex flex-col gap-0.5">
                            <Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("last-age",format!("Committed {}",super::chrome::age(&commit.committed_at)))}/>
                            <onegit_ui::CommitSubject {..onegit_ui::CommitSubject::new("last-summary",commit.summary.clone())}/>
                        </div>
                        <Tooltip {..Tooltip::new("amend-unavailable","Amend is not ported to Rust yet")}><Button size={ControlSize::Small} state={ControlState::Disabled} {..Button::new("amend","Amend")}/></Tooltip>
                        <Tooltip {..Tooltip::new("undo-unavailable","Undo is not ported to Rust yet")}><Button size={ControlSize::Small} state={ControlState::Disabled} {..Button::new("undo","Undo")}/></Tooltip>
                    </div>
                }
            </div>
        }.into_any_element()
    }

    fn preview_view(&self, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let selected_file = match (&self.state, &self.selected) {
            (RepositoryState::Ready(loaded), Some(key)) => loaded.file(key).cloned(),
            _ => None,
        };

        let mut entries: Vec<MenuEntry> = [
            (DiffView::Unified, "unified", "Unified diff"),
            (DiffView::Split, "split", "Split diff"),
        ]
        .into_iter()
        .map(|(view, id, label)| {
            MenuItem {
                selected: Some(self.view == view),
                ..MenuItem::new(id, label)
            }
            .into()
        })
        .collect();

        if let Some(file) = &selected_file {
            entries.push(MenuEntry::Separator);
            entries.push(
                MenuItem {
                    disabled: !self.can_write(),
                    ..MenuItem::new(
                        "stage-file",
                        if file.key.side == read::Side::Staged {
                            "Unstage file"
                        } else {
                            "Stage file"
                        },
                    )
                }
                .into(),
            );
        }

        let menu=rake::view! {
            <DropdownMenu icon_only={true} icon={Some(IconName::Sliders)} alignment={MenuAlignment::End} variant={ButtonVariant::Ghost} size={ControlSize::Small} entries={entries}
                on_select={Some(Box::new(cx.listener(|this,id:&gpui::ElementId,window,cx|{
                    if *id==gpui::ElementId::from("stage-file") {
                        let file=match (&this.state,&this.selected){(RepositoryState::Ready(loaded),Some(key))=>loaded.file(key).cloned(),_=>None};

                        if let Some(file)=file{this.start_write(write::Operation::File(file),window,cx);}
                    }else{this.view=if *id==gpui::ElementId::from("split"){DiffView::Split}else{DiffView::Unified};cx.notify();}
                })))} {..DropdownMenu::new("diff-options","Diff display options")}/>
        }.into_any_element();

        let toolbar = chrome::patch_toolbar(
            self.selected.as_ref().map(|key| &key.path),
            &self.preview,
            selected_file
                .as_ref()
                .map_or("", |file| file.key.side.label()),
            menu,
        );

        let content = match &self.preview {
            PreviewState::Empty => notice(
                "no-selection",
                "Select a changed file",
                "Its patch will appear here.",
            ),
            PreviewState::Loading => notice(
                "loading-patch",
                "Loading changes…",
                "Reading the selected file's patch.",
            ),
            PreviewState::Failed(error) => {
                notice("patch-error", "Could not load this patch", error.clone())
            }
            PreviewState::Ready(Preview::Notice { title, detail }) => {
                notice("patch-notice", *title, detail.clone())
            }
            PreviewState::Ready(Preview::Patch(document)) => {
                let title = self
                    .selected
                    .as_ref()
                    .map(|key| format!("{} · {}", read::path_label(&key.path), key.side.label()))
                    .unwrap_or_default();

                rake::view!{<DiffViewer gutter_style={onegit_ui::DiffGutterStyle::Inset} show_header={false} view={self.view} {..DiffViewer::new("diff",title,document.without_file_metadata())}/>}.into_any_element()
            }
        };

        rake::view! {
            <div class="size-full min-w-0 min-h-0 flex flex-col">
                {toolbar}
                if matches!(self.preview,PreviewState::Failed(_)){<div class="px-3 py-1"><Button size={ControlSize::Small} variant={ButtonVariant::Ghost} on_press={Some(Box::new(cx.listener(|this,_,_,cx|{if let Some(key)=this.selected.clone(){this.select(key,cx);}})))} {..Button::new("retry-patch","Retry patch")}/></div>}
                <div class="flex-1 min-w-0 min-h-0">{content}</div>
            </div>
        }.into_any_element()
    }
}

impl Render for RepositoryWorkspace {
    fn render(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        let grain = chrome::grain();
        let titlebar = self.titlebar(cx);
        let rail = self.rail(cx);

        let body = if self.home_visible {
            self.home.clone().into_any_element()
        } else {
            match &self.state {
                RepositoryState::Welcome => {
                    let content = notice(
                        "welcome",
                        "Open a repository",
                        "Choose a local working folder to browse its changed files and patches.",
                    );

                    rake::view!{<div class="size-full flex flex-col"><div class="flex-1 min-h-0">{content}</div><div class="p-7"><Button variant={ButtonVariant::Primary} on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.choose_repository(cx))))} {..Button::new("open-welcome","Open repository…")}/></div></div>}.into_any_element()
                }
                RepositoryState::Loading(path) => {
                    notice("opening", "Opening repository…", path.display().to_string())
                }
                RepositoryState::Failed { error, .. } => notice(
                    "repository-error",
                    "Could not open this repository",
                    error.clone(),
                ),
                RepositoryState::Ready(_) if self.section == Section::History => {
                    self.history.clone().into_any_element()
                }
                RepositoryState::Ready(loaded) => {
                    let files = self.files(loaded.clone(), window, cx);

                    let preview = if loaded.files.is_empty() {
                        notice(
                            "clean",
                            "Working tree is clean",
                            "There are no staged or unstaged changes to display.",
                        )
                    } else {
                        self.preview_view(cx)
                    };

                    rake::view!{<ResizableSplit divider_size={px(1.)} min_first={px(240.)} min_second={px(240.)} first={files} second={preview} {..ResizableSplit::new("workspace-split",&self.split,"Changed files width")}/>}.into_any_element()
                }
            }
        };

        rake::view! {
            <main class="relative size-full min-w-0 min-h-0 flex flex-col bg-chrome text-ink" focus={&self.focus} tab-navigation={true}>
                {grain}
                {titlebar}
                <div class="flex-1 min-w-0 min-h-0 flex flex-row">
                    {rail}
                    <div class="flex-1 min-w-0 min-h-0 mr-1.5 mb-1.5 rounded-[14px] bg-surface overflow-hidden flex flex-col" style={|s|s.debug_selector(||"workspace-surface".into())}>
                        if let Some(error)=&self.picker_error{<div class="px-4 py-2"><Text tone={TextTone::Danger} {..Text::new("picker-error",error.clone())}/></div>}
                        <div class="flex-1 min-h-0 min-w-0">{body}</div>
                    </div>
                </div>
                <ToastHost {..ToastHost::new("notifications",&self.toasts,&self.focus)}/>
            </main>
        }
    }
}
