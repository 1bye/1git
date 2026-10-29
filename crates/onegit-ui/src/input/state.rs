use super::{
    Config, InputAvailability, InputValidation, Kind,
    buffer::Buffer,
    element::{EditorText, Layout},
    same_theme,
};

use crate::{Icon, IconButton, IconName, IconSize, Theme};
use rake::gpui::{self, accesskit, prelude::*, px};
use std::{ops::Range, rc::Rc, time::Duration};

/// Events emitted by a retained input entity. Subscribe once from the owning view.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InputEvent {
    /// The value changed; read [`InputState::text`] for its current value.
    Changed,
    /// Enter in a single-line field, or the platform submit shortcut in a text area.
    Submitted,
}

/// Text, selection, composition, undo history and native focus for one logical field.
///
/// Retain this entity outside render and mount it in only one field at a time.
/// `TextInput` and `SearchField` normalize pasted line breaks to spaces. `TextArea`
/// preserves line breaks. Application validation is separate from editing state.
pub struct InputState {
    pub(super) buffer: Buffer,
    pub(super) focus: gpui::FocusHandle,
    pub(super) config: Config,
    pub(super) theme: Rc<Theme>,
    focused: bool,
    configured: bool,
    window_active: bool,
    pub(super) layout: Option<Rc<Layout>>,
    pub(super) scroll: gpui::Point<gpui::Pixels>,
    pub(super) reveal_caret: bool,
    pub(super) caret_visible: bool,
    dragging: bool,
    desired_x: Option<gpui::Pixels>,
    blink: gpui::Task<()>,
    _subscriptions: Vec<gpui::Subscription>,
}

impl std::fmt::Debug for InputState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("InputState")
            .field("selection", &self.buffer.selection())
            .field("availability", &self.config.availability)
            .finish_non_exhaustive()
    }
}

impl gpui::EventEmitter<InputEvent> for InputState {}

impl gpui::Focusable for InputState {
    fn focus_handle(&self, _: &gpui::App) -> gpui::FocusHandle {
        self.focus.clone()
    }
}

