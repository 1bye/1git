use crate::{
    ButtonTone, ButtonVariant, ControlSize, ControlState, Icon, IconName, IconSize, Theme,
    focusable,
    motion::{self, Surface},
    overlay,
};

use rake::gpui::{self, accesskit, prelude::*, px};
use std::time::{Duration, Instant};

/// One selectable action or branch choice in a dropdown.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MenuItem {
    /// Stable application identity passed to the selection callback.
    pub id: gpui::ElementId,
    /// Visible, accessible action name.
    pub label: gpui::SharedString,
    /// Optional decorative leading glyph.
    pub icon: Option<IconName>,
    /// Display-only shortcut hint; the owner binds the actual shortcut.
    pub shortcut: Option<gpui::SharedString>,
    /// Unavailable items stay visible and are skipped by navigation.
    pub disabled: bool,
    /// `None` for an action, `Some` for a checked/unchecked mutually exclusive choice.
    pub selected: Option<bool>,
    /// Destructive actions use the theme's danger color.
    pub tone: ButtonTone,
}

impl MenuItem {
    /// Create an enabled action with a stable identity.
    #[must_use]
    pub fn new(id: impl Into<gpui::ElementId>, label: impl Into<gpui::SharedString>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            icon: None,
            shortcut: None,
            disabled: false,
            selected: None,
            tone: ButtonTone::Normal,
        }
    }
}

/// Ordered menu content. Separators have no navigation or activation behavior.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MenuEntry {
    /// An action or mutually exclusive choice.
    Item(MenuItem),
    /// A visual and accessible group divider.
    Separator,
}

impl From<MenuItem> for MenuEntry {
    fn from(item: MenuItem) -> Self {
        Self::Item(item)
    }
}

/// Horizontal placement relative to the trigger; both options remain inside the window.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MenuAlignment {
    /// Align the leading edges.
    #[default]
    Start,
    /// Align the trailing edges, useful for file action buttons.
    End,
}

/// Receives an enabled item's stable identity after the menu closes.
pub type MenuHandler = Box<dyn Fn(&gpui::ElementId, &mut gpui::Window, &mut gpui::App)>;

/// A compact menu button with retained focus, navigation and overlay state.
/// State is scoped to `id` and released on unmount; the owner controls checked choices.
#[derive(IntoElement)]
pub struct DropdownMenu {
    /// Stable identity of this menu button.
    pub id: gpui::ElementId,
    /// Visible trigger label; required accessible name even in icon-only mode.
    pub label: gpui::SharedString,
    /// Optional leading trigger icon; used alone when `icon_only` is true.
    pub icon: Option<IconName>,
    /// Use a square trigger; its label remains accessible.
    pub icon_only: bool,
    /// Trigger prominence.
    pub variant: ButtonVariant,
    /// Trigger size and menu row height.
    pub size: ControlSize,
    /// Disabled and busy triggers cannot open.
    pub state: ControlState,
    /// Ordered entries; item IDs must be unique within this menu.
    pub entries: Vec<MenuEntry>,
    /// Popup alignment against the live trigger geometry.
    pub alignment: MenuAlignment,
    /// Preferred popup width, capped to the window.
    pub width: gpui::Pixels,
    /// One activation per selection; no callback runs for dismissals.
    pub on_select: Option<MenuHandler>,
}

impl DropdownMenu {
    /// Create a medium secondary menu button with an empty entry list.
    #[must_use]
    pub fn new(id: impl Into<gpui::ElementId>, label: impl Into<gpui::SharedString>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            icon: None,
            icon_only: false,
            variant: ButtonVariant::Secondary,
            size: ControlSize::Medium,
            state: ControlState::Enabled,
            entries: Vec::new(),
            alignment: MenuAlignment::Start,
            width: px(240.),
            on_select: None,
        }
    }
}

