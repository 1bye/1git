//! Controlled index actions; requests always carry the original unexpanded preview.
use super::{DiffDocument, DiffLine, DiffLineKind, rows::Side, state::Scroll};
use crate::{Button, ButtonVariant, ControlSize, Icon, IconName, IconSize, Theme};
use rake::gpui::{self, ColorExt as _, accesskit, prelude::*, px};
use std::rc::Rc;

/// Whether changed-source controls add or remove index content.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiffStageAction {
    /// Stage reviewed working changes.
    Stage,
    /// Unstage reviewed index changes.
    Unstage,
}

impl DiffStageAction {
    pub(super) fn verb(self) -> &'static str {
        match self {
            Self::Stage => "Stage",
            Self::Unstage => "Unstage",
        }
    }
}

/// Frozen line-coordinate request; the application must revalidate it before writing.
#[derive(Clone, Debug)]
pub struct DiffStageRequest {
    /// Original three-context-line document, unaffected by visible context expansion.
    pub document: DiffDocument,
    /// Selected +/- source coordinates.
    pub lines: Vec<String>,
}

/// Native callback; application-owned Git work belongs on a background worker.
pub type DiffStageHandler = Box<dyn Fn(&DiffStageRequest, &mut gpui::Window, &mut gpui::App)>;
pub(super) type Handler = Rc<dyn Fn(&DiffStageRequest, &mut gpui::Window, &mut gpui::App)>;

pub(super) fn line_key(line: &DiffLine) -> Option<String> {
    match line.kind {
        DiffLineKind::Deleted => line.old_line.map(|n| format!("-:{n}")),
        DiffLineKind::Added => line.new_line.map(|n| format!("+:{n}")),
        _ => None,
    }
}

pub(super) fn group(document: &DiffDocument, index: usize) -> Vec<String> {
    let lines = document.lines();
    let mut start = index;
    let mut end = index + 1;

    while start > 0 && line_key(&lines[start - 1]).is_some() {
        start -= 1;
    }

    while end < lines.len() && line_key(&lines[end]).is_some() {
        end += 1;
    }

    lines[start..end].iter().filter_map(line_key).collect()
}

pub(super) fn hunk(document: &DiffDocument, index: usize) -> Vec<String> {
    let lines = document.lines();
    let mut start = index;

    while start > 0 && lines[start].kind != DiffLineKind::Hunk {
        start -= 1;
    }

    let mut end = start + 1;

    while end < lines.len() && lines[end].kind != DiffLineKind::Hunk {
        end += 1;
    }

    lines[start..end].iter().filter_map(line_key).collect()
}

#[derive(Clone)]
pub(super) struct Binding {
    owner: gpui::Entity<Scroll>,
    request: DiffStageRequest,
    handler: Handler,
    action: DiffStageAction,
}

pub(super) fn binding(
    state: &gpui::Entity<Scroll>,
    keys: Vec<String>,
    cx: &gpui::App,
) -> Option<Binding> {
    let value = state.read(cx);

    if keys.is_empty() {
        return None;
    }

    Some(Binding {
        owner: state.clone(),
        request: DiffStageRequest {
            document: value.original().clone(),
            lines: keys,
        },
        handler: value.on_stage.clone()?,
        action: value.staging?,
    })
}

impl Binding {
    pub(super) fn activate(&self, window: &mut gpui::Window, cx: &mut gpui::App) {
        let valid = {
            let owner = self.owner.read(cx);

            if !owner.staging_state.is_interactive() {
                return;
            }

            owner.staging == Some(self.action)
                && owner.original().same_source(&self.request.document)
        };

        if !valid {
            self.owner.update(cx, |state, cx| {
                state.error = Some("The diff changed. Review it before staging.");
                cx.notify();
            });

            return;
        }

        (self.handler)(&self.request, window, cx);
    }
}

