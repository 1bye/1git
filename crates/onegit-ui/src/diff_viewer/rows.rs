use super::{
    DiffDocument, DiffGutterStyle, DiffLine, DiffLineKind, DiffView, document::Row, state::Scroll,
};

use crate::Theme;
use rake::gpui::{self, accesskit, prelude::*, px};

pub(super) const HEIGHT: f32 = 20.;

#[derive(Clone, Copy)]
pub(super) enum Side {
    Old,
    New,
}

fn number(
    value: Option<u64>,
    width: gpui::Pixels,
    theme: &Theme,
    background: gpui::Hsla,
) -> impl IntoElement {
    gpui::div()
        .w(width)
        .flex_shrink_0()
        .text_color(theme.diff_muted_ink)
        .text_size(px(11.))
        .pr(px(8.))
        .h_full()
        .flex()
        .items_center()
        .justify_end()
        .bg(background)
        .child(value.map(|number| number.to_string()).unwrap_or_default())
}

#[derive(Clone, Copy)]
pub(super) struct Layout {
    pub view: DiffView,
    pub side: Side,
    pub gutter: gpui::Pixels,
    pub width: gpui::Pixels,
    pub style: DiffGutterStyle,
}

fn plain_cell(
    document: &DiffDocument,
    index: Option<usize>,
    position: usize,
    layout: Layout,
    hunk_background: Option<gpui::Hsla>,
) -> gpui::AnyElement {
    let Layout {
        view,
        side,
        gutter,
        width,
        style,
    } = layout;

    let inset = if style == DiffGutterStyle::Inset {
        px(36.)
    } else {
        px(0.)
    };

    let theme = Theme::current();
    let line = index.map(|index| &document.lines()[index]);

    let (kind, text) = line.map_or((DiffLineKind::Context, "".into()), |line| {
        (line.kind, line.display.clone())
    });

    let (background, ink, marker) = match kind {
        DiffLineKind::Added => (theme.diff_added, theme.diff_ink, "+"),
        DiffLineKind::Deleted => (theme.diff_deleted, theme.diff_ink, "−"),
        DiffLineKind::Hunk => (
            hunk_background.unwrap_or(theme.diff_hunk),
            theme.diff_muted_ink,
            " ",
        ),
        DiffLineKind::Metadata => (theme.diff_hunk, theme.diff_muted_ink, "·"),
        DiffLineKind::Context => (theme.surface, theme.diff_ink, " "),
    };

    let marker_ink = match kind {
        DiffLineKind::Added => theme.success,
        DiffLineKind::Deleted => theme.danger,
        _ => theme.muted_ink,
    };

    let old = line.and_then(|line| line.old_line);
    let new = line.and_then(|line| line.new_line);

    let description = line.map_or_else(
        || "No corresponding line".to_owned(),
        |line| describe(line, view, side),
    );

    let spans = index.map(|index| {
        &document.0.syntax[index][match side {
            Side::Old if kind != DiffLineKind::Added => 0,
            _ => 1,
        }]
    });

    let words = index.map(|i| document.word_ranges(i)).unwrap_or_default();
    // GPUI expects non-overlapping ranges. Compose syntax foreground and word backgrounds.
    let mut boundaries = vec![0, text.len()];

    if let Some(spans) = spans {
        for span in spans {
            boundaries.extend([span.range.start, span.range.end]);
        }
    }

    for word in words {
        boundaries.extend([word.start, word.end]);
    }

    boundaries.sort_unstable();
    boundaries.dedup();
    let text =
        gpui::StyledText::new(text).with_highlights(boundaries.windows(2).filter_map(|range| {
            let range = range[0]..range[1];

            let color = spans
                .and_then(|spans| {
                    spans
                        .iter()
                        .find(|span| span.range.start <= range.start && span.range.end >= range.end)
                })
                .map(|span| super::syntax::color(span.kind, &theme));

            let background_color = words
                .iter()
                .any(|word| word.start <= range.start && word.end >= range.end)
                .then_some(if kind == DiffLineKind::Added {
                    theme.diff_added_word
                } else {
                    theme.diff_deleted_word
                });

            (color.is_some() || background_color.is_some()).then_some((
                range,
                gpui::HighlightStyle {
                    color,
                    background_color,
                    ..Default::default()
                },
            ))
        }));

    let total = document.rows(view).len();

    let mut row = gpui::div()
        .id((
            match side {
                Side::Old => "old",
                Side::New => "new",
            },
            position,
        ))
        .debug_selector(move || match side {
            Side::Old => format!("diff-old-{position}"),
            Side::New => format!("diff-new-{position}"),
        })
        .h(px(if kind == DiffLineKind::Hunk {
            26.
        } else {
            HEIGHT
        }))
        .min_w(width)
        .w_full()
        .flex_shrink_0()
        .flex()
        .flex_row()
        .items_center()
        .overflow_hidden()
        .font_family(theme.mono)
        .text_size(theme.code.size)
        .line_height(px(HEIGHT))
        .bg(theme.surface)
        .text_color(ink)
        .role(accesskit::Role::ListItem)
        .aria_label(description)
        .a11y_synthetic_children(move |builder| {
            builder.parent_node().set_position_in_set(position + 1);
            builder.parent_node().set_size_of_set(total);
        });

    if kind == DiffLineKind::Hunk || kind == DiffLineKind::Metadata {
        return row
            .bg(background)
            .pl(inset + gutter * if view == DiffView::Unified { 2. } else { 1. } + px(34.))
            .child(text)
            .into_any_element();
    }

    let number_background = if style == DiffGutterStyle::Continuous {
        background
    } else {
        theme.surface
    };

    if style == DiffGutterStyle::Continuous {
        row = row.child(
            gpui::div()
                .w(px(2.))
                .h_full()
                .flex_shrink_0()
                .bg(match kind {
                    DiffLineKind::Added => theme.diff_added_rail,
                    DiffLineKind::Deleted => theme.diff_deleted_rail,
                    _ => gpui::transparent_black(),
                }),
        );
    }

    row = row.child(gpui::div().w(inset).h_full().flex_shrink_0());

    if view == DiffView::Unified {
        row = row
            .child(number(old, gutter, &theme, number_background))
            .child(number(new, gutter, &theme, number_background));
    } else {
        row = row.child(number(
            match side {
                Side::Old => old,
                Side::New => new,
            },
            gutter,
            &theme,
            number_background,
        ));
    }

    row.child(
        gpui::div()
            .w(px(if style == DiffGutterStyle::Inset {
                2.
            } else {
                0.
            }))
            .h_full()
            .flex_shrink_0()
            .bg(match kind {
                DiffLineKind::Added => theme.diff_added_rail,
                DiffLineKind::Deleted => theme.diff_deleted_rail,
                _ => gpui::transparent_black(),
            }),
    )
    .child(
        gpui::div()
            .w(px(18.))
            .h_full()
            .flex()
            .items_center()
            .justify_center()
            .bg(background)
            .flex_shrink_0()
            .text_color(marker_ink)
            .child(marker),
    )
    .child(
        gpui::div()
            .flex_1()
            .min_w_0()
            .whitespace_nowrap()
            .h_full()
            .flex()
            .items_center()
            .px(px(14.))
            .bg(background)
            .child(text),
    )
    .into_any_element()
}

