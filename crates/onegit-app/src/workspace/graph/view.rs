use super::{Graph, Kind};

use onegit_ui::{
    Button, ButtonVariant, CommitGraph, CommitRefKind, ControlSize, ControlState, ResizableSplit,
    SplitAxis, TextInput, Theme,
};

use rake::gpui::{self, accesskit, prelude::*, px};

impl Graph {
    fn references_view(
        &self,
        window: &gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> gpui::AnyElement {
        let refs = self.refs.clone();
        let visible = self.visible.clone();
        let selected = self.reference.clone();
        let count = visible.len();
        let focus = self.refs_focus.clone().tab_stop(count > 0);
        let owns = focus.is_focused(window);
        let keyboard = owns && window.last_input_was_keyboard();
        let cursor = self.refs_cursor.clone();

        let callback = std::rc::Rc::new(cx.listener(|this, id: &String, window, cx| {
            window.focus(&this.refs_focus, cx);
            this.refs_cursor = Some(id.clone());
            this.scope(Some(id.clone()), cx);
        }));

        let list=gpui::uniform_list("graph-references",count,move|range,_,_|range.map(|index|{
            let reference=&refs.items[visible[index]];let theme=Theme::current();
            let active=selected.as_ref()==Some(&reference.id);let focused=cursor.as_ref()==Some(&reference.id)&&keyboard;
            let id=reference.id.clone();let callback=callback.clone();
            let icon=if reference.current{"✓"}else{match reference.kind{CommitRefKind::Branch=>"⑂",CommitRefKind::Remote=>"☁",CommitRefKind::Tag=>"◇"}};

            rake::view! {
                <button id={index} tabindex={-1} role={accesskit::Role::ListBoxOption} aria-label={format!("{}{}",reference.label,if reference.current{", current branch"}else{""})}
                    class="w-full h-[28px] px-2 flex flex-row items-center gap-1.5 rounded-[6px] min-w-0 border-1"
                    style={|s|s.bg(if active{theme.selection}else{gpui::transparent_black()}).border_color(if focused{theme.focus_ring}else{gpui::transparent_black()}).hover(|s|s.bg(theme.hover)).aria_selected(active).when(focused,|s|s.aria_active_descendant())
                        .a11y_synthetic_children(move|builder|{builder.parent_node().set_position_in_set(index+1);builder.parent_node().set_size_of_set(count);})}
                    on:click={move|_,window,cx|callback(&id,window,cx)}>
                    <p class="shrink-0 text-small" style={|s|s.text_color(if reference.current{theme.success}else{theme.muted_ink})}>{icon}</p>
                    <p wrap={false} ellipsis={true} class="flex-1 min-w-0 text-small" style={|s|s.text_color(if reference.current{theme.success}else{theme.ink})}>{reference.label.clone()}</p>
                </button>
            }.into_any_element()
        }).collect()).size_full().min_w_0().min_h_0().track_scroll(&self.refs_scroll).with_sizing_behavior(gpui::ListSizingBehavior::Auto);

        rake::view! {
            <div class="size-full min-w-0 min-h-0 flex flex-col pr-1.5">
                <div class="p-2 flex flex-col gap-2 shrink-0">
                    <TextInput variant={onegit_ui::InputVariant::Filled} show_label={false} height={Some(px(30.))} size={ControlSize::Medium} placeholder={"Find branch or tag…".into()} {..TextInput::new("graph-search",&self.query,"Find branch or tag")}/>
                    if self.reference.is_some(){
                        <Button size={ControlSize::Small} variant={ButtonVariant::Ghost} on_press={Some(Box::new(cx.listener(|this,_,window,cx|{
                            this.scope(None,cx);
                            use gpui::Focusable;
                            window.focus(&this.query.read(cx).focus_handle(cx),cx);
                        })))} {..Button::new("graph-full","Show full graph")}/>
                    }
                    <div role={accesskit::Role::Group} aria-label="Reference types" class="flex flex-row flex-wrap gap-0.5">
                        for (kind,id,label) in [(Kind::All,"all","All"),(Kind::Local,"local","Local"),(Kind::Remote,"remote","Remote"),(Kind::Tags,"tags","Tags")] {
                            <Button id={id.into()} padding={Some(px(6.))} pressed={Some(self.kind==kind)} size={ControlSize::Small} variant={if self.kind==kind{ButtonVariant::Secondary}else{ButtonVariant::Ghost}} on_press={Some(Box::new(cx.listener(move|this,_,_,cx|{this.kind=kind;this.refs_scroll.scroll_to_item(0,gpui::ScrollStrategy::Top);this.filter(cx);cx.notify();})))} {..Button::new(id,label)}/>
                        }
                    </div>
                </div>
                if let Some(error)=&self.refs_error {
                    <div class="p-2 flex flex-col gap-1"><p class="text-caption text-danger">{error.clone()}</p>
                        <Button size={ControlSize::Small} variant={ButtonVariant::Ghost} on_press={Some(Box::new(cx.listener(|this,_,_,cx|{this.dirty=true;this.activate(cx);})))}
                            {..Button::new("graph-retry-refs","Retry references")}/>
                    </div>
                }
                <div id="graph-ref-list" role={accesskit::Role::ListBox} aria-label="Branches and tags" class="flex-1 min-w-0 min-h-0 px-1.5"
                    style={|s|s.track_focus(&focus).on_key_down(cx.listener(|this,event,window,cx|this.navigate_refs(event,window,cx)))}>
                    {list}
                </div>
                if count==0 {<p class="p-2 text-caption text-muted-ink">{if self.refs_job.is_some(){"Loading references…"}else{"No matching references"}}</p>}
            </div>
        }.into_any_element()
    }

    fn table(&self, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let commits = self.commits.clone();

        let range = self
            .selection
            .ordered(
                self.data
                    .commits()
                    .iter()
                    .map(|commit| commit.item.id.clone()),
            )
            .into_iter()
            .filter_map(|id| commits.iter().find(|c| c.oid == id.as_ref()).cloned())
            .collect::<Vec<_>>();

        let owner = cx.entity().downgrade();

        let head = self
            .source
            .as_ref()
            .and_then(|s| s.snapshot.status.head.oid.clone());

        let blocked = self.actions_blocked
            || self
                .source
                .as_ref()
                .is_none_or(|source| super::super::replay::unavailable(source).is_some());

        rake::view! {
            <div class="size-full min-w-0 min-h-0 flex flex-col">
                <div class="h-[34px] px-2 shrink-0 flex flex-row items-center gap-2 border-b-1 border-hairline">
                    <p class="text-caption text-muted-ink">{format!("{}{} commits",self.data.len(),if self.next_offset.is_some(){"+"}else{""})}</p><div class="flex-1"/>
                    if self.page_job.is_some()||self.next_offset.is_some()||self.page_error.is_some(){
                        <Button size={ControlSize::Small} variant={ButtonVariant::Ghost} state={if self.page_job.is_some(){ControlState::Busy}else{ControlState::Enabled}}
                            on_press={Some(Box::new(cx.listener(|this,_,_,cx|this.load_page(cx))))}
                            {..Button::new("graph-load-more",if self.page_error.is_some(){"Retry commits"}else{"Load older commits"})}/>
                    }
                </div>
                if let Some(error)=&self.page_error {<p role={accesskit::Role::Alert} class="px-2 py-1 text-caption text-danger">{error.clone()}</p>}
                <div class="flex-1 min-w-0 min-h-0">
                    <CommitGraph context_menu={Some(Box::new(move|oid|super::super::replay::menu(commits.iter().find(|commit|commit.oid==oid.as_ref()).expect("graph rows have commit metadata").clone(),range.clone(),blocked,head.as_deref(),owner.clone())))} selected_ids={self.selection.effective(self.selected.as_ref())} selected={self.selected.clone()} empty_message={if self.page_job.is_some(){"Loading commits…".into()}else{"No commits yet".into()}}
                        on_select_modified={Some(Box::new(cx.listener(|this,event:&onegit_ui::CommitSelectionEvent,_,cx|{
      this.selection.choose(event.id.clone(),&event.modifiers,this.data.commits().iter().map(|commit|commit.item.id.clone()),this.selected.as_ref());
      if this.selected.as_ref()!=Some(&event.id){this.select(&event.id,cx);}cx.notify();
  })))}
                        {..CommitGraph::new("graph-table",self.data.clone(),&self.state)}/>
                </div>
            </div>
        }.into_any_element()
    }
}

impl Render for Graph {
    fn render(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        let sidebar = self.references_view(window, cx);
        let table = self.table(cx);

        let content = if self.selected.is_some() {
            rake::view! {<ResizableSplit axis={SplitAxis::Vertical} divider_size={px(9.)} min_first={px(100.)} min_second={px(120.)} first={table} second={self.inspector.clone().into_any_element()} {..ResizableSplit::new("graph-details-split",&self.detail_split,"Commit graph height")}/>}.into_any_element()
        } else {
            table
        };

        rake::view! {<ResizableSplit divider_size={px(1.)} min_first={px(179.)} max_first={Some(px(419.))} min_second={px(280.)} first={sidebar} second={content} {..ResizableSplit::new("graph-sidebar-split",&self.sidebar,"Graph reference sidebar width")}/>}
    }
}