impl std::fmt::Debug for DropdownMenu {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DropdownMenu")
            .field("id", &self.id)
            .field("label", &self.label)
            .field("entries", &self.entries)
            .field("state", &self.state)
            .finish_non_exhaustive()
    }
}

struct Menu {
    trigger: gpui::FocusHandle,
    focus: gpui::FocusHandle,
    scope: gpui::FocusHandle,
    anchor: overlay::AnchorBounds,
    open: bool,
    active: Option<gpui::ElementId>,
    scroll: gpui::ScrollHandle,
    prefix: String,
    typed_at: Option<Instant>,
    config: DropdownMenu,
    _subscriptions: Vec<gpui::Subscription>,
}

impl Menu {
    fn new(window: &mut gpui::Window, cx: &mut gpui::Context<Self>) -> Self {
        let scope = cx.focus_handle();

        let blur = cx.on_focus_out(&scope, window, |this, _, window, cx| {
            // Opening focuses the popup before its first paint establishes ancestry.
            if !this.focus.contains_focused(window, cx) && !this.trigger.is_focused(window) {
                this.close(false, window, cx);
            }
        });

        let activation = cx.observe_window_activation(window, |this, window, cx| {
            if !window.is_window_active() {
                this.close(false, window, cx);
            }
        });

        Self {
            trigger: cx.focus_handle().tab_stop(true),
            focus: cx.focus_handle(),
            scope,
            anchor: Default::default(),
            open: false,
            active: None,
            scroll: gpui::ScrollHandle::new(),
            prefix: String::new(),
            typed_at: None,
            config: DropdownMenu::new("menu", "Menu"),
            _subscriptions: vec![blur, activation],
        }
    }

    fn enabled(&self) -> impl Iterator<Item = (usize, &MenuItem)> {
        self.config
            .entries
            .iter()
            .enumerate()
            .filter_map(|(i, entry)| match entry {
                MenuEntry::Item(item) if !item.disabled => Some((i, item)),
                _ => None,
            })
    }

    fn set_active(&mut self, id: Option<gpui::ElementId>, cx: &mut gpui::Context<Self>) {
        if self.active != id {
            self.active = id;
            cx.notify();
        }

        if let Some((index, _)) = self
            .enabled()
            .find(|(_, item)| Some(&item.id) == self.active.as_ref())
        {
            self.scroll.scroll_to_item(index);
        }
    }

    fn open(&mut self, last: bool, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        if !self.config.state.is_interactive() {
            return;
        }

        self.open = true;
        self.prefix.clear();
        self.typed_at = None;
        let active = if last {
            self.enabled().last()
        } else {
            self.enabled()
                .find(|(_, item)| item.selected == Some(true))
                .or_else(|| self.enabled().next())
        }
        .map(|(_, item)| item.id.clone());

        self.set_active(active, cx);
        window.focus(&self.focus, cx);
        cx.notify();
    }

    fn close(&mut self, restore: bool, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        if !self.open {
            return;
        }

        self.open = false;
        self.prefix.clear();
        self.typed_at = None;

        if restore && self.focus.contains_focused(window, cx) {
            window.focus(&self.trigger, cx);
        }

        cx.notify();
    }

    fn activate(
        &mut self,
        id: &gpui::ElementId,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if !self.open
            || !self.config.state.is_interactive()
            || !self.enabled().any(|(_, item)| &item.id == id)
        {
            return;
        }

        self.close(true, window, cx);

        if let Some(handler) = &self.config.on_select {
            handler(id, window, cx);
        }
    }

    fn navigate(&mut self, backwards: bool, cx: &mut gpui::Context<Self>) {
        let ids: Vec<_> = self.enabled().map(|(_, item)| item.id.clone()).collect();

        if ids.is_empty() {
            self.set_active(None, cx);

            return;
        }

        let index = ids.iter().position(|id| Some(id) == self.active.as_ref());

        let next = match index {
            Some(i) if backwards => (i + ids.len() - 1) % ids.len(),
            Some(i) => (i + 1) % ids.len(),
            None if backwards => ids.len() - 1,
            None => 0,
        };

        self.set_active(Some(ids[next].clone()), cx);
    }