fn cell(
    state: &gpui::Entity<Scroll>,
    document: &DiffDocument,
    index: Option<usize>,
    position: usize,
    layout: Layout,
    cx: &gpui::App,
) -> gpui::AnyElement {
    let opacity = index
        .map(|i| state.read(cx).line_opacity(&document.lines()[i]))
        .unwrap_or(1.);

    let cell = gpui::div()
        .opacity(opacity)
        .child(plain_cell(document, index, position, layout, None))
        .into_any_element();

    let Some(request) = index
        .filter(|&i| document.lines()[i].kind == DiffLineKind::Hunk)
        .and_then(|i| document.request(Some(i), false))
    else {
        return cell;
    };

    let state = state.clone();
    let document = document.clone();
    let theme = Theme::current();

    crate::motion::surface(
        gpui::ElementId::Name(
            format!(
                "context-{}-{position}",
                if matches!(layout.side, Side::Old) {
                    "old"
                } else {
                    "new"
                }
            )
            .into(),
        ),
        crate::motion::Surface::new(theme.diff_hunk),
        crate::motion::Surface::new(theme.hover),
        crate::motion::Surface::new(theme.pressed),
        true,
        move |surface| {
            gpui::div()
                .id("expand-context")
                .debug_selector(move || format!("diff-expand-{position}"))
                .w_full()
                .relative()
                .bg(surface.background)
                .cursor_pointer()
                .role(accesskit::Role::Button)
                .aria_label(format!(
                    "Expand {} unchanged lines above. Press E to expand context.",
                    request.count
                ))
                .on_click(move |_, window, cx| {
                    state.update(cx, |state, cx| {
                        window.focus(&state.focus, cx);
                        state.expand(request, cx);
                    })
                })
                .child(plain_cell(
                    &document,
                    index,
                    position,
                    layout,
                    Some(surface.background),
                ))
                .child(
                    gpui::div()
                        .absolute()
                        .left(px(8.))
                        .top(px(3.))
                        .text_color(surface.ink)
                        .child("↕"),
                )
        },
    )
    .into_any_element()
}

