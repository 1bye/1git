//! Source History selection: replace, toggle and anchored inclusive ranges.
use super::selection::Selection;
use rake::gpui::{Modifiers, SharedString};

fn order() -> Vec<SharedString> {
    ["a", "b", "c", "d"].into_iter().map(Into::into).collect()
}

#[test]
fn shift_ranges_extend_from_the_original_anchor_and_plain_click_collapses() {
    let mut selection = Selection::default();

    selection.choose("b".into(), &Modifiers::default(), order(), None);
    selection.choose(
        "d".into(),
        &Modifiers {
            shift: true,
            ..Default::default()
        },
        order(),
        Some(&"b".into()),
    );
    assert_eq!(selection.ordered(order()), vec!["b", "c", "d"]);
    selection.choose(
        "c".into(),
        &Modifiers {
            shift: true,
            ..Default::default()
        },
        order(),
        Some(&"d".into()),
    );
    assert_eq!(selection.ordered(order()), vec!["b", "c"]);
    selection.choose(
        "c".into(),
        &Modifiers::default(),
        order(),
        Some(&"c".into()),
    );
    assert_eq!(selection.ordered(order()), vec!["c"]);
}

#[test]
fn toggle_can_create_a_disjoint_range_and_unknown_anchors_do_not_select_other_rows() {
    let mut selection = Selection::default();

    selection.choose("a".into(), &Modifiers::default(), order(), None);
    selection.choose(
        "c".into(),
        &Modifiers {
            platform: true,
            ..Default::default()
        },
        order(),
        Some(&"a".into()),
    );
    assert_eq!(selection.ordered(order()), vec!["a", "c"]);
    selection.choose(
        "a".into(),
        &Modifiers {
            platform: true,
            ..Default::default()
        },
        order(),
        Some(&"c".into()),
    );
    assert_eq!(selection.ordered(order()), vec!["c"]);
    selection.choose(
        "d".into(),
        &Modifiers {
            shift: true,
            ..Default::default()
        },
        ["d".into()],
        Some(&"c".into()),
    );
    assert_eq!(selection.ordered(order()), vec!["d"]);
}

#[test]
fn restored_multi_selection_keeps_its_original_shift_anchor() {
    let mut selection = Selection::default();

    selection.choose("b".into(), &Modifiers::default(), order(), None);
    selection.choose(
        "d".into(),
        &Modifiers {
            shift: true,
            ..Default::default()
        },
        order(),
        Some(&"b".into()),
    );
    let mut restored = Selection::restore(&selection.saved());

    assert_eq!(restored.ordered(order()), vec!["b", "c", "d"]);
    restored.choose(
        "c".into(),
        &Modifiers {
            shift: true,
            ..Default::default()
        },
        order(),
        Some(&"d".into()),
    );
    assert_eq!(restored.ordered(order()), vec!["b", "c"]);
}
