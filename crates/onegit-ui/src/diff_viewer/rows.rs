use super::{DiffDocument, DiffLine, DiffLineKind, DiffView, document::Row, state::Scroll};
use crate::Theme;
use rake::gpui::{self, ColorExt, accesskit, prelude::*, px};

pub(super) const HEIGHT: f32 = 24.;

#[derive(Clone, Copy)]
pub(super) enum Side {
    Old,
    New,
}

fn number(value: Option<u64>, width: gpui::Pixels, theme: &Theme) -> impl IntoElement {
    gpui::div()
        .w(width)
        .flex_shrink_0()
        .text_color(theme.muted_ink)
        .text_size(px(10.))
        .pr(px(7.))
        .text_right()
        .child(value.map(|number| number.to_string()).unwrap_or_default())
}

fn cell(
    document: &DiffDocument,
    index: Option<usize>,
    view: DiffView,
    side: Side,
    gutter: gpui::Pixels,
    width: gpui::Pixels,
    position: usize,
) -> gpui::AnyElement {
    let theme = Theme::current();
    let line = index.map(|index| &document.lines()[index]);

    let (kind, text) = line.map_or((DiffLineKind::Context, "".into()), |line| {
        (line.kind, line.display.clone())
    });

    let (background, ink, marker) = match kind {
        DiffLineKind::Added => (theme.success.opacity(0.12), theme.ink, "+"),
        DiffLineKind::Deleted => (theme.danger.opacity(0.12), theme.ink, "−"),
        DiffLineKind::Hunk => (theme.accent.opacity(0.1), theme.accent, " "),
        DiffLineKind::Metadata => (theme.surface_raised, theme.muted_ink, "·"),
        DiffLineKind::Context => (
            if line.is_some() {
                theme.surface_sunken
            } else {
                theme.surface
            },
            theme.ink,
            " ",
        ),
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

    let total = document.rows(view).len();

    let mut row = gpui::div()
        .id(position)
        .debug_selector(move || match side {
            Side::Old => format!("diff-old-{position}"),
            Side::New => format!("diff-new-{position}"),
        })
        .h(px(HEIGHT))
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
        .bg(background)
        .text_color(ink)
        .role(accesskit::Role::ListItem)
        .aria_label(description)
        .a11y_synthetic_children(move |builder| {
            builder.parent_node().set_position_in_set(position + 1);
            builder.parent_node().set_size_of_set(total);
        });

    if view == DiffView::Unified {
        row = row
            .child(number(old, gutter, &theme))
            .child(number(new, gutter, &theme));
    } else {
        row = row.child(number(
            match side {
                Side::Old => old,
                Side::New => new,
            },
            gutter,
            &theme,
        ));
    }

    row.child(
        gpui::div()
            .w(px(18.))
            .flex_shrink_0()
            .text_color(marker_ink)
            .child(marker),
    )
    .child(
        gpui::div()
            .flex_shrink_0()
            .whitespace_nowrap()
            .pr(px(16.))
            .child(text),
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
    view: DiffView,
    side: Side,
    gutter: gpui::Pixels,
    width: gpui::Pixels,
    cx: &gpui::App,
) -> gpui::AnyElement {
    let length = document.rows(view).len();
    let handle = state.read(cx).handle.clone();

    let name = match side {
        Side::Old => "before",
        Side::New => "after",
    };

    let mut list = gpui::uniform_list(name, length, move |range, _, _| {
        range
            .map(|position| {
                let source = match document.rows(view)[position] {
                    Row::Single(index) => Some(index),
                    Row::Pair { old, new } => match side {
                        Side::Old => old,
                        Side::New => new,
                    },
                };

                cell(&document, source, view, side, gutter, width, position)
            })
            .collect()
    })
    .size_full()
    .min_w_0()
    .min_h_0()
    .track_scroll(&handle)
    .with_sizing_behavior(gpui::ListSizingBehavior::Auto)
    .with_horizontal_sizing_behavior(gpui::ListHorizontalSizingBehavior::Unconstrained);

    list.style().allow_concurrent_scroll = Some(true);

    gpui::div()
        .id(name)
        .debug_selector(move || format!("diff-{name}"))
        .flex_1()
        .w_full()
        .min_w_0()
        .min_h_0()
        .overflow_hidden()
        .role(accesskit::Role::List)
        .aria_label(format!("Diff {name}"))
        .child(list)
        .into_any_element()
}
