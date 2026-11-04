use super::{DetailState, Details, HistoryWorkspace, Presentation};

use crate::workspace::{
    PreviewState, chrome,
    read::{self, Preview},
    view::notice,
};

use onegit_ui::{
    Button, ButtonVariant, CommitList, ControlSize, ControlState, DiffView, DiffViewer,
    DropdownMenu, IconName, MenuAlignment, MenuItem, ResizableSplit, SplitAxis, Text, TextRole,
    TextTone, Theme,
};

use rake::gpui::{self, accesskit, prelude::*, px};
use std::{rc::Rc, sync::Arc};

impl HistoryWorkspace {
    fn revisions(&self, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let commits = self.commits.clone();
        let owner = cx.entity().downgrade();

        let blocked = self.actions_blocked
            || self
                .source
                .as_ref()
                .is_none_or(|source| super::super::replay::unavailable(source).is_some());

        rake::view! {
            <div class="size-full min-w-0 min-h-0 flex flex-col">
                <div class="flex-1 min-w-0 min-h-0 pl-1.5 pr-3">
                    <CommitList context_menu={Some(Box::new(move|oid|super::super::replay::menu(commits[oid].clone(),blocked,owner.clone())))} state={Some(self.list_state.clone())} type_badges={true} selected={self.selected.clone()} empty_message={if self.page_job.is_some(){"Loading commits…".into()}else if self.page_error.is_some(){"History is unavailable.".into()}else{"No commits yet.".into()}}
                        on_select={Some(Box::new(cx.listener(|this,oid:&gpui::SharedString,_,cx|this.select_commit(oid.clone(),cx))))}
                        {..CommitList::new("history-commits","Repository commit history",self.data.clone())}/>
                </div>
                if self.page_error.is_some()||self.page_job.is_some()||self.next_offset.is_some(){
                    <div class="px-3 py-1 shrink-0 flex flex-col gap-1">
                        if let Some(error)=&self.page_error{<Text role={TextRole::Caption} tone={TextTone::Danger} max_lines={Some(3)} {..Text::new("page-error",error.clone())}/>}
                        <Button size={ControlSize::Small} variant={ButtonVariant::Ghost} state={if self.page_job.is_some(){ControlState::Busy}else{ControlState::Enabled}}
                            on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.load_page(cx))))}
                            {..Button::new("load-more",if self.page_error.is_some(){"Retry history"}else{"Load more commits"})}/>
                    </div>
                }
            </div>
        }.into_any_element()
    }

    fn files(
        &self,
        details: Arc<Details>,
        window: &gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> gpui::AnyElement {
        let count = details.files.len();
        let owns_focus = self.files_focus.is_focused(window);
        let focused = owns_focus && window.last_input_was_keyboard();
        let focus = self.files_focus.clone().tab_stop(count > 0);
        let selected = self.file.clone();

        let rows = self.file_rows.clone();
        let tree = self.tree_layout;
        let cursor = self.file_cursor.clone();

        let callback = Rc::new(cx.listener(|this, row: &usize, window, cx| {
            window.focus(&this.files_focus, cx);

            let Some(entry) = this.file_rows.get(*row).map(|r| r.entry.clone()) else {
                return;
            };

            match entry {
                super::files::Entry::Folder(path) => this.toggle_folder(path, cx),
                super::files::Entry::File(_) => this.activate_file_row(*row, cx),
            }
        }));

        let visible = rows.len();

        let list=gpui::uniform_list("committed-files",visible,move |range,_,_|range.map(|index|{
            let row=&rows[index];
            let cursor_active=cursor.as_ref()==Some(&row.entry);
            let theme=Theme::current();
            let callback=callback.clone();

            let (active, label, expanded, icon) = match &row.entry {
                super::files::Entry::File(file_index) => {
                    let file = &details.files[*file_index];
                    let active = selected.as_ref()==Some(&file.path);
                    let label = format!("{}, {}",read::path_label(&file.path),read::status_name(file.status));

                    (active,label,None,chrome::status_icon(file.status))
                }
                super::files::Entry::Folder(path) => {
                    let open = row.expanded == Some(true);

                    let icon=rake::view! {
                        <div class="flex flex-row items-center gap-1.5 text-muted-ink">
                            <onegit_ui::Icon size={onegit_ui::IconSize::Small} {..onegit_ui::Icon::new("disclosure",if open{IconName::ChevronDown}else{IconName::ChevronRight})}/>
                            <onegit_ui::Icon size={onegit_ui::IconSize::Small} {..onegit_ui::Icon::new("folder",IconName::Folder)}/>
                        </div>
                    }.into_any_element();

                    (cursor.as_ref()==Some(&row.entry),format!("{}, {} changed files",String::from_utf8_lossy(path),row.count),Some(open),icon)
                }
            };

            let identity = if expanded.is_some() { Some(rake::view!{<p class="text-small text-muted-ink" wrap={false} ellipsis={true}>{row.label.clone()}</p>}.into_any_element()) } else if !tree {
                match row.entry { super::files::Entry::File(i) => Some(chrome::file_identity(&details.files[i].path)), _=>None }
            } else { None };

            let name = if tree { row.label.clone() } else {
                match row.entry { super::files::Entry::File(i) => read::path_label(&details.files[i].path), _=>row.label.clone() }
            };

            let icon = gpui::div().pl(px(row.depth as f32*16.)).flex().items_center().child(icon).into_any_element();
            let count = expanded.map(|_|rake::view!{<p class="text-caption text-faint-ink">{row.count.to_string()}</p>}.into_any_element());

            rake::view! {
                <div id={index} role={if tree{accesskit::Role::TreeItem}else{accesskit::Role::ListBoxOption}} aria-label={label.clone()}
                    class="w-full h-[28px] min-w-0 border-1 rounded-[4px]"
                    style={|s|s.border_color(if cursor_active&&focused{theme.focus_ring}else{gpui::transparent_black()})
                        .aria_selected(active && expanded.is_none()).when(tree,|s|s.aria_level(row.depth+1)).when_some(expanded,|s,v|s.aria_expanded(v)).when(cursor_active && owns_focus,|s|s.aria_active_descendant())
                        .debug_selector(||format!("history-file-{index}"))
                        .a11y_synthetic_children(move|builder|{builder.parent_node().set_position_in_set(index+1);builder.parent_node().set_size_of_set(visible);})}>
                    <onegit_ui::ListRow tab_index={-1} variant={onegit_ui::ListRowVariant::Compact} leading={Some(icon)} label_content={identity} trailing={count} accessibility_label={Some(label.into())}
                        selection={if active && expanded.is_none(){onegit_ui::RowSelection::Selected}else{onegit_ui::RowSelection::Unselected}}
                        on_press={Some(Box::new(move|_,window,cx|callback(&index,window,cx)))}
                        {..onegit_ui::ListRow::new(format!("{}:{:?}",details.commit.oid,row.entry),name)}/>
                </div>
            }.into_any_element()
        }).collect()).size_full().min_w_0().min_h_0().track_scroll(&self.files_scroll).with_sizing_behavior(gpui::ListSizingBehavior::Auto);

        rake::view! {
            <div class="size-full min-w-0 min-h-0 flex flex-col" style={|s|s.when(self.presentation==Presentation::Inspector,|s|s.pr(px(6.)))}>
                <div class="shrink-0 flex flex-row items-center justify-between" style={|s|s.h(px(if self.presentation==Presentation::Inspector{42.}else{28.})).pl(px(if self.presentation==Presentation::Inspector{8.}else{14.})).pr(px(if self.presentation==Presentation::Inspector{8.}else{12.}))}>
                    <Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("file-heading",if self.presentation==Presentation::Inspector{format!("Changed files · {count}")}else{"Changed files".to_owned()})}/>
                    <div class="flex flex-row items-center gap-3">if self.presentation!=Presentation::Inspector {<Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("file-count",count.to_string())}/>}<onegit_ui::Tooltip {..onegit_ui::Tooltip::new("file-layout-tip",if self.tree_layout{"Switch to list view"}else{"Switch to tree view"})}><Button variant={if self.tree_layout{ButtonVariant::Secondary}else{ButtonVariant::Ghost}} tone={if self.tree_layout{onegit_ui::ButtonTone::Accent}else{onegit_ui::ButtonTone::Normal}} pressed={Some(self.tree_layout)} size={ControlSize::Small} height={Some(px(26.))} width={Some(px(26.))} padding={Some(px(0.))} icon={Some(if self.tree_layout{IconName::Tree}else{IconName::List})} accessibility_label={Some(if self.tree_layout{"Switch to list view".into()}else{"Switch to tree view".into()})} on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.toggle_layout(cx))))} {..Button::new("file-layout","")}/></onegit_ui::Tooltip></div>
                </div>
                <div id="history-files" role={if self.tree_layout{accesskit::Role::Tree}else{accesskit::Role::ListBox}} aria-label="Committed files" class="flex-1 min-w-0 min-h-0 overflow-hidden pl-1.5" style={|s|s.pr(px(if self.presentation==Presentation::Inspector{6.}else{12.})).track_focus(&focus).debug_selector(||"history-files".into()).on_key_down(cx.listener(|this,event,window,cx|this.navigate_files(event,window,cx)))}>
                    {list}
                </div>

            </div>
        }.into_any_element()
    }

    fn metadata(details: &Details) -> gpui::AnyElement {
        let commit = &details.commit;

        rake::view! {
            <div id="commit-metadata" class="py-2.5 pl-3.5 pr-3 shrink-0 max-h-[160px] overflow-y-scroll flex flex-col gap-1 border-b-1 border-hairline">
                <div role={accesskit::Role::Heading} aria-label={commit.summary.clone()} style={|s|s.aria_level(2)}><onegit_ui::CommitSubject wrap={true} {..onegit_ui::CommitSubject::new("subject",commit.summary.clone())}/></div>
                <div class="flex flex-row flex-wrap items-center gap-1.5">
                    <p class="text-caption text-muted-ink" aria-label={format!("{} <{}>",commit.author.name,commit.author.email)}>{commit.author.name.clone()}</p>
                    <p class="text-caption text-faint-ink">{format!("· {}",chrono::DateTime::parse_from_rfc3339(&commit.authored_at).map(|date|date.with_timezone(&chrono::Local).format("%b %-d, %Y at %-I:%M %p").to_string()).unwrap_or_else(|_|commit.authored_at.clone()))}</p>
                    <button id="copy-sha" aria-label="Copy commit SHA" aria-description={commit.oid.clone()} class="h-5 px-1 rounded-[4px] text-caption text-muted-ink" on:click={{let oid=commit.oid.clone();move|_,_,cx|cx.write_to_clipboard(gpui::ClipboardItem::new_string(oid.clone()))}}>{commit.oid.chars().take(7).collect::<String>()}</button>
                </div>
                if let Some((_,body))=commit.body.split_once("\n\n"){<p class="text-small">{body}</p>}
                if commit.parent_oids.len()>1{<Text role={TextRole::Caption} tone={TextTone::Faint} {..Text::new("comparison","Changes against first parent")}/>}
            </div>
        }.into_any_element()
    }

    fn preview(&self, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let menu=rake::view! {
            <DropdownMenu icon_only={true} icon={Some(IconName::Sliders)} alignment={MenuAlignment::End} variant={ButtonVariant::Ghost} size={ControlSize::Small}
                entries={[(DiffView::Unified,"unified","Unified diff"),(DiffView::Split,"split","Split diff")].into_iter().map(|(view,id,label)|MenuItem{selected:Some(self.view==view),..MenuItem::new(id,label)}.into()).collect()}
                on_select={Some(Box::new(cx.listener(|this,id:&gpui::ElementId,_,cx|{this.view=if *id==gpui::ElementId::from("split"){DiffView::Split}else{DiffView::Unified};cx.notify();})))}
                {..DropdownMenu::new("history-diff-options","Diff display options")}/>
        }.into_any_element();

        let toolbar = chrome::patch_toolbar(self.file.as_ref(), &self.preview, "", menu);

        let content = match &self.preview {
            PreviewState::Empty => notice(
                "history-no-file",
                "No files changed",
                "This commit contains no changed files.",
            ),
            PreviewState::Loading => notice(
                "history-patch-loading",
                "Loading patch…",
                "Reading the selected committed file.",
            ),
            PreviewState::Failed(error) => notice(
                "history-patch-error",
                "Could not load this patch",
                error.clone(),
            ),
            PreviewState::Ready(Preview::Notice { title, detail }) => {
                notice("history-patch-notice", *title, detail.clone())
            }
            PreviewState::Ready(Preview::Conflict(_)) => notice(
                "history-conflict",
                "Select Changes to resolve conflicts",
                "Saved revisions never contain an editable conflict result.",
            ),
            PreviewState::Ready(Preview::Patch { document, .. }) => {
                let title = self.file.as_ref().map(read::path_label).unwrap_or_default();

                rake::view!{<DiffViewer split_layout={onegit_ui::DiffSplitLayout::Aligned} state={self.diff_state.clone()} show_header={false} view={self.view} {..DiffViewer::new("history-diff",title,document.without_file_metadata())}/>}.into_any_element()
            }
        };

        rake::view! {
            <div class="size-full min-w-0 min-h-0 flex flex-col">
                {toolbar}
                if matches!(self.preview,PreviewState::Failed(_)){<div class="px-3 py-1"><Button size={ControlSize::Small} variant={ButtonVariant::Ghost} on_press={Some(Box::new(cx.listener(|this,_,_,cx|{if let Some(path)=this.file.clone(){this.select_file(path,cx);}})))} {..Button::new("retry-history-patch","Retry patch")}/></div>}
                if !matches!(self.detail,DetailState::Ready(_)) {
                    <div class="h-[28px] shrink-0 flex flex-row justify-end px-2">
                        <onegit_ui::IconButton size={ControlSize::Small} on_press={Some(Box::new(cx.listener(|_,_,_,cx|cx.emit(super::Close))))} {..onegit_ui::IconButton::new("close-pending-graph-details",IconName::Close,"Close commit details")}/>
                    </div>
                }
                <div class="flex-1 min-w-0 min-h-0">{content}</div>
            </div>
        }.into_any_element()
    }
}