impl InputState {
    /// Create retained editing state with initial Unicode text and native focus ownership.
    ///
    /// # Panics
    /// Panics if the UI thread has no installed [`Theme`].
    pub fn new(
        value: impl Into<String>,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> Self {
        let focus = cx.focus_handle().tab_stop(true);

        let focused = cx.on_focus(&focus, window, |this, window, cx| {
            this.window_active = window.is_window_active();
            this.focused = true;
            this.reveal_caret = true;
            this.reset_blink(cx);
            cx.notify();
        });

        let blurred = cx.on_blur(&focus, window, |this, _, cx| {
            this.focused = false;
            this.blink = gpui::Task::ready(());
            this.caret_visible = false;
            this.dragging = false;
            this.buffer.unmark();
            cx.notify();
        });

        let activation = cx.observe_window_activation(window, |this, window, cx| {
            this.window_active = window.is_window_active();

            if this.focus.is_focused(window) {
                if this.window_active {
                    this.focused = true;
                    this.reset_blink(cx);
                } else {
                    this.blink = gpui::Task::ready(());
                    this.caret_visible = false;
                    this.dragging = false;
                }

                cx.notify();
            }
        });

        Self {
            buffer: Buffer::new(value.into()),
            focus,
            config: Config::default(),
            theme: Theme::current(),
            layout: None,
            scroll: gpui::point(px(0.), px(0.)),
            focused: false,
            configured: false,
            window_active: window.is_window_active(),
            reveal_caret: true,
            caret_visible: false,
            dragging: false,
            desired_x: None,
            blink: gpui::Task::ready(()),
            _subscriptions: vec![focused, blurred, activation],
        }
    }

    /// Current value as UTF-8 text, including active native composition.
    #[must_use]
    pub fn text(&self) -> &str {
        &self.buffer.text
    }

    /// Selected UTF-8 byte range. Native IME offsets are translated internally.
    #[must_use]
    pub fn selection(&self) -> Range<usize> {
        self.buffer.selection()
    }

    /// Replace a changed application value, reset history and place the caret at the end.
    /// An unchanged value preserves selection and history.
    pub fn set_text(&mut self, value: impl Into<String>, cx: &mut gpui::Context<Self>) {
        let value = self.normalize(&value.into());

        if self.buffer.text == value {
            return;
        }

        self.buffer = Buffer::new(value);
        self.edited(cx);
    }

    /// Select a UTF-8 byte range; offsets are clamped to valid character boundaries.
    pub fn select(&mut self, range: Range<usize>, cx: &mut gpui::Context<Self>) {
        self.buffer.unmark();
        self.buffer.select(range);
        self.moved(cx);
    }

    /// Clear the field as an undoable user edit. Read-only and disabled fields ignore it.
    pub fn clear(&mut self, cx: &mut gpui::Context<Self>) {
        if !self.editable() {
            return;
        }

        self.replace(0..self.buffer.text.len(), "", false, cx);
    }

    pub(super) fn editable(&self) -> bool {
        self.config.availability == InputAvailability::Enabled
    }

    pub(super) fn normalize(&self, text: &str) -> String {
        let text = text.replace("\r\n", "\n").replace('\r', "\n");

        if !self.configured || self.config.kind == Kind::Multiline {
            text
        } else {
            text.replace('\n', " ")
        }
    }

    pub(super) fn configure(
        &mut self,
        config: Config,
        theme: Rc<Theme>,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.configured && self.config == config && same_theme(&self.theme, &theme) {
            return;
        }

        self.config = config;
        self.configured = true;
        self.theme = theme;
        self.layout = None;
        self.focus = self
            .focus
            .clone()
            .tab_stop(self.config.availability != InputAvailability::Disabled);

        if self.config.availability != InputAvailability::Enabled {
            self.buffer.unmark();
        }

        if self.config.availability == InputAvailability::Disabled {
            self.blink = gpui::Task::ready(());
            self.caret_visible = false;
            self.dragging = false;
            self.buffer.unmark();
        }

        let normalized = self.normalize(&self.buffer.text);

        if normalized != self.buffer.text {
            self.buffer = Buffer::new(normalized);
            cx.emit(InputEvent::Changed);
        }

        self.reveal_caret = true;
        cx.notify();
    }

    pub(super) fn edited(&mut self, cx: &mut gpui::Context<Self>) {
        // Keep the last geometry available for IME queries before the next paint.
        // The layout cache compares its text and style before it can be reused.
        self.desired_x = None;
        self.moved(cx);
        cx.emit(InputEvent::Changed);
    }

    pub(super) fn moved(&mut self, cx: &mut gpui::Context<Self>) {
        self.reveal_caret = true;
        self.reset_blink(cx);
        cx.notify();
    }

    fn reset_blink(&mut self, cx: &mut gpui::Context<Self>) {
        if !self.focused
            || !self.window_active
            || self.config.availability == InputAvailability::Disabled
        {
            return;
        }

        self.caret_visible = true;
        self.blink = cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(Duration::from_millis(500))
                    .await;

                if this
                    .update(cx, |this, cx| {
                        this.caret_visible = !this.caret_visible;
                        cx.notify();
                    })
                    .is_err()
                {
                    break;
                }
            }
        });
    }

    pub(super) fn replace(
        &mut self,
        range: Range<usize>,
        text: &str,
        composing: bool,
        cx: &mut gpui::Context<Self>,
    ) {
        if !self.editable() {
            return;
        }

        let before = self.buffer.text.clone();
        let text = self.normalize(text);

        self.buffer.replace(range, &text, composing);

        if before != self.buffer.text {
            self.edited(cx);
        } else {
            self.moved(cx);
        }
    }

    fn key_down(
        &mut self,
        event: &gpui::KeyDownEvent,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.config.availability == InputAvailability::Disabled {
            return;
        }

        let key = event.keystroke.key.as_str();
        let mods = event.keystroke.modifiers;

        let primary = if cfg!(target_os = "macos") {
            mods.platform
        } else {
            mods.control
        };

        // Leave composition navigation/acceptance to the platform IME.
        if self.buffer.marked.is_some() && !primary {
            return;
        }

        let before = self.buffer.text.clone();
        let extend = mods.shift;

        let word = if cfg!(target_os = "macos") {
            mods.alt
        } else {
            mods.control
        };

        let selection = self.buffer.selection();
        let head = self.buffer.head;

        let handled = match key {
            "a" if primary => {
                self.buffer.select(0..self.buffer.text.len());

                true
            }
            "c" | "x" if primary => {
                if !selection.is_empty() {
                    cx.write_to_clipboard(gpui::ClipboardItem::new_string(
                        self.buffer.text[selection.clone()].to_owned(),
                    ));

                    if key == "x" && self.editable() {
                        self.buffer.replace(selection, "", false);
                    }
                }

                true
            }
            "v" if primary => {
                if self.editable()
                    && let Some(text) = cx.read_from_clipboard().and_then(|v| v.text())
                {
                    let text = self.normalize(&text);

                    self.buffer.replace(selection, &text, false);
                }

                true
            }
            "z" if primary => {
                if self.editable() {
                    if extend {
                        self.buffer.redo();
                    } else {
                        self.buffer.undo();
                    }
                }

                true
            }
            "y" if primary && !cfg!(target_os = "macos") => {
                if self.editable() {
                    self.buffer.redo();
                }

                true
            }
            "left" | "right" => {
                let left = key == "left";

                let target = if !extend && !selection.is_empty() {
                    if left { selection.start } else { selection.end }
                } else if primary && cfg!(target_os = "macos") {
                    self.line_edge(head, !left)
                } else if word {
                    if left {
                        self.buffer.previous_word(head)
                    } else {
                        self.buffer.next_word(head)
                    }
                } else if left {
                    self.buffer.previous(head)
                } else {
                    self.buffer.next(head)
                };

                self.buffer.move_to(target, extend);
                self.desired_x = None;

                true
            }
            "home" | "end" => {
                let end = key == "end";

                let target = if primary {
                    if end { self.buffer.text.len() } else { 0 }
                } else {
                    self.line_edge(head, end)
                };

                self.buffer.move_to(target, extend);
                self.desired_x = None;

                true
            }
            "up" | "down" if self.config.kind == Kind::Multiline => {
                if primary {
                    self.buffer.move_to(
                        if key == "up" {
                            0
                        } else {
                            self.buffer.text.len()
                        },
                        extend,
                    );
                } else if let Some(layout) = &self.layout {
                    let mut point = layout.position(head);
                    let x = *self.desired_x.get_or_insert(point.x);

                    point.x = x;
                    point.y += layout.line_height * if key == "up" { -1. } else { 1. };
                    let target = layout.index_at(point);

                    self.buffer.move_to(target, extend);
                }

                true
            }
            "backspace" | "delete" => {
                if self.editable() {
                    let range = if !selection.is_empty() {
                        selection
                    } else if key == "backspace" {
                        let start = if word {
                            self.buffer.previous_word(head)
                        } else if primary {
                            self.line_edge(head, false)
                        } else {
                            self.buffer.previous(head)
                        };

                        start..head
                    } else {
                        head..if word {
                            self.buffer.next_word(head)
                        } else {
                            self.buffer.next(head)
                        }
                    };

                    self.buffer.replace(range, "", false);
                }

                true
            }
            "enter" => {
                if self.config.kind == Kind::Multiline && !primary {
                    if self.editable() {
                        self.buffer.replace(selection, "\n", false);
                    }
                } else if self.editable() {
                    cx.emit(InputEvent::Submitted);
                }

                true
            }
            "escape"
                if self.config.kind == Kind::Search
                    && self.editable()
                    && !self.buffer.text.is_empty() =>
            {
                if self.editable() {
                    self.buffer.replace(0..self.buffer.text.len(), "", false);
                }

                true
            }
            _ => false,
        };

        if handled {
            window.prevent_default();
            cx.stop_propagation();

            if before != self.buffer.text {
                self.edited(cx);
            } else {
                self.moved(cx);
            }
        }
    }

    fn line_edge(&self, head: usize, end: bool) -> usize {
        if self.config.kind != Kind::Multiline {
            return if end { self.buffer.text.len() } else { 0 };
        }

        if end {
            self.buffer.text[head..]
                .find('\n')
                .map_or(self.buffer.text.len(), |i| head + i)
        } else {
            self.buffer.text[..head].rfind('\n').map_or(0, |i| i + 1)
        }
    }

    fn mouse_down(
        &mut self,
        event: &gpui::MouseDownEvent,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.config.availability == InputAvailability::Disabled {
            return;
        }

        window.focus(&self.focus, cx);
        cx.stop_propagation();

        let Some(layout) = &self.layout else {
            return;
        };

        let index = layout.index_at(event.position - layout.bounds.origin + self.scroll);

        if event.click_count >= 3 {
            let start = self.buffer.text[..index].rfind('\n').map_or(0, |i| i + 1);

            let end = self.buffer.text[index..]
                .find('\n')
                .map_or(self.buffer.text.len(), |i| index + i + 1);

            self.buffer.select(start..end);
        } else if event.click_count == 2 {
            use unicode_segmentation::UnicodeSegmentation;
            let word_index = if index == self.buffer.text.len() && index > 0 {
                self.buffer.previous(index)
            } else {
                index
            };

            let word = self
                .buffer
                .text
                .split_word_bound_indices()
                .find(|(i, w)| word_index >= *i && word_index < i + w.len())
                .map(|(i, w)| i..i + w.len())
                .unwrap_or(index..index);

            self.buffer.select(word);
        } else {
            self.buffer.move_to(index, event.modifiers.shift);
        }

        self.dragging = true;
        self.desired_x = None;
        self.moved(cx);
    }

    pub(super) fn mouse_move(
        &mut self,
        event: &gpui::MouseMoveEvent,
        _: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.dragging && event.pressed_button == Some(gpui::MouseButton::Left) {
            if let Some(layout) = &self.layout {
                let index = layout.index_at(event.position - layout.bounds.origin + self.scroll);

                self.buffer.move_to(index, true);
                self.moved(cx);
            }
        } else {
            self.dragging = false;
        }
    }
}

