use super::{DiffDocument, DiffView};
use gpui_ce_motion::{Easing, MotionValue, Transition};
use rake::gpui::{self, px};

use std::{
    collections::HashSet,
    time::{Duration, Instant},
};

/// Retained scroll and focus state for a viewer that can leave the render tree.
pub struct Scroll {
    pub(super) document: DiffDocument,
    input: DiffDocument,
    pub(super) text: super::selection::TextSelection,
    pub(super) staging: Option<super::staging::DiffStageAction>,
    pub(super) staging_state: crate::ControlState,
    pub(super) on_stage: Option<super::staging::Handler>,
    revealed: HashSet<(Option<u64>, Option<u64>)>,
    reveal: MotionValue,
    epoch: Instant,
    pub(super) opacity: f32,
    pub(super) error: Option<&'static str>,
    pub(super) view: DiffView,
    pub(super) focus: gpui::FocusHandle,
    pub(super) handle: gpui::ListState,
    pub(super) horizontal: gpui::ScrollHandle,
}

impl Scroll {
    /// Create state for a parsed document and presentation.
    pub fn new(document: DiffDocument, view: DiffView, cx: &mut gpui::Context<Self>) -> Self {
        Self {
            document: document.clone(),
            input: document.clone(),
            text: Default::default(),
            staging: None,
            staging_state: crate::ControlState::Enabled,
            on_stage: None,
            revealed: HashSet::new(),
            reveal: MotionValue::new(1.),
            epoch: cx.background_executor().now(),
            opacity: 1.,
            error: None,
            view,
            focus: cx.focus_handle(),
            handle: gpui::ListState::new(
                document.row_count(view),
                gpui::ListAlignment::Top,
                px(100.),
            ),
            horizontal: gpui::ScrollHandle::new(),
        }
    }

    /// Replace a refreshed version of the same file while retaining its source-line viewport.
    pub fn refresh(&mut self, document: DiffDocument, view: DiffView) {
        if self.input.same_source(&document) {
            self.configure(document, view);
        } else {
            self.input = document.clone();
            self.error = None;
            self.replace(document, view, true);
        }
    }

    pub(super) fn original(&self) -> &DiffDocument {
        &self.input
    }

    fn top(&self) -> usize {
        self.handle.logical_scroll_top().item_ix
    }

    pub(super) fn configure(&mut self, document: DiffDocument, view: DiffView) {
        let same = self.input.same_source(&document);

        if same {
            if self.view != view {
                self.replace(self.document.clone(), view, true);
            }

            self.input = document;
        } else {
            self.input = document.clone();
            self.error = None;
            self.replace(document, view, false);
        }
    }

    fn replace(&mut self, document: DiffDocument, view: DiffView, preserve: bool) {
        let offset = self.handle.logical_scroll_top();
        let horizontal = self.horizontal.offset();

        let anchor = self
            .document
            .rows(self.view)
            .get(offset.item_ix)
            .map(|r| self.document.lines()[r.anchor()].clone());

        let mut anchor_delta = px(0.);

        let destination = if preserve {
            anchor
                .and_then(|anchor| {
                    document
                        .rows(view)
                        .iter()
                        .position(|row| {
                            let candidates = match *row {
                                super::document::Row::Single(i) => [Some(i), None],
                                super::document::Row::Pair { old, new } => [old, new],
                            };

                            candidates.into_iter().flatten().any(|i| {
                                let line = &document.lines()[i];

                                line.kind == anchor.kind
                                    && line.old_line == anchor.old_line
                                    && line.new_line == anchor.new_line
                                    && line.text == anchor.text
                            })
                        })
                        .or_else(|| {
                            document.rows(view).iter().position(|row| {
                                let candidates = match *row {
                                    super::document::Row::Single(i) => [Some(i), None],
                                    super::document::Row::Pair { old, new } => [old, new],
                                };

                                candidates.into_iter().flatten().any(|i| {
                                    let line = &document.lines()[i];

                                    line.text == anchor.text
                                        && if self.staging
                                            == Some(super::staging::DiffStageAction::Unstage)
                                        {
                                            anchor.old_line.is_some()
                                                && line.old_line == anchor.old_line
                                        } else {
                                            anchor.new_line.is_some()
                                                && line.new_line == anchor.new_line
                                        }
                                })
                            })
                        })
                        .or_else(|| {
                            // A hunk can move or merge during expansion. Anchor its first source row.
                            let start = self.document.rows(self.view).get(offset.item_ix)?.anchor();

                            let line = self.document.lines()[start..]
                                .iter()
                                .find(|l| l.old_line.is_some() || l.new_line.is_some())?;

                            anchor_delta = px(if anchor.kind == super::DiffLineKind::Hunk {
                                26.
                            } else if anchor.kind == super::DiffLineKind::Metadata {
                                super::rows::HEIGHT
                            } else {
                                0.
                            });

                            document.rows(view).iter().position(|row| {
                                let current = &document.lines()[row.anchor()];

                                current.old_line == line.old_line
                                    && current.new_line == line.new_line
                                    && current.kind == line.kind
                            })
                        })
                })
                .unwrap_or(
                    offset
                        .item_ix
                        .min(document.row_count(view).saturating_sub(1)),
                )
        } else {
            0
        };

        self.handle.reset(document.row_count(view));
        self.handle.scroll_to(gpui::ListOffset {
            item_ix: destination,
            offset_in_item: if preserve {
                offset.offset_in_item - anchor_delta
            } else {
                px(0.)
            },
        });
        self.horizontal.set_offset(if preserve {
            horizontal
        } else {
            gpui::point(px(0.), px(0.))
        });
        self.text.remap(&self.document, &document);

        if let Some(selection) = &mut self.text.selection {
            selection.side = if view == DiffView::Unified {
                super::rows::Side::Old
            } else if self.view == DiffView::Unified {
                if document.lines()[selection.anchor.line].kind == super::DiffLineKind::Added {
                    super::rows::Side::New
                } else {
                    super::rows::Side::Old
                }
            } else {
                selection.side
            };
        }

        self.document = document;
        self.view = view;
    }

