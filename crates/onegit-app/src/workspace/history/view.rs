use super::{DetailState, Details, HistoryWorkspace};

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
        rake::view! {
            <div class="size-full min-w-0 min-h-0 flex flex-col">
                <div class="flex-1 min-w-0 min-h-0 pl-1.5 pr-3">
                    <CommitList state={Some(self.list_state.clone())} type_badges={true} selected={self.selected.clone()} empty_message={if self.page_job.is_some(){"Loading commits…".into()}else if self.page_error.is_some(){"History is unavailable.".into()}else{"No commits yet.".into()}}
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

        let callback = Rc::new(cx.listener(|this, path: &onegit_git::GitPath, window, cx| {
            window.focus(&this.files_focus, cx);

            if this.file.as_ref() != Some(path) {
                this.select_file(path.clone(), cx);
            }
        }));

        let list=gpui::uniform_list("committed-files",count,move |range,_,_|range.map(|index|{
            let file=&details.files[index];
            let path=file.path.clone();
            let active=selected.as_ref()==Some(&path);
            let theme=Theme::current();
            let label=read::path_label(&path);
            let description=file.original_path.as_ref().map(|source|format!("{} · from {}",read::status_name(file.status),read::path_label(source))).unwrap_or_else(||read::status_name(file.status).into());
            let callback=callback.clone();
            let identity=chrome::file_identity(&path);
            let icon=chrome::status_icon(file.status);

            rake::view! {
                <div id={index} role={accesskit::Role::ListBoxOption} aria-label={format!("{label}, {description}")}
                    class="w-full h-[28px] min-w-0 px-2 flex flex-row items-center gap-2 border-1 rounded-[4px] overflow-hidden"
                    style={|s|s.bg(if active{theme.selection}else{gpui::transparent_black()}).border_color(if active&&focused{theme.focus_ring}else{gpui::transparent_black()})
                        .aria_selected(active).when(active && owns_focus,|s|s.aria_active_descendant()).hover(|s|s.bg(if active{theme.selection}else{theme.hover})).cursor(gpui::CursorStyle::PointingHand)
                        .debug_selector(||format!("history-file-{index}"))
                        .a11y_synthetic_children(move|builder|{builder.parent_node().set_position_in_set(index+1);builder.parent_node().set_size_of_set(count);})}
                    on:click={move|_,window,cx|{cx.stop_propagation();callback(&path,window,cx);}}>
                    {icon}
                    <div class="flex-1 min-w-0">{identity}</div>
                </div>
            }.into_any_element()
        }).collect()).size_full().min_w_0().min_h_0().track_scroll(&self.files_scroll).with_sizing_behavior(gpui::ListSizingBehavior::Auto);

        rake::view! {
            <div class="size-full min-w-0 min-h-0 flex flex-col">
                <div class="h-[28px] px-3.5 shrink-0 flex flex-row items-center justify-between">
                    <Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("file-heading","Changed files")}/>
                    <div class="flex flex-row items-center gap-3"><Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("file-count",count.to_string())}/><onegit_ui::Tooltip {..onegit_ui::Tooltip::new("file-layout-tip","List view")}><div class="size-6 flex items-center justify-center text-muted-ink"><onegit_ui::Icon {..onegit_ui::Icon::new("file-layout",IconName::List)}/></div></onegit_ui::Tooltip></div>
                </div>
                <div id="history-files" role={accesskit::Role::ListBox} aria-label="Committed files" class="flex-1 min-w-0 min-h-0 overflow-hidden pl-1.5 pr-3"
                    style={|s|s.track_focus(&focus).debug_selector(||"history-files".into()).on_key_down(cx.listener(|this,event,window,cx|this.navigate_files(event,window,cx)))}>
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
            PreviewState::Ready(Preview::Patch(document)) => {
                let title = self.file.as_ref().map(read::path_label).unwrap_or_default();

                rake::view!{<DiffViewer state={self.diff_state.clone()} show_header={false} view={self.view} {..DiffViewer::new("history-diff",title,document.without_file_metadata())}/>}.into_any_element()
            }
        };

        rake::view! {
            <div class="size-full min-w-0 min-h-0 flex flex-col">
                {toolbar}
                if matches!(self.preview,PreviewState::Failed(_)){<div class="px-3 py-1"><Button size={ControlSize::Small} variant={ButtonVariant::Ghost} on_press={Some(Box::new(cx.listener(|this,_,_,cx|{if let Some(path)=this.file.clone(){this.select_file(path,cx);}})))} {..Button::new("retry-history-patch","Retry patch")}/></div>}
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
                <div class="h-[32px] px-3.5 shrink-0 flex flex-row items-center justify-between"><Text role={TextRole::Caption} tone={TextTone::Faint} {..Text::new("footer","Read-only · first-parent diffs")}/><Text role={TextRole::Caption} tone={TextTone::Faint} {..Text::new("navigation","↑ ↓ Navigate")}/></div>
            </div>
        }.into_any_element();

        rake::view! {<ResizableSplit divider_size={px(1.)} min_first={px(240.)} min_second={px(240.)} first={sidebar} second={detail} {..ResizableSplit::new("history-sidebar-split",&self.sidebar,"History sidebar width")}/>}
    }
}
