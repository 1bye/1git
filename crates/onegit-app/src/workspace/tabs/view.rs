//! Connected tab surfaces and presented hitboxes share the same CE-motion samples.
use super::{
    RepositoryWorkspace, Request, TabStrip, home,
    motion::{self, WIDTH},
};

use onegit_ui::{Appearance, ControlSize, ControlState, IconButton, IconName, Theme, Tooltip};
use rake::gpui::{self, prelude::*, px};
use std::sync::Arc;

impl TabStrip {
    pub(in crate::workspace) fn render(
        &self,
        home: &gpui::Entity<home::Home>,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<RepositoryWorkspace>,
    ) -> gpui::AnyElement {
        let theme = Theme::current();
        let ids: Arc<[u64]> = self.labels.iter().map(|label| label.id).collect();
        let now = cx.background_executor().now();
        let reduced = cx.reduce_motion();
        let mut state = self.presentation.borrow_mut();

        state.prune(&ids);
        let order = state.order(&ids);
        let dragging = state.dragging();
        let front = state.front().or(self.active);

        let active_left = self
            .active
            .and_then(|id| order.iter().position(|item| *item == id))
            .map(|index| {
                if dragging {
                    state.drag_left().unwrap_or(index as f64 * WIDTH)
                } else {
                    index as f64 * WIDTH
                }
            });

        let (selection, mut animating) = state.selection(active_left, now, reduced);
        let mut labels = self.labels.iter().collect::<Vec<_>>();

        labels.sort_by_key(|label| Some(label.id) == front);
        let mut elements = Vec::new();

        for label in labels {
            let id = label.id;
            let active = self.active == Some(id);
            let name = label.name.clone();

            let title: gpui::SharedString = if label.branch.is_empty() {
                name.clone()
            } else {
                format!("{name} / {}", label.branch)
            }
            .into();

            let font = window.text_style().font();
            let mut medium = font.clone();

            medium.weight = gpui::FontWeight::MEDIUM;
            let runs = [
                gpui::TextRun {
                    len: name.len(),
                    font: medium,
                    color: theme.ink,
                    ..Default::default()
                },
                gpui::TextRun {
                    len: title.len() - name.len(),
                    font,
                    color: theme.muted_ink,
                    ..Default::default()
                },
            ];

            let width = f64::from(
                window
                    .text_system()
                    .shape_line(title.clone(), px(11.), &runs, None)
                    .width,
            );

            let focused = window.is_window_active()
                && (label.focus.is_focused(window) || label.close_focus.is_focused(window));

            let target = order.iter().position(|item| *item == id).unwrap_or(0) as f64 * WIDTH;

            let frame = state.frame(
                motion::Target {
                    id,
                    x: target,
                    active,
                    changes: label.changes,
                    focused,
                    text_width: width,
                },
                now,
                reduced,
            );

            animating |= frame.animating;
            let shared = self.presentation.clone();
            let hover_state = shared.clone();
            let down_state = shared.clone();
            let click_state = shared.clone();
            let keys_state = shared.clone();
            let scroll = self.scroll.clone();
            let down_ids = ids.clone();
            let key_ids = ids.clone();
            let focus = label.focus.clone();
            let down_focus = focus.clone();

            let close =
                IconButton::new(("close-tab", id), IconName::Close, format!("Close {title}"));

            let close=rake::view! {
                <IconButton focus={Some(label.close_focus.clone().tab_stop(active))} size={ControlSize::Small} state={if label.busy{ControlState::Disabled}else{ControlState::Enabled}}
                    on_press={Some(Box::new(cx.listener(move|_,_,_,cx|cx.emit(Request::Close(id)))))} {..close}/>
            }.into_any_element();

            let badge = if label.changes > 0 {
                gpui::div()
                    .absolute()
                    .inset_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .opacity((1. - frame.close) * if active { 1. } else { 0.65 })
                    .child(
                        gpui::div()
                            .h(px(18.))
                            .min_w(px(18.))
                            .px(px(4.))
                            .rounded(px(3.))
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_size(px(10.))
                            .font_weight(gpui::FontWeight::SEMIBOLD)
                            .bg(if theme.appearance == Appearance::Dark {
                                gpui::rgb(0x3e372c)
                            } else {
                                gpui::rgb(0xf6f1e8)
                            })
                            .text_color(if theme.appearance == Appearance::Dark {
                                gpui::rgb(0xd2ba95)
                            } else {
                                gpui::rgb(0x80633d)
                            })
                            .child(if label.changes > 99 {
                                "99+".into()
                            } else {
                                label.changes.to_string()
                            }),
                    )
                    .into_any_element()
            } else {
                gpui::Empty.into_any_element()
            };

            let label_track = gpui::div()
                .absolute()
                .left(px(-frame.label))
                .top_0()
                .w(px(width.max(motion::LABEL_WIDTH) as f32))
                .h(px(22.))
                .flex()
                .items_center()
                .whitespace_nowrap()
                .debug_selector(move || format!("workspace-tab-label-{id}"))
                .child(gpui::StyledText::new(title.clone()).with_highlights([
                    (
                        0..name.len(),
                        gpui::HighlightStyle {
                            color: Some(if active { theme.ink } else { theme.muted_ink }),
                            font_weight: Some(gpui::FontWeight::MEDIUM),
                            ..Default::default()
                        },
                    ),
                    (
                        name.len()..title.len(),
                        gpui::HighlightStyle {
                            color: Some(theme.muted_ink),
                            ..Default::default()
                        },
                    ),
                ]));

            let label_view = gpui::div()
                .relative()
                .h(px(22.))
                .flex_1()
                .min_w_0()
                .overflow_hidden()
                .child(label_track);

            let avatar = home
                .read(cx)
                .repository_avatar(label.root.as_deref(), &name, 14.);

            let label_cursor = if frame.dragging {
                gpui::CursorStyle::ClosedHand
            } else {
                gpui::CursorStyle::OpenHand
            };

            let trigger=gpui::div().id(("activate-tab",id)).h(px(24.)).flex_1().min_w_0().flex().items_center().gap(px(8.)).border_1().border_color(gpui::transparent_black()).rounded(px(6.))
                .track_focus(&focus).tab_index(if active{0}else{-1}).focus_visible(|s|s.border_color(theme.focus_ring))
                .role(gpui::accesskit::Role::Tab).aria_label(title.clone()).aria_selected(active)
                .aria_description(format!("{} changed files. Drag to reorder, or use Shift+Left and Shift+Right. Delete closes the tab.",label.changes)).cursor(label_cursor)
                .on_mouse_down(gpui::MouseButton::Left,cx.listener(move|_,event:&gpui::MouseDownEvent,window,cx| {
                    down_state.borrow_mut().begin(id,event.position.x.into(),-f64::from(scroll.offset().x),&down_ids,cx.background_executor().now());
                    window.focus(&down_focus,cx);cx.notify();
                }))
                .on_click(cx.listener(move|_,_,_,cx| {
                    if !click_state.borrow().suppress_click{cx.emit(Request::Activate(id));}
                }))
                .on_key_down(cx.listener(move|_,event:&gpui::KeyDownEvent,window,cx| {
                    let key=event.keystroke.key.as_str();

                    if key=="escape" {keys_state.borrow_mut().cancel();window.prevent_default();cx.stop_propagation();cx.notify();

                        return;}

                    if event.keystroke.modifiers.secondary()||event.keystroke.modifiers.alt{return;}

                    let index=key_ids.iter().position(|item|*item==id).unwrap_or(0);
                    let next=match key{"left"=>Some(index.saturating_sub(1)),"right"=>Some((index+1).min(key_ids.len()-1)),"home"=>Some(0),"end"=>Some(key_ids.len()-1),"enter"|"space"=>Some(index),_=>None};

                    if let Some(next)=next {
                        keys_state.borrow_mut().cancel();window.prevent_default();cx.stop_propagation();

                        if event.keystroke.modifiers.shift&&matches!(key,"left"|"right"){cx.emit(Request::Move(id,key_ids[next]));}
                        else{cx.emit(Request::Activate(key_ids[next]));}
                    }else if !event.is_held&&matches!(key,"backspace"|"delete") {cx.emit(Request::Close(id));cx.stop_propagation();}
                }))
                .child(avatar).child(label_view);

            let hover = gpui::div()
                .absolute()
                .left(px(2.))
                .top_0()
                .w(px(206.))
                .h(px(32.))
                .rounded(px(10.))
                .bg(theme.hairline)
                .opacity(frame.hover);

            let content = gpui::div()
                .absolute()
                .left(px(2.))
                .top(px(4.))
                .w(px(206.))
                .h(px(24.))
                .pl(px(11.))
                .pr(px(4.))
                .flex()
                .items_center()
                .gap(px(8.))
                .child(trigger)
                .child(
                    gpui::div()
                        .relative()
                        .size(px(24.))
                        .flex_shrink_0()
                        .child(badge)
                        .child(gpui::div().opacity(frame.close).child(close)),
                );

            elements.push(
                gpui::div()
                    .id(("repository-tab", id))
                    .absolute()
                    .left(px(frame.x + 10.))
                    .top_0()
                    .w(px(WIDTH as f32))
                    .h(px(motion::HEIGHT))
                    .text_size(px(11.))
                    .debug_selector(move || format!("workspace-tab-{id}"))
                    .on_hover(cx.listener(move |_, hovered: &bool, _, cx| {
                        let mut state = hover_state.borrow_mut();

                        if *hovered {
                            state.hovered = Some(id);
                        } else if state.hovered == Some(id) {
                            state.hovered = None;
                        }

                        cx.notify();
                    }))
                    .on_mouse_down(
                        gpui::MouseButton::Middle,
                        cx.listener(move |_, _, _, cx| cx.emit(Request::Close(id))),
                    )
                    .child(hover)
                    .child(content),
            );
        }

        drop(state);

        if animating {
            window.request_animation_frame();
        }

        let mut rail = gpui::div()
            .relative()
            .flex_shrink_0()
            .w(px(self.labels.len() as f32 * WIDTH as f32 + 20.))
            .h(px(motion::HEIGHT));

        if let Some(left) = selection {
            rail = rail.child(
                gpui::div()
                    .absolute()
                    .left(px(left + 10.))
                    .top_0()
                    .w(px(WIDTH as f32))
                    .h(px(motion::HEIGHT))
                    .debug_selector(|| "workspace-tab-selection".into())
                    .child(super::super::chrome::tab_surface()),
            );
        }

        rail = rail.children(elements);
        let scroll = self.scroll.clone();

        let strip = gpui::div()
            .id("repository-tabs")
            .role(gpui::accesskit::Role::TabList)
            .aria_label("Repositories")
            .min_w_0()
            .h(px(motion::HEIGHT))
            .w(px(self.labels.len() as f32 * WIDTH as f32 + 20.))
            .overflow_x_scroll()
            .track_scroll(&scroll)
            .child(rail);

        let bar=rake::view! {
            <div class="h-[42px] shrink-0 flex flex-row items-end pr-1.5" style={|s|s.pl(px(if cfg!(target_os="macos"){86.}else{12.})).debug_selector(||"workspace-titlebar".into())}>
                <div class="relative w-[24px] h-[32px] mb-1 shrink-0" style={|s|s.debug_selector(||"workspace-home".into())}><div class="absolute top-0 left-0 size-[32px] rounded-[6px]" style={|s|s.when(self.active.is_none(),|s|s.bg(theme.hairline))}>
                    <Tooltip {..Tooltip::new("home-tip","Home")}><IconButton size={ControlSize::Rail} on_press={Some(Box::new(cx.listener(|_,_,_,cx|cx.emit(Request::Home))))} {..IconButton::new("home",IconName::Home,"Home")}/></Tooltip>
                </div></div>
                {strip}
                <div class="flex-1 h-full min-w-[16px]" style={|s|s.debug_selector(||"workspace-window-drag".into()).on_mouse_down(gpui::MouseButton::Left,|event,window,_|{if event.click_count==2{window.titlebar_double_click();}else{window.start_window_move();}})}/>
                <div class="mb-2"><Tooltip {..Tooltip::new("open-tip","Open another repository…")}><IconButton size={ControlSize::Small} on_press={Some(Box::new(cx.listener(|_,_,_,cx|cx.emit(Request::Pick))))} {..IconButton::new("open-another",IconName::Plus,"Open another repository…")}/></Tooltip></div>
            </div>
        }.into_any_element();

        motion::Capture {
            child: bar,
            presentation: self.presentation.clone(),
            owner: cx.weak_entity(),
            scroll: self.scroll.clone(),
        }
        .into_any_element()
    }
}