pub(super) fn gutter(
    state: &gpui::Entity<Scroll>,
    document: &DiffDocument,
    index: usize,
    side: Side,
    window: &mut gpui::Window,
    cx: &mut gpui::App,
) -> gpui::AnyElement {
    let Some(key) = line_key(&document.lines()[index]) else {
        return gpui::div()
            .w(px(36.))
            .h_full()
            .flex_shrink_0()
            .into_any_element();
    };

    let Some(action) = state.read(cx).staging else {
        return gpui::div()
            .w(px(36.))
            .h_full()
            .flex_shrink_0()
            .into_any_element();
    };

    let keys = group(document, index);

    let control = |name: &'static str,
                   keys: Vec<String>,
                   cx: &mut gpui::App,
                   window: &mut gpui::Window| {
        let id = format!("diff-{:?}-{name}-{:?}-{key}", state.entity_id(), side);

        let focus =
            window.use_keyed_state(gpui::ElementId::Name(id.clone().into()), cx, |_, cx| {
                cx.focus_handle()
            });

        let focus = focus.read(cx).clone();
        let clicked = binding(state, keys.clone(), cx);
        let enabled = state.read(cx).staging_state.is_interactive();
        let pointer_focus = focus.clone();
        let debug_key = key.clone();

        let label = format!(
            "{} {} {}",
            action.verb(),
            if name == "group" {
                "change group"
            } else {
                "line"
            },
            key
        );

        let theme = Theme::current();
        let first_group_row = name != "group" || keys.first() == Some(&key);

        let rest = if action == DiffStageAction::Unstage {
            let mut accent = theme.accent;

            if name == "group" {
                accent.color.lightness *= 0.8;
            }

            accent
        } else if name == "group" {
            theme.line
        } else {
            theme.surface
        };

        crate::motion::surface(
            gpui::ElementId::Name(id.into()),
            crate::motion::Surface::new(rest),
            crate::motion::Surface::new(theme.accent.opacity(0.8)),
            crate::motion::Surface::new(theme.accent),
            enabled,
            move |surface| {
                gpui::div()
                    .id("control")
                    .debug_selector(move || format!("diff-stage-{name}-{:?}-{}", side, debug_key))
                    .w(px(18.))
                    .h_full()
                    .flex_shrink_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .bg(surface.background)
                    .text_color(if action == DiffStageAction::Unstage {
                        theme.on_accent
                    } else {
                        theme.diff_muted_ink
                    })
                    .role(accesskit::Role::CheckBox)
                    .aria_label(label)
                    .aria_toggled(if action == DiffStageAction::Unstage {
                        accesskit::Toggled::True
                    } else {
                        accesskit::Toggled::False
                    })
                    .track_focus(&focus.tab_stop(enabled && first_group_row))
                    .when(!enabled, |d| {
                        d.opacity(0.5)
                            .a11y_synthetic_children(|builder| builder.parent_node().set_disabled())
                    })
                    .when(enabled, |d| {
                        d.cursor_pointer()
                            .on_mouse_down(gpui::MouseButton::Left, move |_, window, cx| {
                                window.focus(&pointer_focus, cx);
                                cx.stop_propagation();
                            })
                            .on_click(move |_, window, cx| {
                                cx.stop_propagation();

                                if let Some(binding) = &clicked {
                                    binding.activate(window, cx);
                                }
                            })
                    })
                    .when(first_group_row, |d| {
                        d.child(Icon {
                            size: IconSize::Small,
                            ..Icon::new(
                                "mark",
                                if action == DiffStageAction::Unstage {
                                    IconName::Check
                                } else {
                                    IconName::Plus
                                },
                            )
                        })
                    })
            },
        )
        .into_any_element()
    };

    gpui::div()
        .w(px(36.))
        .h_full()
        .flex_shrink_0()
        .flex()
        .child(control("group", keys, cx, window))
        .child(control("line", vec![key.clone()], cx, window))
        .into_any_element()
}

pub(super) fn toolbar(state: &gpui::Entity<Scroll>, cx: &gpui::App) -> gpui::AnyElement {
    let owner = state.read(cx);

    if !owner.text.has_text(&owner.document, owner.view) {
        return gpui::Empty.into_any_element();
    }

    let copy = state.clone();
    let action = owner.staging;

    let keys = if action.is_some() {
        owner.selected_keys()
    } else {
        Vec::new()
    };

    let control = state.read(cx).staging_state;
    let selected = binding(state, keys.clone(), cx);

    let button = action.filter(|_| !keys.is_empty()).map(|action| Button {
        variant: ButtonVariant::Secondary,
        size: ControlSize::Small,
        state: control,
        on_press: Some(Box::new(move |_, window, cx| {
            if let Some(binding) = &selected {
                binding.activate(window, cx)
            }
        })),
        ..Button::new(
            "stage-selected-lines",
            format!("{} selected lines", action.verb()),
        )
    });

    gpui::div()
        .absolute()
        .bottom(px(8.))
        .right(px(8.))
        .flex()
        .gap(px(4.))
        .p(px(4.))
        .rounded(px(5.))
        .bg(Theme::current().surface_raised)
        .child(
            gpui::div()
                .debug_selector(|| "diff-copy-selection".into())
                .child(Button {
                    variant: ButtonVariant::Secondary,
                    size: ControlSize::Small,
                    on_press: Some(Box::new(move |_, _, cx| {
                        let text = copy.read(cx).selected_text();

                        if !text.is_empty() {
                            cx.write_to_clipboard(gpui::ClipboardItem::new_string(text));
                        }
                    })),
                    ..Button::new("copy-diff-selection", "Copy")
                }),
        )
        .children(button.map(|button| {
            gpui::div()
                .debug_selector(|| "diff-stage-selection".into())
                .child(button)
        }))
        .into_any_element()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn group_and_hunk_controls_only_emit_changed_source_coordinates() {
        let doc =
            DiffDocument::parse("@@ -10,3 +10,3 @@\n-old\n+new\n same\n-before\n+after\n").unwrap();

        assert_eq!(group(&doc, 1), ["-:10", "+:10"]);
        assert_eq!(hunk(&doc, 0), ["-:10", "+:10", "-:12", "+:12"]);
    }
}
