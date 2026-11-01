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
}