    pub(super) fn expand(
        &mut self,
        request: super::context::Request,
        cx: &mut gpui::Context<Self>,
    ) {
        match self.document.expand(request) {
            Ok(document) => {
                let visible: HashSet<_> = self
                    .document
                    .lines()
                    .iter()
                    .map(|l| (l.old_line, l.new_line))
                    .collect();

                self.revealed = document
                    .lines()
                    .iter()
                    .filter(|l| l.kind == super::DiffLineKind::Context)
                    .map(|l| (l.old_line, l.new_line))
                    .filter(|key| !visible.contains(key))
                    .collect();
                self.reveal = MotionValue::new(0.35);
                self.epoch = cx.background_executor().now();
                self.reveal.animate(
                    1.,
                    Transition::Tween(Duration::from_millis(100), Easing::EaseOut),
                    Duration::ZERO,
                );
                self.replace(document, self.view, true);
                self.error = None;
            }
            Err(error) => self.error = Some(error),
        }

        cx.notify();
    }

    pub(super) fn sample(&mut self, window: &mut gpui::Window, cx: &gpui::App) {
        if self.text.dragging {
            if !window.is_window_active() {
                self.text.dragging = false;
                self.text.pointer = None;
            } else if let Some(pointer) = self.text.pointer {
                let viewport = self.handle.viewport_bounds();

                let direction = if pointer.y < viewport.top() {
                    -1.
                } else if pointer.y > viewport.bottom() {
                    1.
                } else {
                    0.
                };

                if direction != 0. {
                    let before = self.handle.logical_scroll_top();

                    self.handle.scroll_by(px(direction * 12.));
                    let after = self.handle.logical_scroll_top();

                    if after.item_ix != before.item_ix
                        || after.offset_in_item != before.offset_in_item
                    {
                        if let Some(selection) = self.text.selection
                            && let Some(head) =
                                self.text.hit(pointer, selection.side, &self.document)
                        {
                            self.text.selection =
                                Some(super::selection::Selection { head, ..selection });
                        }

                        window.request_animation_frame();
                    }
                }
            }
        }

        let sample = self.reveal.sample(
            cx.background_executor()
                .now()
                .saturating_duration_since(self.epoch),
            cx.reduce_motion(),
        );

        self.opacity = sample.value() as f32;

        if sample.is_animating() {
            window.request_animation_frame()
        } else {
            self.revealed.clear();
        }
    }

    pub(super) fn line_opacity(&self, line: &super::DiffLine) -> f32 {
        if self.revealed.contains(&(line.old_line, line.new_line)) {
            self.opacity
        } else {
            1.
        }
    }

