//! Controlled tabs with retained focus, automatic keyboard activation and caller-owned panels.
use crate::motion::{self, Surface};
use crate::{ControlSize, Icon, IconName, IconSize, Theme, focusable};
use rake::gpui::{self, accesskit, prelude::*, px};
use std::rc::Rc;

/// A tab selection or close request; the owner updates the selected ID and item list.
pub type TabHandler = Box<dyn Fn(&gpui::ElementId, &mut gpui::Window, &mut gpui::App)>;

/// Shared tab-strip presentations, independent of tab behavior.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TabVariant {
    /// A quiet strip with an accent underline on the selected tab.
    #[default]
    Underline,
    /// Compact filled choices on an inset neutral track.
    Segmented,
}

/// One stable, labeled tab. IDs must be unique within a [`Tabs`] component.
#[derive(Clone, Debug)]
pub struct TabItem {
    /// Stable identity used for selection, focus and callbacks.
    pub id: gpui::ElementId,
    /// Visible and accessible name.
    pub label: gpui::SharedString,
    /// Optional leading glyph.
    pub icon: Option<IconName>,
    /// Unavailable tabs skip pointer and keyboard activation.
    pub disabled: bool,
    /// Show a close action and accept Delete while this tab is focused.
    pub closable: bool,
}

impl TabItem {
    /// Create an enabled, nonclosable tab.
    #[must_use]
    pub fn new(id: impl Into<gpui::ElementId>, label: impl Into<gpui::SharedString>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            icon: None,
            disabled: false,
            closable: false,
        }
    }
}

/// Reusable tab list and one active panel. Application state and inactive panel entities stay with the owner.
#[derive(IntoElement)]
pub struct Tabs {
    /// Stable identity retaining focus and horizontal scroll across rerenders.
    pub id: gpui::ElementId,
    /// Accessible name of the tab list.
    pub label: gpui::SharedString,
    /// Ordered tabs, with unique IDs.
    pub items: Vec<TabItem>,
    /// Controlled selected ID. Missing/disabled IDs show no selected panel.
    pub selected: Option<gpui::ElementId>,
    /// Underline or segmented appearance.
    pub variant: TabVariant,
    /// Shared 24/28/34-pixel tab geometry.
    pub size: ControlSize,
    /// Active panel contents, automatically supplied by paired markup tags.
    pub children: Vec<gpui::AnyElement>,
    /// Optional content when no enabled selected tab exists, including an empty list.
    pub empty: Option<gpui::AnyElement>,
    /// Called once when a different enabled tab is activated.
    pub on_select: Option<TabHandler>,
    /// Close request only; the owner removes the item and chooses its next selection.
    pub on_close: Option<TabHandler>,
}

impl Tabs {
    /// Create underline tabs, initially selecting the first enabled item.
    #[must_use]
    pub fn new(
        id: impl Into<gpui::ElementId>,
        label: impl Into<gpui::SharedString>,
        items: Vec<TabItem>,
    ) -> Self {
        let selected = items
            .iter()
            .find(|item| !item.disabled)
            .map(|item| item.id.clone());

        Self {
            id: id.into(),
            label: label.into(),
            items,
            selected,
            variant: TabVariant::Underline,
            size: ControlSize::Medium,
            children: Vec::new(),
            empty: None,
            on_select: None,
            on_close: None,
        }
    }
}

impl std::fmt::Debug for Tabs {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Tabs")
            .field("id", &self.id)
            .field("items", &self.items)
            .field("selected", &self.selected)
            .field("variant", &self.variant)
            .finish_non_exhaustive()
    }
}

struct ItemFocus {
    item: TabItem,
    focus: gpui::FocusHandle,
}

struct TabFocus {
    items: Vec<ItemFocus>,
    scope: gpui::FocusHandle,
    panel: gpui::FocusHandle,
    scroll: gpui::ScrollHandle,
    visible: Option<(gpui::ElementId, usize)>,
}

enum Command {
    Select(gpui::ElementId),
    Close(gpui::ElementId),
}

