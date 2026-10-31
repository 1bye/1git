//! Native shaping, caret geometry, scrolling and the platform input-handler bridge.
use super::{InputAvailability, InputState, Kind};
use rake::gpui::{self, prelude::*, px};
use std::rc::Rc;

struct Paragraph {
    start: usize,
    y: gpui::Pixels,
    line: gpui::WrappedLine,
}

pub(super) struct Layout {
    paragraphs: Vec<Paragraph>,
    pub bounds: gpui::Bounds<gpui::Pixels>,
    pub line_height: gpui::Pixels,
    pub height: gpui::Pixels,
    width: gpui::Pixels,
    text: String,
    placeholder: bool,
    style: gpui::TextStyle,
}

impl Layout {
    fn paint_range(
        &self,
        range: std::ops::Range<usize>,
        origin: gpui::Point<gpui::Pixels>,
        color: gpui::Hsla,
        underline: bool,
        window: &mut gpui::Window,
    ) {
        if range.is_empty() || self.placeholder {
            return;
        }

        for p in &self.paragraphs {
            let start = range.start.max(p.start);
            let end = range.end.min(p.start + p.line.len());

            if start > end || range.end <= p.start || start > p.start + p.line.len() {
                continue;
            }

            let a = p
                .line
                .position_for_index(start - p.start, self.line_height)
                .unwrap_or_default();

            let b = p
                .line
                .position_for_index(end - p.start, self.line_height)
                .unwrap_or(a);

            let mut y = a.y;

            while y <= b.y {
                let left = if y == a.y { a.x } else { px(0.) };

                let right = if y == b.y && range.end <= p.start + p.line.len() {
                    b.x
                } else {
                    self.bounds.size.width
                };

                let top = p.y
                    + y
                    + if underline {
                        self.line_height - px(1.)
                    } else {
                        px(0.)
                    };

                let height = if underline { px(1.) } else { self.line_height };

                window.paint_quad(gpui::fill(
                    gpui::Bounds::new(
                        origin + gpui::point(left.min(right), top),
                        gpui::size((right - left).abs().max(px(1.)), height),
                    ),
                    color,
                ));
                y += self.line_height;
            }
        }
    }

    pub fn position(&self, index: usize) -> gpui::Point<gpui::Pixels> {
        if self.placeholder {
            return gpui::point(px(0.), px(0.));
        }

        let paragraph = self
            .paragraphs
            .iter()
            .find(|p| index <= p.start + p.line.len())
            .or_else(|| self.paragraphs.last());

        if let Some(p) = paragraph {
            let mut point = p
                .line
                .position_for_index(
                    index.saturating_sub(p.start).min(p.line.len()),
                    self.line_height,
                )
                .unwrap_or_default();

            point.y += p.y;

            point
        } else {
            gpui::point(px(0.), px(0.))
        }
    }

    pub fn index_at(&self, point: gpui::Point<gpui::Pixels>) -> usize {
        if self.placeholder || point.y < px(0.) {
            return 0;
        }

        let Some(p) = self
            .paragraphs
            .iter()
            .find(|p| point.y < p.y + p.line.size(self.line_height).height)
            .or_else(|| self.paragraphs.last())
        else {
            return 0;
        };

        let point = gpui::point(point.x.max(px(0.)), (point.y - p.y).max(px(0.)));

        let index = p
            .line
            .closest_index_for_position(point, self.line_height)
            .unwrap_or_else(|i| i);

        (p.start + index).min(self.text.len())
    }
}

pub(super) struct EditorText {
    pub state: gpui::Entity<InputState>,
}

impl IntoElement for EditorText {
    type Element = Self;

    fn into_element(self) -> Self {
        self
    }
}

impl gpui::Element for EditorText {
    type RequestLayoutState = ();
    type PrepaintState = Rc<Layout>;