    pub(super) fn key(
        &mut self,
        event: &gpui::KeyDownEvent,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.selection_key(event, window, cx) {
            window.prevent_default();
            cx.stop_propagation();

            return;
        }

        if event.keystroke.modifiers.modified() {
            return;
        }

        if event.keystroke.key == "e" {
            if let Some(request) = self.document.request(None, false) {
                self.expand(request, cx);
                window.prevent_default();
                cx.stop_propagation();
            }

            return;
        }

        let count = self.document.row_count(self.view);

        if count == 0 {
            return;
        }

        let current = self.top();
        let viewport = self.handle.viewport_bounds().size.height;
        let page = (f32::from(viewport) / super::rows::HEIGHT).floor().max(1.) as usize;

        let target = match event.keystroke.key.as_str() {
            "up" => current.saturating_sub(1),
            "down" => current.saturating_add(1),
            "pageup" => current.saturating_sub(page),
            "pagedown" => current.saturating_add(page),
            "home" => 0,
            "end" => count - 1,
            _ => return,
        }
        .min(count - 1);

        self.handle.scroll_to(gpui::ListOffset {
            item_ix: target,
            offset_in_item: px(0.),
        });
        window.prevent_default();
        cx.stop_propagation();
        cx.notify();
    }
}

#[cfg(all(test, feature = "test-support"))]
mod tests {
    use super::*;
    use rake::gpui::AppContext as _;

    #[test]
    fn expansion_keeps_both_scroll_offsets_and_reduced_motion_schedules_no_reveal() {
        let visible = "@@ -37,3 +37,3 @@\n before\n-old\n+new\n after\n";
        let mut full = "@@ -1,80 +1,80 @@\n".to_owned();

        for n in 1..=80 {
            full.push_str(match n {
                37 => " before\n",
                38 => "-old\n+new\n",
                39 => " after\n",
                _ => " context\n",
            });
        }

        let document =
            DiffDocument::parse(visible)
                .unwrap()
                .with_source("a.ts", "a.ts", Some(&full));

        let mut cx = gpui::TestAppContext::single();

        cx.update(|cx| cx.set_reduce_motion(true));
        let state = cx.new(|cx| Scroll::new(document, DiffView::Unified, cx));

        state.update(&mut cx, |state, cx| {
            state.handle.scroll_to(gpui::ListOffset {
                item_ix: 2,
                offset_in_item: px(5.),
            });
            state.horizontal.set_offset(gpui::point(px(-120.), px(0.)));
            let request = state.document.request(None, false).unwrap();

            state.expand(request, cx);
            let offset = state.handle.logical_scroll_top();

            let anchor =
                &state.document.lines()[state.document.rows(state.view)[offset.item_ix].anchor()];

            assert_eq!(anchor.old_line, Some(38));
            assert_eq!(offset.offset_in_item, px(5.));
            assert_eq!(state.horizontal.offset().x, px(-120.));
            assert!(!state.reveal.sample(Duration::ZERO, true).is_animating());
        });
    }

    #[test]
    fn partial_index_refresh_preserves_stable_source_pixel_and_horizontal_offsets() {
        let before =
            DiffDocument::parse("@@ -95,3 +95,4 @@\n line95\n+insert\n-old96\n+new96\n line97\n")
                .unwrap();

        for (action, patch, old, new) in [
            (
                super::super::DiffStageAction::Stage,
                "@@ -96,3 +96,3 @@\n insert\n-old96\n+new96\n line97\n",
                98,
                98,
            ),
            (
                super::super::DiffStageAction::Unstage,
                "@@ -95,3 +95,3 @@\n line95\n-old96\n+new96\n line97\n",
                97,
                97,
            ),
        ] {
            let mut cx = gpui::TestAppContext::single();
            let state = cx.new(|cx| Scroll::new(before.clone(), DiffView::Unified, cx));

            state.update(&mut cx, |state, _| {
                state.staging = Some(action);
                state.handle.scroll_to(gpui::ListOffset {
                    item_ix: 5,
                    offset_in_item: px(7.),
                });
                state.horizontal.set_offset(gpui::point(px(-90.), px(0.)));
                state.refresh(DiffDocument::parse(patch).unwrap(), DiffView::Unified);
                let offset = state.handle.logical_scroll_top();

                let line = &state.document.lines()
                    [state.document.rows(state.view)[offset.item_ix].anchor()];

                assert_eq!(line.text.as_ref(), "line97");
                assert_eq!((line.old_line, line.new_line), (Some(old), Some(new)));
                assert_eq!(offset.offset_in_item, px(7.));
                assert_eq!(state.horizontal.offset().x, px(-90.));
            });
        }
    }
}