impl TabFocus {
    fn reconcile(
        &mut self,
        items: &[TabItem],
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        for (index, item) in items.iter().enumerate() {
            assert!(
                !items[..index].iter().any(|old| old.id == item.id),
                "tab IDs must be unique: {:?}",
                item.id
            );
        }

        let old_index = self
            .items
            .iter()
            .position(|entry| entry.focus.is_focused(window));

        let mut old = std::mem::take(&mut self.items);

        self.items = items
            .iter()
            .map(|item| {
                let focus = old
                    .iter()
                    .position(|entry| entry.item.id == item.id)
                    .map(|index| old.remove(index).focus)
                    .unwrap_or_else(|| cx.focus_handle());

                ItemFocus {
                    item: item.clone(),
                    focus,
                }
            })
            .collect();

        if let Some(index) = old_index
            && !self
                .items
                .iter()
                .any(|entry| !entry.item.disabled && entry.focus.is_focused(window))
        {
            if let Some(next) = self
                .items
                .iter()
                .skip(index)
                .find(|entry| !entry.item.disabled)
                .or_else(|| self.items.iter().rev().find(|entry| !entry.item.disabled))
            {
                window.focus(&next.focus, cx);
            } else {
                window.focus(&self.scope, cx);
            }
        }
    }

    fn key(
        &mut self,
        event: &gpui::KeyDownEvent,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> Option<Command> {
        if event.keystroke.modifiers.modified() {
            return None;
        }

        let enabled: Vec<_> = self
            .items
            .iter()
            .enumerate()
            .filter(|(_, entry)| !entry.item.disabled)
            .collect();

        let position = enabled
            .iter()
            .position(|(_, entry)| entry.focus.is_focused(window))?;

        let current = enabled[position].1;

        let destination = match event.keystroke.key.as_str() {
            "left" => Some((position + enabled.len() - 1) % enabled.len()),
            "right" => Some((position + 1) % enabled.len()),
            "home" => Some(0),
            "end" => Some(enabled.len() - 1),
            "enter" | "space" if !event.is_held => Some(position),
            "delete" if current.item.closable && !event.is_held => {
                window.prevent_default();
                cx.stop_propagation();

                return Some(Command::Close(current.item.id.clone()));
            }
            _ => None,
        }?;

        let (index, next) = enabled[destination];

        window.focus(&next.focus, cx);
        self.scroll.scroll_to_item(index);
        window.prevent_default();
        cx.stop_propagation();
        cx.notify();

        Some(Command::Select(next.item.id.clone()))
    }
}

impl RenderOnce for Tabs {
    fn render(self, window: &mut gpui::Window, cx: &mut gpui::App) -> impl IntoElement {
        let state = window.use_keyed_state(self.id.clone(), cx, |_, cx| TabFocus {
            items: Vec::new(),
            scope: cx.focus_handle(),
            panel: cx.focus_handle(),
            scroll: gpui::ScrollHandle::new(),
            visible: None,
        });

        state.update(cx, |state, cx| {
            state.reconcile(&self.items, window, cx);
            let visible = self
                .items
                .iter()
                .position(|item| !item.disabled && Some(&item.id) == self.selected.as_ref())
                .map(|index| (self.items[index].id.clone(), index));

            if visible != state.visible {
                if let Some((_, index)) = &visible {
                    state.scroll.scroll_to_item(*index);
                }

                state.visible = visible;
            }
        });
        let theme = Theme::current();

        let selected = self
            .items
            .iter()
            .find(|item| !item.disabled && Some(&item.id) == self.selected.as_ref());

        let roving = selected
            .or_else(|| self.items.iter().find(|item| !item.disabled))
            .map(|item| item.id.clone());

        let panel_label = selected.map(|item| item.label.clone());
        let select = self.on_select.map(Rc::new);
        let close = self.on_close.map(Rc::new);
        let selected_id = self.selected;
        let keyboard = state.clone();
        let key_select = select.clone();
        let key_close = close.clone();
        let key_selected = selected_id.clone();
        let segmented = self.variant == TabVariant::Segmented;

        let strip = gpui::div().id("strip").role(accesskit::Role::TabList).aria_label(self.label)
            .track_focus(&state.read(cx).scope).tab_stop(false).w_full().min_w_0().flex().flex_row().flex_shrink_0()
            .bg(if segmented { theme.surface_sunken } else { theme.surface })
            .when(segmented, |s| s.p(px(3.)).gap(px(2.)).rounded(theme.control))
            .when(!segmented, |s| s.border_b_1().border_color(theme.line))
            .overflow_x_scroll().track_scroll(&state.read(cx).scroll)
            .on_mouse_down(gpui::MouseButton::Left, |_, window, _| window.prevent_default())
            .on_key_down(move |event, window, cx| {
                let command = keyboard.update(cx, |state, cx| state.key(event, window, cx));

                match command {
                    Some(Command::Select(id)) if Some(&id) != key_selected.as_ref() => { if let Some(handler) = &key_select { handler(&id, window, cx); } }
                    Some(Command::Close(id)) => { if let Some(handler) = &key_close { handler(&id, window, cx); } }
                    _ => {}
                }
            })
            .children(self.items.into_iter().map(|item| {
                let theme = theme.clone();
                let focus = state.read(cx).items.iter().find(|entry| entry.item.id == item.id).expect("tab focus was reconciled").focus.clone();
                let active = selected_id.as_ref() == Some(&item.id) && !item.disabled;
                let enabled = !item.disabled;
                let stop = roving.as_ref() == Some(&item.id);
                let focus = focus.tab_stop(stop);

                let rest = Surface { ink: if active {theme.ink} else {theme.muted_ink},
                    ..Surface::new(if segmented && active {theme.surface_raised} else {Theme::transparent()}) };

                let select = select.clone(); let close = close.clone();
                let select_id = item.id.clone(); let close_id = item.id.clone();
                let height = self.size.height();

                motion::surface(item.id.clone(), rest, Surface { background: theme.hover, ..rest }, Surface { background: theme.pressed, ..rest }, enabled, move |paint| {
                    let tab = rake::view! {
                        <div id="tab" role={accesskit::Role::Tab} aria-label={item.label.clone()}
                            class="flex flex-row items-center gap-1.5 px-2 min-w-0 border-1 rounded-control"
                            style={|s| focusable(s).h(px(height)).max_w(px(240.)).text_color(paint.ink).bg(paint.background).aria_selected(active)
                                .opacity(if enabled {1.} else {0.5}).when(enabled, |s| s.track_focus(&focus).tab_index(0).tab_stop(stop).cursor(gpui::CursorStyle::PointingHand))
                                .a11y_synthetic_children(move |builder| {if !enabled {let node = builder.parent_node(); node.set_disabled(); node.clear_actions();}})
                                .debug_selector(|| format!("tab-{select_id}"))}
                            on:click={move |_, window, cx| {cx.stop_propagation(); if enabled && !active && let Some(handler) = &select {handler(&select_id, window, cx);}}}>
                            if let Some(icon) = item.icon {<Icon size={IconSize::Small} {..Icon::new("icon", icon)}/>}
                            <p class="text-body min-w-0" wrap={false} ellipsis={true}>{item.label.clone()}</p>
                        </div>
                    };

                    let dismiss = enabled && item.closable;

                    let row = rake::view! {
                        <div id="item" class="flex flex-col shrink-0" style={|s| s.bg(paint.background)}>
                            <div class="flex flex-row items-center">
                                {tab}
                                if item.closable {
                                    <div id="close" role={accesskit::Role::Button} aria-label={format!("Close {}", item.label)}
                                        class="flex items-center justify-center rounded-control mr-1"
                                        style={|s| s.debug_selector(|| format!("tab-close-{close_id}")).size(px(24.)).text_color(theme.muted_ink).opacity(if enabled {1.} else {0.5})
                                            .when(dismiss, |s| s.cursor(gpui::CursorStyle::PointingHand).hover(|s| s.bg(theme.hover)))
                                            .a11y_synthetic_children(move |builder| {if !dismiss {let node = builder.parent_node(); node.set_disabled(); node.clear_actions();}})}
                                        on:click={move |_, window, cx| {cx.stop_propagation(); if dismiss && let Some(handler) = &close {handler(&close_id, window, cx);}}}>
                                        <Icon size={IconSize::Small} {..Icon::new("close-glyph", IconName::Close)}/>
                                    </div>
                                }
                            </div>
                            if !segmented {<div class="h-[2px]" style={|s| s.bg(if active {theme.accent} else {Theme::transparent()})}/>}
                        </div>
                    };

                    row
                }).into_any_element()
            }));

        let panel_focus = state.read(cx).panel.clone().tab_stop(panel_label.is_some());

        let panel = gpui::div()
            .id("panel")
            .role(if panel_label.is_some() {
                accesskit::Role::TabPanel
            } else {
                accesskit::Role::Group
            })
            .aria_label(panel_label.clone().unwrap_or_default())
            .flex_1()
            .min_h_0()
            .min_w_0()
            .overflow_hidden()
            .when(panel_label.is_some(), |s| {
                s.track_focus(&panel_focus)
                    .tab_index(0)
                    .children(self.children)
            })
            .when(panel_label.is_none(), |s| s.children(self.empty));

        gpui::div()
            .id(self.id)
            .size_full()
            .min_w_0()
            .min_h_0()
            .flex()
            .flex_col()
            .child(strip)
            .child(panel)
    }
}