    fn key(
        &mut self,
        event: &gpui::KeyDownEvent,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if event.keystroke.modifiers.control
            || event.keystroke.modifiers.platform
            || event.keystroke.modifiers.alt
        {
            return;
        }

        let key = event.keystroke.key.as_str();

        if !self.open {
            if matches!(key, "down" | "up") && self.config.state.is_interactive() {
                self.open(key == "up", window, cx);
            } else {
                return;
            }
        } else {
            match key {
                "down" | "up" => self.navigate(key == "up", cx),
                "home" | "end" => {
                    let id = if key == "end" {
                        self.enabled().last()
                    } else {
                        self.enabled().next()
                    }
                    .map(|(_, item)| item.id.clone());

                    self.set_active(id, cx);
                }
                "enter" | "space" => {
                    if let Some(id) = self.active.clone() {
                        self.activate(&id, window, cx);
                    }
                }
                "escape" => self.close(true, window, cx),
                "tab" => {
                    self.close(true, window, cx);

                    if event.keystroke.modifiers.shift {
                        window.focus_prev(cx);
                    } else {
                        window.focus_next(cx);
                    }
                }
                _ => {
                    let text = event.keystroke.key_char.as_deref().unwrap_or(key);

                    if text.chars().count() != 1 || text.chars().any(char::is_control) {
                        return;
                    }

                    let now = cx.background_executor().now();

                    if self
                        .typed_at
                        .is_none_or(|time| now.duration_since(time) > Duration::from_millis(700))
                    {
                        self.prefix.clear();
                    }

                    self.typed_at = Some(now);
                    let text = text.to_lowercase();

                    // Repeated initial letters cycle through matching entries.
                    if self.prefix != text {
                        self.prefix.push_str(&text);
                    }

                    let entries: Vec<_> = self.enabled().map(|(_, item)| item).collect();

                    let start = entries
                        .iter()
                        .position(|item| Some(&item.id) == self.active.as_ref())
                        .map_or(0, |i| (i + 1) % entries.len());

                    let id = (0..entries.len())
                        .map(|i| entries[(start + i) % entries.len()])
                        .find(|item| item.label.to_lowercase().starts_with(&self.prefix))
                        .map(|item| item.id.clone());

                    if id.is_some() {
                        self.set_active(id, cx);
                    }
                }
            }
        }

        window.prevent_default();
        cx.stop_propagation();
    }

