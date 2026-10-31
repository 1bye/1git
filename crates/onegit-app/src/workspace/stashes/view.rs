use super::{Files, Stashes};
use crate::workspace::{Preview, PreviewState, chrome, read, view::notice};
use onegit_git::StashAction;

use onegit_ui::{
    Button, ButtonVariant, ControlSize, ControlState, DiffView, DiffViewer, DropdownMenu, IconName,
    MenuAlignment, MenuItem, ResizableSplit, SplitAxis, Text, TextRole, TextTone, Theme,
};

use rake::gpui::{self, accesskit, prelude::*, px};
use std::ops::Range;

fn placeholder() -> gpui::AnyElement {
    rake::view!{<div class="size-full flex flex-col gap-3 py-3.5 pl-2 pr-3.5" style={|s|s.opacity(0.45).a11y_synthetic_children(|builder|builder.parent_node().set_hidden())}>
        for (index,width) in [0.7,0.45,0.6,0.35].into_iter().enumerate(){<div id={index} class="h-[6px] rounded-[2px] bg-line shrink-0" style={|s|s.w(gpui::relative(width)).when(index==2,|s|s.mt(px(8.)))}/>}
    </div>}.into_any_element()
}

fn date(value: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|d| {
            d.with_timezone(&chrono::Local)
                .format("%b %-d, %Y")
                .to_string()
        })
        .unwrap_or_else(|_| value.into())
}

fn empty(
    title: &'static str,
    detail: &'static str,
    compact: bool,
    stash: bool,
) -> gpui::AnyElement {
    let drawing = gpui::canvas(
        |_, _, _| {},
        move |bounds, _, window, cx| {
            let (key, data): (&'static str, &'static [u8]) = if stash {
                (
                    "onegit-app/state-stash",
                    include_bytes!("../assets/state-stash.svg"),
                )
            } else {
                (
                    "onegit-app/state-file",
                    include_bytes!("../assets/state-file.svg"),
                )
            };

            window
                .paint_svg(
                    bounds,
                    key.into(),
                    Some(data),
                    Default::default(),
                    Theme::current().muted_ink,
                    cx,
                )
                .expect("original state artwork is valid");
        },
    )
    .w(px(if compact { 80. } else { 160. }))
    .h(px(if compact { 56. } else { 112. }))
    .flex_shrink_0();

    rake::view!{<div role={accesskit::Role::Status} aria-label={title} class={if compact{"size-full min-w-0 min-h-0 flex flex-col items-center justify-center gap-2 p-3"}else{"size-full min-w-0 min-h-0 flex flex-col items-center justify-center gap-2 p-6"}}>
        {drawing}<p class={if compact{"text-small text-center"}else{"text-[15px] leading-[22px] font-medium text-center"}}>{title}</p>
        if !detail.is_empty(){<p class="text-small text-faint-ink text-center max-w-[420px]">{detail}</p>}
    </div>}.into_any_element()
}