fn after(state: &gpui::Entity<Scroll>, document: &DiffDocument, blank: bool) -> gpui::AnyElement {
    let Some(request) = document.request(None, true) else {
        return gpui::Empty.into_any_element();
    };

    let theme = Theme::current();
    let state = state.clone();

    crate::motion::surface(
        "expand-after".into(),
        crate::motion::Surface::new(theme.diff_hunk),
        crate::motion::Surface::new(theme.hover),
        crate::motion::Surface::new(theme.pressed),
        !blank,
        move |surface| {
            gpui::div()
                .id("expand-after-control")
                .debug_selector(move || {
                    if blank {
                        "diff-context-end-blank".into()
                    } else {
                        "diff-expand-after".into()
                    }
                })
                .h(px(26.))
                .w_full()
                .bg(surface.background)
                .text_color(theme.diff_muted_ink)
                .font_family(theme.mono)
                .text_size(theme.code.size)
                .flex()
                .items_center()
                .pl(px(8.))
                .when(!blank, |d| {
                    d.cursor_pointer()
                        .role(accesskit::Role::Button)
                        .aria_label(format!("Expand {} unchanged lines below", request.count))
                        .on_click(move |_, window, cx| {
                            state.update(cx, |state, cx| {
                                window.focus(&state.focus, cx);
                                state.expand(request, cx);
                            })
                        })
                        .child("↕   Expand unchanged lines")
                })
        },
    )
    .into_any_element()
}

fn describe(line: &DiffLine, view: DiffView, side: Side) -> String {
    let kind = match line.kind {
        DiffLineKind::Added => "Added",
        DiffLineKind::Deleted => "Deleted",
        DiffLineKind::Context => "Context",
        DiffLineKind::Hunk => "Hunk",
        DiffLineKind::Metadata => "Metadata",
    };

    let coordinate = if view == DiffView::Unified {
        format!(
            "old {}, new {}",
            line.old_line.map_or("—".into(), |value| value.to_string()),
            line.new_line.map_or("—".into(), |value| value.to_string())
        )
    } else {
        match side {
            Side::Old => format!(
                "before {}",
                line.old_line.map_or("—".into(), |value| value.to_string())
            ),
            Side::New => format!(
                "after {}",
                line.new_line.map_or("—".into(), |value| value.to_string())
            ),
        }
    };

    format!(
        "{kind}, {coordinate}: {}{}",
        line.text,
        if line.no_newline {
            ", no final newline"
        } else {
            ""
        }
    )
}