    fn trigger(&self, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let theme = Theme::current();
        let enabled = self.config.state.is_interactive();
        let icon_only = self.config.icon_only;

        let icon = if self.config.state == ControlState::Busy {
            Some(IconName::Working)
        } else {
            self.config.icon
        };

        let label = self.config.label.clone();
        let focus = self.trigger.clone();
        let expanded = self.open;
        let size = self.config.size;
        let height = px(size.height());
        let variant = self.config.variant;

        let rest = Surface {
            background: match variant {
                ButtonVariant::Primary => theme.primary,
                ButtonVariant::Secondary => theme.surface_raised,
                ButtonVariant::Ghost => Theme::transparent(),
            },
            ink: if variant == ButtonVariant::Primary {
                theme.on_primary
            } else {
                theme.ink
            },
            opacity: if enabled { 1. } else { 0.5 },
            ..Surface::new(theme.surface_raised)
        };

        let hover = Surface {
            background: if variant == ButtonVariant::Primary {
                theme.primary_hover
            } else {
                theme.hover
            },
            ..rest
        };

        let pressed = Surface {
            background: if variant == ButtonVariant::Primary {
                theme.primary_pressed
            } else {
                theme.pressed
            },
            ..rest
        };

        let content_label = label.clone();

        let content = move || {
            rake::view! {
                <div class="flex flex-row items-center justify-center gap-1.5 min-w-0">
                    if let Some(icon)=icon {<Icon {..Icon::new("icon",icon)}/>}
                    if !icon_only {<p class="text-body font-medium" wrap={false} ellipsis={true}>{content_label.clone()}</p><Icon size={IconSize::Small} {..Icon::new("chevron",IconName::ChevronDown)}/>}
                </div>
            }
        };

        let padding = px(if icon_only {
            0.
        } else {
            match size {
                ControlSize::Small => 8.,
                ControlSize::Medium => 10.,
                ControlSize::Large => 14.,
            }
        });

        let measurement = gpui::div()
            .flex()
            .h(height)
            .px(padding)
            .border_1()
            .when(icon_only, |s| s.w(height))
            .child(content());

        let entity = cx.entity();
        let press = entity.clone();

        motion::resize("trigger-size".into(),measurement,move |dimensions|motion::surface("trigger-surface".into(),rest,hover,pressed,enabled,move |paint| {
            rake::view! {
                <button id="trigger" focus={&focus} disabled={!enabled} aria-label={label} aria-expanded={expanded}
                    class="flex flex-row items-center justify-center shrink-0 min-w-0 max-w-[100%]"
                    style={|s|focusable(s).w(dimensions.width).h(dimensions.height).px(padding).bg(paint.background).text_color(paint.ink).opacity(paint.opacity)
                        .a11y_synthetic_children(|builder|builder.parent_node().set_has_popup(accesskit::HasPopup::Menu))}
                    on:click={move |_,window,cx|{cx.stop_propagation();press.update(cx,|this,cx|{if this.open {this.close(true,window,cx);}else{this.open(false,window,cx);}});}}>
                    {content()}
                </button>
            }
        })).into_any_element()
    }

    fn surface(&self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) -> gpui::AnyElement {
        let theme = Theme::current();
        let height = px(self.config.size.height());
        let outside = cx.entity();
        let row_height = height;

        gpui::div().id("popup").track_focus(&self.focus).role(accesskit::Role::Menu).aria_label(self.config.label.clone())
            .w(self.config.width.max(px(120.))).max_w((window.viewport_size().width-px(16.)).max(px(1.)))
            .max_h((window.viewport_size().height-px(24.)).clamp(px(1.),px(340.))).overflow_y_scroll().track_scroll(&self.scroll)
            .flex().flex_col().p(px(4.)).border_1().border_color(theme.line).rounded(theme.control).shadow_lg().bg(theme.surface_raised).text_color(theme.ink).occlude()
            .on_mouse_down_out(move |event,window,cx|{
                if outside.read(cx).anchor.get().is_some_and(|anchor|anchor.contains(&event.position)){return;}

                outside.update(cx,|this,cx|this.close(true,window,cx));window.prevent_default();cx.stop_propagation();
            })
            .children(self.config.entries.iter().enumerate().map(|(index,entry)|match entry {
                MenuEntry::Separator=>gpui::div().id(("separator",index)).role(accesskit::Role::Splitter).h(px(1.)).my(px(4.)).mx(px(4.)).flex_shrink_0().bg(theme.line).into_any_element(),
                MenuEntry::Item(item)=>{
                    let selected=item.selected;let disabled=item.disabled;let id=item.id.clone();let hover_id=id.clone();let active=self.active.as_ref()==Some(&id);
                    let choose=cx.entity();let hover=cx.entity();let ink=if item.tone==ButtonTone::Danger {theme.danger}else{theme.ink};

                    let row=rake::view! {
                        <div id={id.clone()} role={if selected.is_some(){accesskit::Role::MenuItemRadio}else{accesskit::Role::MenuItem}} aria-label={item.label.clone()}
                            class="flex flex-row items-center gap-2 px-2 shrink-0 rounded-control"
                            style={|s|s.h(row_height).min_w_0().cursor(if disabled {gpui::CursorStyle::Arrow}else{gpui::CursorStyle::PointingHand}).bg(if active {theme.hover}else{Theme::transparent()}).text_color(ink).opacity(if disabled {0.5}else{1.})
                                .when(active,|s|s.aria_active_descendant()).when_some(selected,|s,value|s.aria_toggled(if value{accesskit::Toggled::True}else{accesskit::Toggled::False}))
                                .a11y_synthetic_children(move |builder|{if disabled {let node=builder.parent_node();node.set_disabled();node.clear_actions();}})
                                .on_hover(move |value,_,cx|{if *value && !disabled {hover.update(cx,|this,cx|this.set_active(Some(hover_id.clone()),cx));}})}
                            on:click={move |_,window,cx|{cx.stop_propagation();choose.update(cx,|this,cx|this.activate(&id,window,cx));}}>
                            <div class="flex items-center justify-center shrink-0" style={|s|s.size(px(16.))}>
                                if selected==Some(true) {<Icon size={IconSize::Small} {..Icon::new("check",IconName::Check)}/>}
                                else if let Some(icon)=item.icon {<Icon size={IconSize::Small} {..Icon::new("glyph",icon)}/>}
                            </div>
                            <p class="text-body flex-1 min-w-0" wrap={false} ellipsis={true}>{item.label.clone()}</p>
                            if let Some(shortcut)=&item.shortcut {<p class="text-caption shrink-0" style={|s|s.text_color(theme.muted_ink)}>{shortcut.clone()}</p>}
                        </div>
                    };

                    row.into_any_element()
                }
            })).when(self.config.entries.is_empty(),|s|s.child(gpui::div().p_2().text_color(theme.muted_ink).child("No actions available"))).into_any_element()
    }
}