impl Render for HistoryWorkspace {
    fn render(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        if self.presentation == Presentation::Inspector {
            return self.inspector_view(window, cx);
        }

        let revisions = self.revisions(cx);

        let (files, detail) = match &self.detail {
            DetailState::Empty => (
                notice(
                    "history-empty-files",
                    "Changed files",
                    "Select a commit to see its files.",
                ),
                notice(
                    "history-empty",
                    "Select a commit",
                    "Its details and changed files will appear here.",
                ),
            ),
            DetailState::Loading => (
                notice("history-loading-files", "Reading committed files…", ""),
                notice(
                    "history-detail-loading",
                    "Loading commit…",
                    "Reading the selected commit's changed files.",
                ),
            ),
            DetailState::Failed(error) => {
                let content = notice(
                    "history-detail-error",
                    "Could not load this commit",
                    error.clone(),
                );

                let retry=rake::view!{
                    <div class="size-full min-w-0 min-h-0 flex flex-col"><div class="p-3"><Button size={ControlSize::Small} on_press={Some(Box::new(cx.listener(|this,_,_,cx|{if let Some(oid)=this.selected.clone(){this.select_commit(oid,cx);}})))} {..Button::new("retry-commit","Retry commit")}/></div><div class="flex-1 min-h-0">{content}</div></div>
                }.into_any_element();

                (
                    notice(
                        "history-files-error",
                        "Committed files unavailable",
                        "Retry the selected commit.",
                    ),
                    retry,
                )
            }
            DetailState::Ready(details) => {
                let files = self.files(details.clone(), window, cx);
                let metadata = Self::metadata(details);
                let preview = self.preview(cx);
                let detail=rake::view!{<div class="size-full min-w-0 min-h-0 flex flex-col">{metadata}<div class="flex-1 min-w-0 min-h-0">{preview}</div></div>}.into_any_element();

                (files, detail)
            }
        };

        let panes=rake::view!{<ResizableSplit divider_size={px(9.)} axis={SplitAxis::Vertical} min_first={px(120.)} min_second={px(100.)} first={revisions} second={files} {..ResizableSplit::new("history-revisions-split",&self.detail_split,"History list height")}/>}.into_any_element();

        let sidebar = rake::view! {
            <div class="size-full min-w-0 min-h-0 flex flex-col">
                <div class="h-[36px] shrink-0 pl-3.5 pr-3 flex flex-row items-center gap-1.5">
                    <p class="text-body font-medium">{"History"}</p>
                    <Text role={TextRole::Caption} tone={TextTone::Faint} {..Text::new("count",self.total.map_or_else(||format!("({}{})",self.data.items().len(),if self.next_offset.is_some(){"+"}else{""}),|total|format!("({total})")))}/>
                    <div class="flex-1"/>
                    <onegit_ui::IconButton size={ControlSize::Small} on_press={Some(Box::new(cx.listener(|_,_,_,cx|cx.emit(super::Refresh))))} {..onegit_ui::IconButton::new("refresh-history",IconName::Refresh,"Refresh repository")}/>
                    <onegit_ui::Tooltip {..onegit_ui::Tooltip::new("history-search-unavailable","History search is not ported to Rust yet")}><div class="size-6 flex items-center justify-center text-muted-ink"><onegit_ui::Icon label={Some("History search unavailable".into())} {..onegit_ui::Icon::new("history-search",IconName::Search)}/></div></onegit_ui::Tooltip>
                </div>
                <div class="flex-1 min-w-0 min-h-0">{panes}</div>
                <div class="h-[32px] px-3.5 shrink-0 flex flex-row items-center justify-between"><Text role={TextRole::Caption} tone={TextTone::Faint} {..Text::new("footer","First-parent diffs")}/><Text role={TextRole::Caption} tone={TextTone::Faint} {..Text::new("navigation","↑ ↓ Navigate")}/></div>
            </div>
        }.into_any_element();

        rake::view! {<ResizableSplit divider_size={px(1.)} min_first={px(240.)} min_second={px(240.)} first={sidebar} second={detail} {..ResizableSplit::new("history-sidebar-split",&self.sidebar,"History sidebar width")}/>}.into_any_element()
    }
}