impl Stashes {
    fn revisions(&self, window: &gpui::Window, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let count = self.entries.len();
        let focus = self.list_focus.clone().tab_stop(count > 0);
        let owns_focus = focus.is_focused(window);
        let keyboard = owns_focus && window.last_input_was_keyboard();

        let selected_index = self
            .selected
            .as_ref()
            .and_then(|oid| self.entries.iter().position(|stash| &stash.oid == oid));

        let list=gpui::uniform_list("stash-list",count,cx.processor(move|this,range:Range<usize>,_,cx|range.map(|index|{
            let stash=&this.entries[index];let selected=selected_index==Some(index);let oid=stash.oid.clone();let label=if stash.summary.is_empty(){"Untitled stash".into()}else{stash.summary.clone()};let detail=format!("{} · {}",stash.reference,date(&stash.created_at));let theme=Theme::current();

            rake::view! {
                <div id={index} role={accesskit::Role::ListBoxOption} aria-label={format!("{label}, {detail}")} class="w-full h-[48px] min-w-0 px-2 flex flex-col items-start justify-center gap-1 rounded-[8px] border-1 font-normal text-left"
                    style={|s|s.bg(if selected{theme.selection}else{gpui::transparent_black()}).border_color(if selected&&keyboard{theme.focus_ring}else{gpui::transparent_black()}).aria_selected(selected).cursor(gpui::CursorStyle::PointingHand).when(selected&&owns_focus,|s|s.aria_active_descendant()).hover(|s|s.bg(if selected{theme.selection}else{theme.hover})).debug_selector(move||format!("stash-row-{index}"))
                        .a11y_synthetic_children(move|builder|{builder.parent_node().set_position_in_set(index+1);builder.parent_node().set_size_of_set(count);})}
                    on:click={cx.listener(move|this,_,window,cx|{window.focus(&this.list_focus,cx);if this.selected.as_ref()!=Some(&oid){this.select(oid.clone(),cx);}})}>
                    <p class="w-full min-w-0 text-small font-normal text-left" max-lines={1} ellipsis={true} style={|s|s.debug_selector(move||format!("stash-title-{index}"))}>{label}</p>
                    <p class="w-full min-w-0 text-[9px] leading-[12px] text-faint-ink font-normal text-left" max-lines={1} ellipsis={true} style={|s|s.debug_selector(move||format!("stash-date-{index}"))}>{detail}</p>
                </div>
            }.into_any_element()
        }).collect())).size_full().min_h_0().track_scroll(&self.scroll).with_sizing_behavior(gpui::ListSizingBehavior::Auto);

        let actions = self.actions(cx);

        rake::view! {
            <div class="size-full min-h-0 flex flex-col">
                <div id="stash-revisions" role={accesskit::Role::ListBox} aria-label="Saved stashes" class="flex-1 min-h-0 pl-1.5 pr-3" style={|s|s.track_focus(&focus).on_key_down(cx.listener(|this,event,window,cx|this.navigate(false,event,window,cx)))}>
                    if count>0 {{list}} else if self.loaded&&self.error.is_none() {{placeholder()}} else {<div class="size-full p-3"><Text role={TextRole::Small} tone={TextTone::Muted} {..Text::new("empty-stashes",if self.list_job.is_some(){"Loading stashes…"}else{"Stashes unavailable"})}/></div>}
                </div>
                if let Some(error)=&self.error {<div class="px-3 flex flex-col gap-1 shrink-0"><Text tone={TextTone::Danger} role={TextRole::Caption} max_lines={Some(3)} {..Text::new("stash-list-error",error.clone())}/><Button size={ControlSize::Small} variant={ButtonVariant::Ghost} on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.load(cx))))} {..Button::new("retry-stashes","Retry stashes")}/></div>}
                {actions}
            </div>
        }.into_any_element()
    }

    fn actions(&self, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let ready = !self.blocked && self.loaded && self.error.is_none() && self.list_job.is_none();

        let enabled = if ready {
            ControlState::Enabled
        } else {
            ControlState::Disabled
        };

        let can_save = ready && self.source.as_ref().is_some_and(|s| !s.files.is_empty());

        fn measure(
            anchor: std::rc::Rc<std::cell::Cell<gpui::Bounds<gpui::Pixels>>>,
        ) -> gpui::AnyElement {
            gpui::canvas(move |bounds, _, _| anchor.set(bounds), |_, _, _, _| {})
                .absolute()
                .size_full()
                .into_any_element()
        }
        let more_measure = measure(self.form.read(cx).more_anchor.clone());
        let create_measure = measure(self.form.read(cx).create_anchor.clone());

        rake::view! {
            <div class="relative h-[40px] pl-2 pr-3.5 shrink-0 flex flex-row items-center gap-1.5" style={|s|s.debug_selector(||"stash-actions".into())}>
                if let Some(oid)=&self.selected {
                    <div style={|s|s.debug_selector(||"stash-apply-trigger".into())}><Button size={ControlSize::Small} variant={ButtonVariant::Primary} state={enabled} on_press={Some(Box::new(cx.listener({let oid=oid.clone();move|this,_,window,cx|this.request(StashAction::Apply(oid.clone()),window,cx)})))} {..Button::new("stash-apply","Apply")}/></div>
                    <div class="relative" style={|s|s.debug_selector(||"stash-more-trigger".into())}>{more_measure}<DropdownMenu icon_only={true} icon={Some(IconName::More)} width={px(180.)} alignment={MenuAlignment::Start} variant={ButtonVariant::Ghost} size={ControlSize::Small} state={enabled}
                        entries={vec![MenuItem::new("pop","Pop stash").into(),MenuItem::new("delete","Delete stash…").into()]}
                        on_select={Some(Box::new(cx.listener({let oid=oid.clone();move|this,id:&gpui::ElementId,window,cx|{let action=if *id==gpui::ElementId::from("pop"){StashAction::Pop(oid.clone())}else{StashAction::Delete(oid.clone())};this.request(action,window,cx);}})))}
                        {..DropdownMenu::new("stash-more","More stash actions")}/></div>
                }
                <div class="flex-1"/>
                <div class="relative" style={|s|s.debug_selector(||"stash-create-trigger".into())}>{create_measure}<Button size={ControlSize::Small} variant={ButtonVariant::Primary} state={if can_save{ControlState::Enabled}else{ControlState::Disabled}}
                    on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.request(StashAction::Save{message:String::new(),include_untracked:false},window,cx))))}
                    {..Button::new("stash-create","+ New stash")}/></div>
            </div>
        }.into_any_element()
    }

    fn saved_files(&self, window: &gpui::Window, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let count = match &self.files {
            Files::Ready(files) => files.len(),
            _ => 0,
        };

        let focus = self.files_focus.clone().tab_stop(count > 0);
        let owns_focus = focus.is_focused(window);
        let keyboard = owns_focus && window.last_input_was_keyboard();

        let list=gpui::uniform_list("stash-files-list",count,cx.processor(move|this,range:Range<usize>,_,cx|{
            let Files::Ready(files)=&this.files else{return Vec::new();};

            range.map(|index|{let file=files[index].clone();let active=this.file.as_ref()==Some(&file);let theme=Theme::current();let label=read::path_label(&file.file.path);let icon=chrome::status_icon(file.file.status);let identity=chrome::file_identity(&file.file.path);

                rake::view! {
                    <div id={index} role={accesskit::Role::ListBoxOption} aria-label={format!("{label}, {}",if this.selected.as_deref()!=Some(file.revision.as_str()){"Saved untracked file"}else{read::status_name(file.file.status)})} class="w-full h-[28px] min-w-0 px-2 flex flex-row items-center gap-2 border-1 rounded-[4px] overflow-hidden font-normal"
                        style={|s|s.bg(if active{theme.selection}else{gpui::transparent_black()}).border_color(if active&&keyboard{theme.focus_ring}else{gpui::transparent_black()}).aria_selected(active).cursor(gpui::CursorStyle::PointingHand).when(active&&owns_focus,|s|s.aria_active_descendant()).hover(|s|s.bg(if active{theme.selection}else{theme.hover})).debug_selector(move||format!("stash-file-{index}"))}
                        on:click={cx.listener(move|this,_,window,cx|{window.focus(&this.files_focus,cx);if this.file.as_ref()!=Some(&file){this.select_file(file.clone(),cx);}})}>
                        {icon}<div class="flex-1 min-w-0">{identity}</div>
                    </div>
                }.into_any_element()
            }).collect()
        })).size_full().min_h_0().track_scroll(&self.files_scroll).with_sizing_behavior(gpui::ListSizingBehavior::Auto);

        rake::view! {
            <div class="size-full min-h-0 flex flex-col">
                <div class="h-[28px] px-3.5 shrink-0 flex flex-row items-center justify-between" style={|s|s.debug_selector(||"stash-files-heading".into())}><Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("files-title","Stashed files")}/><div class="flex flex-row items-center gap-3"><Text role={TextRole::Caption} tone={TextTone::Muted} {..Text::new("files-count",if self.selected.is_some(){count.to_string()}else{String::new()})}/><onegit_ui::Icon {..onegit_ui::Icon::new("files-layout",IconName::List)}/></div></div>
                <div id="stash-files" role={accesskit::Role::ListBox} aria-label="Stashed files" class="flex-1 min-h-0 pl-1.5 pr-3" style={|s|s.track_focus(&focus).on_key_down(cx.listener(|this,event,window,cx|this.navigate(true,event,window,cx)))}>if matches!(self.files,Files::Loading) {{empty("Reading saved files…","",true,false)}} else if self.loaded&&self.entries.is_empty() {{placeholder()}} else if count==0 {{empty(if self.selected.is_some(){"No file changes in this revision."}else{"Select a stash to see its files."},"",true,self.selected.is_none())}}else{{list}}</div>
            </div>
        }.into_any_element()
    }

    fn preview(&self, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let menu=rake::view!{<DropdownMenu icon_only={true} icon={Some(IconName::Sliders)} alignment={MenuAlignment::End} variant={ButtonVariant::Ghost} size={ControlSize::Small}
            entries={[(DiffView::Unified,"unified","Unified diff"),(DiffView::Split,"split","Split diff")].into_iter().map(|(view,id,label)|MenuItem{selected:Some(self.view==view),..MenuItem::new(id,label)}.into()).collect()}
            on_select={Some(Box::new(cx.listener(|this,id:&gpui::ElementId,_,cx|{this.view=if *id==gpui::ElementId::from("split"){DiffView::Split}else{DiffView::Unified};cx.notify();})))} {..DropdownMenu::new("stash-diff-options","Diff display options")}/>}.into_any_element();

        let toolbar = chrome::patch_toolbar(
            self.file.as_ref().map(|f| &f.file.path),
            &self.preview,
            "",
            menu,
        );

        let content=match &self.preview {
            PreviewState::Empty=>if self.selected.is_some(){empty("No file changes","This stash has no file changes compared with its base.",false,false)}else{empty("No stashed changes","Save changes with New stash, then inspect, apply or delete saved work here.",false,true)},
            PreviewState::Loading=>notice("stash-loading-patch","Loading patch…","Reading the saved version, without changing working files."),
            PreviewState::Failed(error)=>notice("stash-patch-error","Could not read saved patch",error.clone()),
            PreviewState::Ready(Preview::Notice{title,detail})=>notice("stash-patch-notice",*title,detail.clone()),
            PreviewState::Ready(Preview::Conflict(_)) => notice("stash-conflict", "Select Changes to resolve conflicts", "Saved revisions never contain an editable conflict result."),
            PreviewState::Ready(Preview::Patch(document))=>rake::view!{<DiffViewer state={self.diff_state.clone()} show_header={false} view={self.view} {..DiffViewer::new("stash-diff",self.file.as_ref().map(|f|read::path_label(&f.file.path)).unwrap_or_default(),document.without_file_metadata())}/>}.into_any_element(),
        };

        rake::view! {
            <div class="size-full min-h-0 min-w-0 flex flex-col">
                if let Files::Failed(error)=&self.files {<div class="p-3 flex flex-col gap-2"><Text role={TextRole::Caption} tone={TextTone::Danger} {..Text::new("stash-files-error",error.clone())}/><Button size={ControlSize::Small} on_press={Some(Box::new(cx.listener(|this,_,_,cx|{if let Some(oid)=this.selected.clone(){this.select(oid,cx);}})))} {..Button::new("retry-stash-files","Retry saved files")}/></div>}
                if !matches!(self.preview,PreviewState::Empty) {{toolbar}}
                if matches!(self.preview,PreviewState::Failed(_)){<div class="px-3 py-1"><Button size={ControlSize::Small} variant={ButtonVariant::Ghost} on_press={Some(Box::new(cx.listener(|this,_,_,cx|{if let Some(file)=this.file.clone(){this.select_file(file,cx);}})))} {..Button::new("retry-stash-patch","Retry patch")}/></div>}
                <div class="flex-1 min-h-0 min-w-0">{content}</div>
            </div>
        }.into_any_element()
    }
}

