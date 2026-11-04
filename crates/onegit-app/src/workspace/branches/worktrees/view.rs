use super::{Form, Phase, Picker};

use onegit_ui::{
    Button, ButtonTone, ButtonVariant, ContextMenu, ControlSize, ControlState, DropdownMenu, Icon,
    IconName, IconSize, InputAvailability, InputVariant, ListRow, ListRowVariant, MenuEntry,
    MenuItem, RowSelection, TextInput,
};

use rake::gpui::{self, prelude::*, px};
use std::ops::Range;

impl Picker {
    pub(in crate::workspace) fn worktree_trigger(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> gpui::AnyElement {
        let row = rake::view! {
            <ListRow variant={ListRowVariant::Menu} state={if self.data.is_some()&&!self.busy{ControlState::Enabled}else{ControlState::Disabled}}
                leading={Some(rake::view!{<Icon size={IconSize::Supporting} {..Icon::new("worktree-icon",IconName::Branch)}/>}.into_any_element())}
                trailing={Some(rake::view!{<Icon size={IconSize::Supporting} {..Icon::new("worktree-arrow",IconName::ChevronRight)}/>}.into_any_element())}
                accessibility_label={Some("Worktrees".into())} expanded={Some(self.worktrees.submenu)}
                on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.show_worktrees(true,window,cx))))}
                {..ListRow::new("worktrees","Worktrees")}/>
        };

        let trigger = onegit_ui::track_anchor(
            gpui::div()
                .id("worktrees-trigger")
                .h(px(28.))
                .flex_shrink_0()
                .track_focus(&self.worktrees.focus)
                .debug_selector(|| "worktrees-trigger".into())
                .on_hover(cx.listener(|this, hovered: &bool, window, cx| {
                    if *hovered {
                        this.show_worktrees(false, window, cx)
                    } else {
                        this.schedule_worktree_close(cx)
                    }
                }))
                .child(row),
            self.worktrees.anchor.clone(),
        );

        let popup = if self.worktrees.submenu {
            let this = cx.entity();

            onegit_ui::floating_layer(self.worktrees.anchor.clone(), move |bounds, window, cx| {
                this.update(cx, |this, cx| this.worktree_popup(bounds, window, cx))
            })
            .into_any_element()
        } else {
            gpui::Empty.into_any_element()
        };

        let _ = window;

        gpui::div()
            .flex_shrink_0()
            .child(trigger)
            .child(popup)
            .into_any_element()
    }

    fn worktree_popup(
        &mut self,
        bounds: Option<gpui::Bounds<gpui::Pixels>>,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> gpui::AnyElement {
        let Some(bounds) = bounds else {
            return gpui::Empty.into_any_element();
        };

        let width = px(288.).min(window.viewport_size().width - px(16.));

        let visible = self
            .worktrees
            .items
            .iter()
            .enumerate()
            .filter(|(_, t)| !t.prunable)
            .map(|(i, _)| i)
            .collect::<Vec<_>>();

        let height = px((visible.len().max(1) as f32 * 28. + 8.).min(370.))
            .min(window.viewport_size().height - px(16.));

        let left = if bounds.right() + px(8.) + width <= window.viewport_size().width - px(8.) {
            bounds.right() + px(8.)
        } else {
            (bounds.left() - px(8.) - width).max(px(8.))
        };

        let top = bounds
            .top()
            .min(window.viewport_size().height - height - px(8.))
            .max(px(8.));

        let rows=gpui::uniform_list("worktree-list",visible.len(),cx.processor(move|this,range:Range<usize>,_,cx|{
            range.map(|position|{
                let index=visible[position];let item=this.worktrees.items[index].clone();
                let current=this.source.as_ref().is_some_and(|s|s.snapshot.repository.root==item.path);
                let label=item.branch.clone().unwrap_or_else(||"Detached HEAD".into());
                let focus=this.worktrees.rows[index].clone();
                let detail=if current{"Current".into()}else{item.path.file_name().unwrap_or_default().to_string_lossy().into_owned()};

                let row=rake::view!{
                    <ListRow variant={ListRowVariant::Menu} state={if this.busy{ControlState::Disabled}else{ControlState::Enabled}} selection={if this.worktrees.cursor==Some(index){RowSelection::Selected}else{RowSelection::Unselected}}
                        accessibility_label={Some(format!("Open {label} worktree{}",if current{", current worktree"}else{""}).into())}
                        leading={Some(rake::view!{<Icon size={IconSize::Supporting} {..Icon::new("tree",if current{IconName::Check}else{IconName::Branch})}/>}.into_any_element())}
                        trailing={Some(gpui::div().text_size(px(10.)).text_color(onegit_ui::Theme::current().muted_ink).overflow_hidden().whitespace_nowrap().text_ellipsis().child(detail).into_any_element())}
                        on_press={Some(Box::new(cx.listener(move|this,_,window,cx|this.open_worktree(index,window,cx))))}
                        {..ListRow::new(("worktree",index),label)}/>
                };

                let mut menu=DropdownMenu::new(("worktree-actions",index),"Worktree actions");
                let enabled=this.can_edit_worktree(&item);

                menu.entries=[(0,"Move worktree…"),(1,"Remove worktree…")].into_iter().map(|(id,label)|{
                    let mut choice=MenuItem::new(id,label);

                    choice.disabled = !enabled;

                    if id==1{choice.tone=ButtonTone::Danger;}

                    MenuEntry::Item(choice)
                }).collect();
                menu.on_select=Some(Box::new(cx.listener(move|this,id:&gpui::ElementId,window,cx|{
                    let form=if *id==gpui::ElementId::from(0){Form::Move}else{Form::Remove};

                    this.edit_worktree(item.clone(),form,window,cx);
                })));
                let mut context=ContextMenu::new(menu,focus.clone());

                context.children.push(gpui::div().id(("worktree-row",index)).h(px(28.)).track_focus(&focus).debug_selector(move||format!("worktree-row-{index}"))
                    .on_hover(cx.listener(move|this,hovered:&bool,_,cx|{if *hovered&&this.worktrees.cursor!=Some(index){this.worktrees.cursor=Some(index);cx.notify();}})).child(row).into_any_element());

                context.into_any_element()
            }).collect()
        })).track_scroll(&self.worktrees.scroll).h_full().with_sizing_behavior(gpui::ListSizingBehavior::Auto);

        let theme = onegit_ui::Theme::current();

        let popup = gpui::div()
            .id("worktrees-submenu")
            .absolute()
            .left(left)
            .top(top)
            .w(width)
            .h(height)
            .p(px(4.))
            .rounded(px(8.))
            .bg(theme.surface)
            .text_color(theme.ink)
            .occlude()
            .role(gpui::accesskit::Role::Menu)
            .aria_label("Worktrees")
            .debug_selector(|| "worktree-submenu".into())
            .on_hover(cx.listener(|this, hovered: &bool, _, cx| {
                if *hovered {
                    this.worktrees.hover_timer = None;
                } else {
                    this.schedule_worktree_close(cx)
                }
            }))
            .child(rows);

        gpui::div()
            .w(window.viewport_size().width)
            .h(window.viewport_size().height)
            .child(popup)
            .into_any_element()
    }

    pub(in crate::workspace) fn worktree_form(
        &mut self,
        cx: &mut gpui::Context<Self>,
    ) -> gpui::AnyElement {
        let Phase::Worktree(form) = self.phase else {
            return gpui::Empty.into_any_element();
        };

        let disabled = self.busy || self.read.is_some();

        let availability = if disabled {
            ControlState::Disabled
        } else {
            ControlState::Enabled
        };

        let input_availability = if disabled {
            InputAvailability::ReadOnly
        } else {
            InputAvailability::Enabled
        };

        let name = self.worktrees.name.read(cx).text().trim().to_lowercase();

        let suggestions = self
            .data
            .as_ref()
            .map(|data| {
                super::super::model::visible(data, "", true)
                    .into_iter()
                    .filter(|&i| {
                        super::branch_label(&data.branches[i], data)
                            .to_lowercase()
                            .contains(&name)
                    })
                    .map(|i| {
                        let branch = &data.branches[i];
                        let mut item = MenuItem::new(i, super::branch_label(branch, data));

                        item.disabled = branch.checked_out
                            || branch.worktree_path.is_some()
                            || (branch.kind == onegit_git::BranchKind::Remote
                                && super::super::model::remote_target(branch, data).is_err());

                        MenuEntry::Item(item)
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        let destination = if form == Form::Create {
            self.destination(cx)
        } else {
            self.worktrees
                .target
                .as_ref()
                .expect("target form")
                .path
                .clone()
        };

        let target = destination.display().to_string();

        let location = destination
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();

        let confirm_disabled = disabled || self.worktree_request(cx).is_none();

        rake::view!{
            <div class="flex-1 min-h-0 flex flex-col gap-2.5 p-2 overflow-y-scroll" style={|s|s.debug_selector(||"worktree-form".into())}>
                <p class="text-body shrink-0">{match form{Form::Create=>"New worktree",Form::Move=>"Move worktree",Form::Remove=>"Remove worktree?"}}</p>
                if form==Form::Create {
                    <div class="flex flex-col gap-1 shrink-0">
                        <p class="text-small text-muted-ink">{"Branch"}</p>
                        <div class="relative h-[30px]">
                            <TextInput variant={InputVariant::Surface} show_label={false} height={Some(px(30.))} size={ControlSize::Medium} availability={input_availability}
                                placeholder={"Choose or create a branch…".into()} {..TextInput::new("worktree-branch-name",&self.worktrees.name,"Worktree branch name")}/>
                            <div class="absolute right-1 top-0">
                                <DropdownMenu entries={suggestions} size={ControlSize::Small} width={px(264.)} icon={Some(IconName::ChevronDown)} icon_only={true} variant={ButtonVariant::Ghost} state={availability}
                                    on_select={Some(Box::new(cx.listener(|this,id:&gpui::ElementId,_,cx|{
                                        if let Some(data)=&this.data && let Some(branch)=data.branches.iter().enumerate().find(|(i,_)|gpui::ElementId::from(*i)==*id).map(|(_,b)|super::branch_label(b,data)){this.worktrees.name.update(cx,|input,cx|input.set_text(branch,cx));}
                                    })))} {..DropdownMenu::new("worktree-branches","Show branches")}/>
                            </div>
                        </div>
                        <p class="text-small text-muted-ink whitespace-nowrap overflow-hidden" wrap={false} ellipsis={true}>{self.worktree_help(cx)}</p>
                    </div>
                    <div class="flex flex-col gap-1 shrink-0">
                        <p class="text-small text-muted-ink">{"Location"}</p>
                        <button id="worktree-location" disabled={disabled} aria-label={format!("Change worktree location: {target}")} focus={&self.worktrees.location_focus}
                            class="h-[30px] shrink-0 min-w-0 border-1 rounded-control px-2.5 flex flex-row items-center gap-2 text-body"
                            style={|s|s.border_color(onegit_ui::Theme::current().line).opacity(if disabled{0.5}else{1.}).cursor(gpui::CursorStyle::PointingHand)}
                            on:click={cx.listener(|this,_,_,cx|{if !this.busy{this.choose_worktree_location(cx);}})}
                            on:key-down={cx.listener(|this,event:&gpui::KeyDownEvent,window,cx|{
                                if !this.busy&&!event.keystroke.modifiers.modified()&&matches!(event.keystroke.key.as_str(),"enter"|"space"){this.choose_worktree_location(cx);window.prevent_default();cx.stop_propagation();}
                            })}>
                            <Icon size={IconSize::Supporting} {..Icon::new("location-folder",IconName::Folder)}/>
                            <p class="flex-1 min-w-0 font-medium" wrap={false} ellipsis={true}>{location}</p>
                            <p class="text-small text-muted-ink shrink-0">{"Change…"}</p>
                        </button>
                    </div>
                } else {
                    <p class="text-small shrink-0">{target}</p>
                    if form==Form::Move {
                        <p class="text-small text-muted-ink shrink-0">{"New location"}</p>
                        <TextInput variant={InputVariant::Surface} height={Some(px(30.))} show_label={false} size={ControlSize::Medium} availability={input_availability} {..TextInput::new("worktree-new-path",&self.worktrees.path,"New worktree location")}/>
                        <p class="text-small text-muted-ink shrink-0">{"Moves the folder and keeps its branch, files, drafts and selections. Choose a destination that does not exist."}</p>
                    } else {
                        <p class="text-small text-muted-ink shrink-0">{"This deletes the folder, but keeps its branch."}</p>
                        <p class="text-small text-muted-ink shrink-0">{"Its tabs will stay open with their saved drafts and selections."}</p>
                    }
                }
                <div class="flex flex-row items-center justify-between gap-1.5 shrink-0" style={|s|s.debug_selector(||"worktree-actions".into())}>
                    <Button focus={Some(self.cancel_focus.clone())} size={ControlSize::Small} variant={ButtonVariant::Secondary} state={availability}
                        on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.back(window,cx))))} {..Button::new("cancel-worktree","Cancel")}/>
                    <Button size={ControlSize::Small} variant={ButtonVariant::Primary} state={if self.busy{ControlState::Busy}else if confirm_disabled{ControlState::Disabled}else{ControlState::Enabled}}
                        on_press={Some(Box::new(cx.listener(|this,_,window,cx|this.confirm(window,cx))))}
                        {..Button::new("confirm-worktree",match (form,self.busy){(Form::Create,false)=>"Create and open",(Form::Move,false)=>"Move worktree",(Form::Remove,false)=>"Remove worktree",(Form::Create,true)=>"Creating…",(Form::Move,true)=>"Moving…",(Form::Remove,true)=>"Removing…"})}/>
                </div>
            </div>
        }.into_any_element()
    }
}