pub(super) fn list(
    state: &gpui::Entity<Scroll>,
    document: DiffDocument,
    layout: Layout,
    cx: &gpui::App,
) -> gpui::AnyElement {
    let Layout {
        view, side, width, ..
    } = layout;

    let handle = state.read(cx).handle.clone();
    let horizontal = state.read(cx).horizontal.clone();

    let name = match side {
        Side::Old => "before",
        Side::New => "after",
    };

    let retained = state.clone();

    let list = gpui::list(handle, move |position, _, cx| {
        if position == document.rows(view).len() {
            return after(&retained, &document, matches!(side, Side::New));
        }

        let source = match document.rows(view)[position] {
            Row::Single(index) => Some(index),
            Row::Pair { old, new } => match side {
                Side::Old => old,
                Side::New => new,
            },
        };

        cell(&retained, &document, source, position, layout, cx)
    })
    .h_full()
    .w_full()
    .min_w(width)
    .with_sizing_behavior(gpui::ListSizingBehavior::Auto);

    gpui::div()
        .id(name)
        .debug_selector(move || format!("diff-{name}"))
        .flex_1()
        .w_full()
        .min_w_0()
        .min_h_0()
        .overflow_x_scroll()
        .overflow_y_hidden()
        .track_scroll(&horizontal)
        .role(accesskit::Role::List)
        .aria_label(format!("Diff {name}"))
        .child(list)
        .into_any_element()
}

/// One virtualized list owns both columns and full-width hunk headers.
pub(super) fn aligned_list(
    state: &gpui::Entity<Scroll>,
    document: DiffDocument,
    layout: Layout,
    cx: &gpui::App,
) -> gpui::AnyElement {
    let handle = state.read(cx).handle.clone();
    let offset = state.read(cx).horizontal.offset().x;
    let width = layout.width;

    let retained = state.clone();

    let list = gpui::list(handle, move |position, _, cx| {
        if position == document.rows(DiffView::Split).len() {
            return after(&retained, &document, false);
        }

        match document.rows(DiffView::Split)[position] {
            Row::Single(index) => cell(
                &retained,
                &document,
                Some(index),
                position,
                Layout {
                    width: px(0.),
                    ..layout
                },
                cx,
            ),
            Row::Pair { old, new } => gpui::div()
                .w_full()
                .flex()
                .flex_row()
                .child(
                    gpui::div()
                        .debug_selector(move || format!("diff-pane-old-{position}"))
                        .flex_1()
                        .min_w_0()
                        .overflow_hidden()
                        .child(gpui::div().relative().left(offset).child(cell(
                            &retained,
                            &document,
                            old,
                            position,
                            Layout {
                                side: Side::Old,
                                ..layout
                            },
                            cx,
                        ))),
                )
                .child(
                    gpui::div()
                        .w(px(1.))
                        .h(px(HEIGHT))
                        .flex_shrink_0()
                        .bg(Theme::current().hairline),
                )
                .child(
                    gpui::div()
                        .debug_selector(move || format!("diff-pane-new-{position}"))
                        .flex_1()
                        .min_w_0()
                        .overflow_hidden()
                        .child(gpui::div().relative().left(offset).child(cell(
                            &retained,
                            &document,
                            new,
                            position,
                            Layout {
                                side: Side::New,
                                ..layout
                            },
                            cx,
                        ))),
                )
                .into_any_element(),
        }
    })
    .size_full()
    .with_sizing_behavior(gpui::ListSizingBehavior::Auto);

    let scroll = state.clone();

    gpui::div()
        .id("aligned")
        .debug_selector(|| "diff-aligned".into())
        .flex_1()
        .w_full()
        .min_w_0()
        .min_h_0()
        .overflow_hidden()
        .on_scroll_wheel(move |event, _, cx| {
            let delta = event.delta.pixel_delta(px(HEIGHT));

            if delta.x != px(0.) {
                scroll.update(cx, |state, cx| {
                    let pane = (state.handle.viewport_bounds().size.width - px(1.)) / 2.;
                    let limit = (width - pane).max(px(0.));
                    let next = (state.horizontal.offset().x + delta.x).clamp(-limit, px(0.));

                    state.horizontal.set_offset(gpui::point(next, px(0.)));
                    cx.notify();
                });
            }
        })
        .role(accesskit::Role::List)
        .aria_label("Indexed and working diff rows")
        .child(list)
        .into_any_element()
}