impl Render for Stashes {
    fn render(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        let revisions = self.revisions(window, cx);
        let files = self.saved_files(window, cx);
        let preview = self.preview(cx);
        let panes=rake::view!{<ResizableSplit divider_size={px(9.)} axis={SplitAxis::Vertical} min_first={px(120.)} min_second={px(100.)} first={revisions} second={files} {..ResizableSplit::new("stash-revisions-split",&self.detail_split,"Stash list height")}/>}.into_any_element();

        let sidebar=rake::view! {
            <div class="size-full min-w-0 min-h-0 flex flex-col">
                <div class="h-[36px] shrink-0 pl-3.5 pr-3 flex flex-row items-center gap-1.5"><p class="text-body font-medium">{"Stashes"}</p><Text role={TextRole::Caption} tone={TextTone::Faint} {..Text::new("stash-count",format!("({})",self.entries.len()))}/><div class="flex-1"/><onegit_ui::IconButton size={ControlSize::Small} state={if self.blocked{ControlState::Disabled}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(|_,_,_,cx|cx.emit(super::Refresh))))} {..onegit_ui::IconButton::new("refresh-stashes",IconName::Refresh,"Refresh repository")}/></div>
                <div class="flex-1 min-h-0 min-w-0">{panes}</div>
                <div class="h-[32px] px-3.5 shrink-0 flex flex-row items-center justify-between"><Text role={TextRole::Caption} tone={TextTone::Faint} {..Text::new("stash-footer","Apply keeps the stash")}/><Text role={TextRole::Caption} tone={TextTone::Faint} {..Text::new("stash-navigation","↑ ↓ Navigate")}/></div>
            </div>
        }.into_any_element();

        let body=rake::view!{<ResizableSplit divider_size={px(1.)} min_first={px(240.)} min_second={px(240.)} first={sidebar} second={preview} {..ResizableSplit::new("stash-sidebar-split",&self.sidebar,"Stashes sidebar width")}/>}.into_any_element();

        if let Some(host) = &self.host {
            rake::view!{<onegit_ui::DialogHost state={host.clone()} body={body}>{self.form.clone()}</onegit_ui::DialogHost>}.into_any_element()
        } else {
            body
        }
    }
}