impl RenderOnce for DropdownMenu {
    fn render(self, window: &mut gpui::Window, cx: &mut gpui::App) -> impl IntoElement {
        let state = window.use_keyed_state(self.id.clone(), cx, Menu::new);

        state.update(cx, |this, cx| {
            this.config = self;
            this.trigger = this
                .trigger
                .clone()
                .tab_stop(this.config.state.is_interactive());

            if !this.config.state.is_interactive() {
                this.close(true, window, cx);
            } else if this.open
                && !this.focus.contains_focused(window, cx)
                && !this.trigger.is_focused(window)
            {
                this.close(false, window, cx);
            }

            if this.open
                && !this
                    .enabled()
                    .any(|(_, item)| Some(&item.id) == this.active.as_ref())
            {
                let active = this.enabled().next().map(|(_, item)| item.id.clone());

                this.active = active;
            }
        });

        state.update(cx, |this, cx| {
            let bounds = this.anchor.clone();
            let root_id = this.config.id.clone();
            let key = cx.entity();
            let overlay_state = cx.entity();
            let scope = this.scope.clone();
            let trigger = overlay::track(this.trigger(cx), bounds.clone());

            gpui::div()
                .id(root_id)
                .flex()
                .track_focus(&scope)
                .capture_key_down(move |event, window, cx| {
                    key.update(cx, |this, cx| this.key(event, window, cx))
                })
                .child(trigger)
                .when(this.open, |s| {
                    s.child(overlay::floating(bounds, move |anchor, window, cx| {
                        overlay_state.update(cx, |this, cx| {
                            let Some(anchor) = anchor else {
                                this.close(true, window, cx);

                                return gpui::Empty.into_any_element();
                            };

                            let (position, corner) = match this.config.alignment {
                                MenuAlignment::Start => {
                                    (anchor.bottom_left(), gpui::Anchor::TopLeft)
                                }
                                MenuAlignment::End => {
                                    (anchor.bottom_right(), gpui::Anchor::TopRight)
                                }
                            };

                            gpui::anchored()
                                .position(position)
                                .anchor(corner)
                                .offset(gpui::point(px(0.), px(4.)))
                                .snap_to_window_with_margin(gpui::Edges::all(px(8.)))
                                .child(this.surface(window, cx))
                                .into_any_element()
                        })
                    }))
                })
        })
    }
}