impl HistoryWorkspace {
    fn inspector_view(
        &self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> gpui::AnyElement {
        let content = match &self.detail {
            DetailState::Ready(details) => {
                let metadata = self.inspector_metadata(details, window, cx);
                let files = self.files(details.clone(), window, cx);
                let preview = self.preview(cx);

                rake::view! {
                    <div class="size-full min-w-0 min-h-0 flex flex-col">
                        {metadata}
                        <div class="flex-1 min-w-0 min-h-0">
                            <ResizableSplit divider_size={px(1.)} min_first={px(119.)} max_first={Some(px(419.))} min_second={px(160.)} first={files} second={preview} {..ResizableSplit::new("graph-files-split",&self.sidebar,"Committed files width")}/>
                        </div>
                    </div>
                }.into_any_element()
            }
            DetailState::Failed(error) => rake::view! {
                <div class="size-full min-w-0 min-h-0 flex flex-col">
                    {notice("graph-detail-error","Could not load this commit",error.clone())}
                    <Button size={ControlSize::Small} on_press={Some(Box::new(cx.listener(|this,_,_,cx|{
                        if let Some(oid)=this.selected.clone(){this.load_commit(oid,None,None,cx);}
                    })))} {..Button::new("graph-retry-detail","Retry commit")}/>
                </div>
            }.into_any_element(),
            DetailState::Loading => notice("graph-detail-loading","Loading commit…","Reading committed files."),
            DetailState::Empty => notice("graph-detail-empty","Select a commit",""),
        };

        rake::view! {
            <div class="size-full min-w-0 min-h-0 flex flex-col">
                if !matches!(self.detail,DetailState::Ready(_)) {
                    <div class="h-[28px] shrink-0 flex flex-row justify-end px-2">
                        <onegit_ui::IconButton size={ControlSize::Small} on_press={Some(Box::new(cx.listener(|_,_,_,cx|cx.emit(super::Close))))} {..onegit_ui::IconButton::new("close-pending-graph-details",IconName::Close,"Close commit details")}/>
                    </div>
                }
                <div class="flex-1 min-w-0 min-h-0">{content}</div>
            </div>
        }
        .into_any_element()
    }
}

impl HistoryWorkspace {
    fn inspector_metadata(
        &self,
        details: &Details,
        window: &gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> gpui::AnyElement {
        let commit = &details.commit;

        let body = commit
            .body
            .split_once("\n\n")
            .map_or("", |(_, body)| body)
            .trim_end();

        let preview = body.split("\n\n").next().unwrap_or("");
        let more = body != preview || preview.lines().count() > 3 || preview.chars().count() > 180;

        let tags = self
            .tags
            .iter()
            .map(|s| s.as_ref())
            .collect::<Vec<_>>()
            .join(", ");

        rake::view! {
            <div class="flex flex-row items-center shrink-0 min-w-0 border-b-1 border-hairline">
                <div id="graph-commit-metadata" role={accesskit::Role::Group} aria-label="Selected commit" class="flex-1 min-w-0 max-h-[120px] overflow-y-scroll py-2.5 pl-3.5 pr-3 flex flex-col gap-1">
                    <div role={accesskit::Role::Heading} aria-label={commit.summary.clone()} class="max-h-[64px] overflow-y-scroll" style={|s|s.aria_level(2)}>
                        <onegit_ui::CommitSubject wrap={true} {..onegit_ui::CommitSubject::new("graph-subject",commit.summary.clone())}/>
                    </div>
                    <div class="flex flex-row flex-wrap items-center gap-1.5">
                        <p class="text-caption text-muted-ink" aria-label={format!("{} <{}>",commit.author.name,commit.author.email)}>{commit.author.name.clone()}</p>
                        <p class="text-caption text-faint-ink">{format!("· {}",chrono::DateTime::parse_from_rfc3339(&commit.authored_at).map(|d|d.with_timezone(&chrono::Local).format("%b %-d, %Y at %-I:%M %p").to_string()).unwrap_or_else(|_|commit.authored_at.clone()))}</p>
                        <button id="graph-copy-sha" aria-label="Copy commit SHA" aria-description={commit.oid.clone()} class="h-5 px-1 rounded-[4px] text-caption text-muted-ink"
                            on:click={cx.listener({let oid=commit.oid.clone();move|this,_,_,cx|{cx.write_to_clipboard(gpui::ClipboardItem::new_string(oid.clone()));this.copied=true;cx.notify();}})}>
                            {format!("{}{}",commit.oid.chars().take(7).collect::<String>(),if self.copied{" · Copied"}else{""})}
                        </button>
                        if !tags.is_empty() {<p aria-label={format!("Tags: {tags}")} wrap={false} ellipsis={true} class="max-w-[180px] px-1 rounded-[3px] bg-surface-sunken text-caption text-muted-ink">{tags}</p>}
                        if more {
                            <button id="graph-description" aria-label={if self.description_expanded{"Show less description"}else{"Show more description"}} class="h-5 px-1 rounded-[4px] text-caption text-muted-ink"
                                style={|s|s.aria_expanded(self.description_expanded)}
                                on:click={cx.listener(|this,_,_,cx|{this.description_expanded = !this.description_expanded;cx.notify();})}>{if self.description_expanded{"Show less"}else{"Show more"}}</button>
                        }
                    </div>
                    if !body.is_empty(){
                        <div id="graph-description-text" class="min-w-0" style={|s|s.max_h(px(if self.description_expanded{160.}else{48.})).when(self.description_expanded,|s|s.overflow_y_scroll()).when(!self.description_expanded,|s|s.overflow_hidden())}>
                            <p class="text-small text-muted-ink" aria-label={body.to_owned()}>{if self.description_expanded{body}else{preview}}</p>
                        </div>
                    }
                </div>
                <div class="pr-2 shrink-0 flex flex-row items-center">
                    <Button accessibility_label={Some("Create branch here".into())} variant={ButtonVariant::Ghost} size={ControlSize::Small} state={if self.branch_available{ControlState::Enabled}else{ControlState::Disabled}} on_press={Some(Box::new(cx.listener({let commit=details.commit.clone();move|_,_,_,cx|cx.emit(super::CreateBranch(commit.clone()))})))} {..Button::new("graph-new-branch",if window.viewport_size().width<px(850.){"+"}else{"New Branch…"})}/>
                    <Button size={ControlSize::Small} variant={ButtonVariant::Ghost} width={Some(px(24.))} padding={Some(px(0.))} accessibility_label={Some("Close commit details".into())} on_press={Some(Box::new(cx.listener(|_,_,_,cx|cx.emit(super::Close))))} {..Button::new("graph-close-details","×")}/>
                </div>
            </div>
        }.into_any_element()
    }
}