    fn id(&self) -> Option<gpui::ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        window: &mut gpui::Window,
        cx: &mut gpui::App,
    ) -> (gpui::LayoutId, ()) {
        let style = gpui::Style {
            size: gpui::size(gpui::relative(1.).into(), gpui::relative(1.).into()),
            min_size: gpui::size(px(0.).into(), px(0.).into()),
            ..Default::default()
        };

        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: gpui::Bounds<gpui::Pixels>,
        _: &mut (),
        window: &mut gpui::Window,
        cx: &mut gpui::App,
    ) -> Rc<Layout> {
        let style = window.text_style();
        let line_height = window.line_height().max(px(1.));

        self.state.update(cx, |state, _| {
            if state.focus.is_focused(window)
                && state
                    .layout
                    .as_ref()
                    .is_some_and(|layout| layout.bounds.size != bounds.size)
            {
                state.reveal_caret = true;
            }

            let placeholder = state.buffer.text.is_empty();

            let display = if placeholder {
                state.config.placeholder.to_string()
            } else {
                state.buffer.text.clone()
            };

            let reused = state
                .layout
                .as_ref()
                .filter(|layout| {
                    layout.text == display
                        && layout.placeholder == placeholder
                        && layout.bounds == bounds
                        && layout.style == style
                        && layout.line_height == line_height
                })
                .cloned();

            let layout = if let Some(layout) = reused {
                layout
            } else {
                let run = gpui::TextRun {
                    len: display.len(),
                    font: style.font(),
                    color: if placeholder {
                        state.theme.placeholder_ink
                    } else {
                        style.color
                    },
                    background_color: None,
                    underline: None,
                    strikethrough: None,
                    letter_spacing: style.letter_spacing,
                };

                let lines = window
                    .text_system()
                    .shape_text(
                        display.clone(),
                        style.font_size.to_pixels(window.rem_size()),
                        &[run],
                        (state.config.kind == Kind::Multiline)
                            .then_some(bounds.size.width.max(px(1.))),
                        None,
                    )
                    .unwrap_or_else(|error| {
                        rake::error!(%error,"failed to shape native input text");

                        Default::default()
                    });

                let mut paragraphs = Vec::with_capacity(lines.len());
                let mut start = 0;
                let mut y = px(0.);
                let mut width = bounds.size.width;

                for line in lines {
                    let len = line.len();
                    let height = line.size(line_height).height;

                    width = width.max(line.width());
                    paragraphs.push(Paragraph { start, y, line });
                    start += len + 1;
                    y += height;
                }

                Rc::new(Layout {
                    paragraphs,
                    bounds,
                    line_height,
                    height: y.max(line_height),
                    width,
                    text: display,
                    placeholder,
                    style,
                })
            };

            let max_y = (layout.height - bounds.size.height).max(px(0.));

            let max_x = if state.config.kind == Kind::Multiline {
                px(0.)
            } else {
                (layout.width - bounds.size.width + px(2.)).max(px(0.))
            };

            state.scroll.x = state.scroll.x.clamp(px(0.), max_x);
            state.scroll.y = state.scroll.y.clamp(px(0.), max_y);

            if state.reveal_caret {
                let caret = layout.position(state.buffer.head);

                if caret.x < state.scroll.x {
                    state.scroll.x = caret.x;
                } else if caret.x + px(2.) > state.scroll.x + bounds.size.width {
                    state.scroll.x = (caret.x + px(2.) - bounds.size.width).max(px(0.));
                }

                if caret.y < state.scroll.y {
                    state.scroll.y = caret.y;
                } else if caret.y + line_height > state.scroll.y + bounds.size.height {
                    state.scroll.y = (caret.y + line_height - bounds.size.height).max(px(0.));
                }

                state.scroll.x = state.scroll.x.clamp(px(0.), max_x);
                state.scroll.y = state.scroll.y.clamp(px(0.), max_y);
                state.reveal_caret = false;
            }

            state.layout = Some(layout.clone());

            layout
        })
    }

    fn paint(
        &mut self,
        _: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: gpui::Bounds<gpui::Pixels>,
        _: &mut (),
        layout: &mut Rc<Layout>,
        window: &mut gpui::Window,
        cx: &mut gpui::App,
    ) {
        let state = self.state.read(cx);
        let focus = state.focus.clone();
        let disabled = state.config.availability == InputAvailability::Disabled;
        let selection = state.buffer.selection();
        let marked = state.buffer.marked.clone();
        let head = state.buffer.head;

        let caret = state.caret_visible
            && focus.is_focused(window)
            && window.is_window_active()
            && !disabled;

        let scroll = state.scroll;
        let theme = state.theme.clone();
        let input = self.state.clone();

        window.on_mouse_event(move |event: &gpui::MouseMoveEvent, phase, window, cx| {
            if phase == gpui::DispatchPhase::Capture {
                input.update(cx, |state, cx| state.mouse_move(event, window, cx));
            }
        });

        if !disabled {
            window.handle_input(
                &focus,
                gpui::ElementInputHandler::new(bounds, self.state.clone()),
                cx,
            );
        }

        window.with_content_mask(Some(gpui::ContentMask { bounds }), |window| {
            let origin = bounds.origin - scroll;

            layout.paint_range(selection, origin, theme.selection, false, window);

            for p in &layout.paragraphs {
                let y = origin.y + p.y;
                let height = p.line.size(layout.line_height).height;

                if y + height < bounds.top() || y > bounds.bottom() {
                    continue;
                }

                if let Err(error) = p.line.paint(
                    origin + gpui::point(px(0.), p.y),
                    layout.line_height,
                    gpui::TextAlign::Left,
                    None,
                    window,
                    cx,
                ) {
                    rake::error!(%error,"failed to paint native input text");
                }
            }

            if let Some(marked) = marked {
                layout.paint_range(marked, origin, theme.ink, true, window);
            }

            if caret {
                window.paint_quad(gpui::fill(
                    gpui::Bounds::new(
                        origin + layout.position(head),
                        gpui::size(px(1.), layout.line_height),
                    ),
                    theme.ink,
                ));
            }
        });
    }
}
