//! Accounts is window-owned and never replaces retained repository tabs or session state.
use super::branch_tests::{fixture, settle};
use super::tests::{open, setup};
use super::*;

#[test]
fn accounts_navigation_keeps_tabs_drafts_selections_filters_and_viewports() {
    let f = fixture();

    f.write("a.txt", "working\n");
    let (mut cx, view) = setup(&f);
    let first = open(&mut cx, view, &f.root);
    let second = open(&mut cx, view, &f.root);

    first.update(&mut cx, |tab, cx| {
        tab.summary.update(cx, |i, cx| i.set_text("Keep draft", cx));
        tab.description
            .update(cx, |i, cx| i.set_text("Keep description", cx));
        tab.filter.update(cx, |i, cx| i.set_text("a.txt", cx));
    });
    let before = first.read_with(&cx, |tab, cx| session::SavedTab::capture(tab, cx).unwrap());

    let second_before =
        second.read_with(&cx, |tab, cx| session::SavedTab::capture(tab, cx).unwrap());

    let head = f.git(&["rev-parse", "HEAD"]);
    let index = std::fs::read(f.root.join(".git/index")).unwrap();

    let settings = view
        .update(&mut cx, |w, window, cx| {
            let settings = w.settings.clone();

            settings.read(cx).accounts.clone().update(cx, |p, cx| {
                p.test_store(f.directory.path().join("accounts.json"), cx)
            });
            w.open_accounts(window, cx);

            settings
        })
        .unwrap();

    settle(&mut cx, view);
    assert!(settings.read_with(&cx, |p, _| p.visible));
    view.update(&mut cx, |w, window, cx| {
        w.request(&Request::Activate(w.tabs[0].id), window, cx);
        w.open_accounts(window, cx);
        settings.update(cx, |p, cx| p.close(window, cx));
    })
    .unwrap();
    settle(&mut cx, view);
    assert_eq!(
        first.read_with(&cx, |tab, cx| session::SavedTab::capture(tab, cx).unwrap()),
        before
    );
    assert_eq!(
        second.read_with(&cx, |tab, cx| session::SavedTab::capture(tab, cx).unwrap()),
        second_before
    );
    assert_eq!(f.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(std::fs::read(f.root.join(".git/index")).unwrap(), index);
    assert_eq!(
        std::fs::read_to_string(f.root.join("a.txt")).unwrap(),
        "working\n"
    );
}