impl Render for InputState {
    fn render(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        let theme = self.theme.clone();
        let focused = self.focus.is_focused(window);
        let disabled = self.config.availability == InputAvailability::Disabled;
        let readonly = self.config.availability == InputAvailability::ReadOnly;
        let invalid = matches!(self.config.validation, InputValidation::Invalid(_));
        let multiline = self.config.kind == Kind::Multiline;
        let search = self.config.kind == Kind::Search;

        let description = match &self.config.validation {
            InputValidation::Invalid(message) => format!("{} {message}", self.config.description),
            _ => self.config.description.to_string(),
        };

        let line_height = theme.body.line_height.unwrap_or(px(18.)).max(px(1.));

        let padding = px(match self.config.size {
            crate::ControlSize::Small => 6.,
            crate::ControlSize::Medium => 8.,
            crate::ControlSize::Large => 10.,
        });

        let height = if multiline {
            line_height * f32::from(self.config.rows) + padding * 2. + px(2.)
        } else {
            px(self.config.size.height())
        };

        let entity = cx.entity();
        let accessible_value = cx.entity();
        let mouse_up = cx.entity();

        gpui::div()
            .id("editor")
            .key_context("OnegitInput")
            .track_focus(&self.focus)
            .tab_index(0)
            .role(if search {
                accesskit::Role::SearchInput
            } else if multiline {
                accesskit::Role::MultilineTextInput
            } else {
                accesskit::Role::TextInput
            })
            .aria_label(self.config.label.clone())
            .aria_description(description)
            .aria_value(self.buffer.text.clone())
            .aria_placeholder(self.config.placeholder.clone())
            .a11y_synthetic_children(move |builder| {
                let node = builder.parent_node();

                if disabled {
                    node.set_disabled();
                    node.clear_actions();
                }

                if readonly {
                    node.set_read_only();
                }

                if invalid {
                    node.set_invalid(accesskit::Invalid::True);
                }
            })
            .when(self.editable(), |s| {
                s.on_a11y_action(accesskit::Action::SetValue, move |data, _, cx| {
                    if let Some(accesskit::ActionData::Value(value)) = data {
                        accessible_value.update(cx, |state, cx| {
                            state.replace(0..state.buffer.text.len(), value, false, cx)
                        });
                    }
                })
            })
            .w_full()
            .min_w_0()
            .h(height)
            .flex()
            .items_center()
            .gap(px(6.))
            .px(padding)
            .border_1()
            .rounded(theme.control)
            .bg(theme.surface_sunken)
            .border_color(if focused {
                theme.focus_ring
            } else if invalid {
                theme.danger
            } else {
                theme.line
            })
            .text_color(theme.ink)
            .text_size(theme.body.size.max(px(1.)))
            .font_weight(theme.body.weight.unwrap_or(gpui::FontWeight::NORMAL))
            .line_height(line_height)
            .cursor(if disabled {
                gpui::CursorStyle::Arrow
            } else {
                gpui::CursorStyle::IBeam
            })
            .when(disabled, |s| s.opacity(0.5))
            .on_key_down(cx.listener(Self::key_down))
            .on_mouse_down(gpui::MouseButton::Left, cx.listener(Self::mouse_down))
            .on_mouse_up_all(move |event, phase, _, _, cx| {
                if phase == gpui::DispatchPhase::Capture && event.button == gpui::MouseButton::Left
                {
                    mouse_up.update(cx, |this, _| this.dragging = false);
                }
            })
            .on_scroll_wheel(
                cx.listener(move |this, event: &gpui::ScrollWheelEvent, _, cx| {
                    if this.config.kind == Kind::Multiline
                        && this.config.availability != InputAvailability::Disabled
                    {
                        let delta = event.delta.pixel_delta(line_height);

                        if let Some(layout) = &this.layout {
                            let max = (layout.height - layout.bounds.size.height).max(px(0.));
                            let next = (this.scroll.y - delta.y).clamp(px(0.), max);

                            if next != this.scroll.y {
                                this.scroll.y = next;
                                this.reveal_caret = false;
                                cx.notify();
                                cx.stop_propagation();
                            }
                        }
                    }
                }),
            )
            .when(search, |s| {
                s.child(Icon {
                    size: IconSize::Medium,
                    ..Icon::new("search", IconName::Search)
                })
            })
            .child(
                gpui::div()
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .py(if multiline {
                        padding
                    } else {
                        (height - line_height - px(2.)) / 2.
                    })
                    .child(EditorText { state: cx.entity() }),
            )
            .when(search && !self.buffer.text.is_empty(), |s| {
                s.child(IconButton {
                    size: crate::ControlSize::Small,
                    state: if self.editable() {
                        crate::ControlState::Enabled
                    } else {
                        crate::ControlState::Disabled
                    },
                    on_press: Some(Box::new(move |_, window, cx| {
                        entity.update(cx, |this, cx| {
                            this.clear(cx);
                            window.focus(&this.focus, cx);
                        })
                    })),
                    ..IconButton::new("clear", IconName::Close, "Clear search")
                })
            })
    }
}
