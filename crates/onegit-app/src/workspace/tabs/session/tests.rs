//! Maps the source workspace-session tests to Rust's private, per-tab session format.
use super::*;
use std::fs;

fn document(path: &std::path::Path) -> Document {
    Document {
        version: 1,
        active: Some(1),
        tabs: vec![tab(path, "first"), tab(path, "second")],
    }
}

fn tab(path: &std::path::Path, summary: &str) -> SavedTab {
    SavedTab {
        stashes: None,
        graph: None,
        root: Root::capture(path),
        summary: summary.into(),
        description: "Details ✨\nKeep whitespace  ".into(),
        history_visible: true,
        selected: Some(Change {
            path: b"folder/\xff.txt".to_vec(),
            staged: true,
        }),
        split_diff: true,
        filter: "été".into(),
        filter_visible: true,
        sidebar: 347.,
        history: History {
            tree_layout: true,
            collapsed: vec![b"folder/deep".to_vec()],
            commit: Some("1".repeat(40)),
            file: Some(b"a.txt".to_vec()),
            rows: 100,
            split_diff: false,
            sidebar: 415.,
            detail_fraction: 0.63,
        },
    }
}

#[test]
fn round_trips_tab_order_separate_drafts_home_and_exact_paths_without_git_state() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("workspace.json");
    let store = Store::new(path.clone());
    let mut expected = document(dir.path());

    expected.tabs.swap(0, 1);
    store.prepare(expected.clone())().unwrap();
    assert_eq!(Store::load(&path).unwrap(), Some(expected.clone()));
    expected.active = None;
    store.prepare(expected.clone())().unwrap();
    assert_eq!(Store::load(&path).unwrap(), Some(expected));
    let content = fs::read_to_string(path).unwrap();

    for excluded in ["snapshot", "pending", "git_directory", "password"] {
        assert!(!content.contains(excluded));
    }
}

#[test]
fn newest_save_wins_even_when_older_work_completes_later() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("session.json");
    let store = Store::new(path.clone());
    let first = document(dir.path());
    let old = store.prepare(first.clone());
    let mut last = first;

    last.tabs[0].summary = "last keystroke".into();
    store.prepare(last.clone())().unwrap();
    old().unwrap();
    assert_eq!(Store::load(&path).unwrap(), Some(last));
}

#[test]
fn malformed_future_oversized_and_invalid_paths_are_rejected_without_losing_saved_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("session.json");

    assert!(Store::load(&path).unwrap().is_none());
    let base = document(dir.path());

    let mut invalid = vec![
        b"{".to_vec(),
        br#"{"version":2,"tabs":[],"active":null}"#.to_vec(),
    ];

    let mut relative = base.clone();

    relative.tabs[0].root = Root::Text("relative/path".into());
    invalid.push(serde_json::to_vec(&relative).unwrap());
    let mut nul = base.clone();

    nul.tabs[0].root = Root::Text("/with\0nul".into());
    invalid.push(serde_json::to_vec(&nul).unwrap());
    let mut bad_path = base;

    bad_path.tabs[0].selected.as_mut().unwrap().path = b"../escape".to_vec();
    invalid.push(serde_json::to_vec(&bad_path).unwrap());
    invalid.push(vec![b' '; model::LIMIT as usize + 1]);

    for bytes in invalid {
        fs::write(&path, &bytes).unwrap();
        assert!(Store::load(&path).is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
}

#[test]
fn failed_save_keeps_previous_document_and_can_retry() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("session.json");
    let store = Store::new(path.clone());
    let first = document(dir.path());

    store.prepare(first.clone())().unwrap();
    let before = fs::read(&path).unwrap();
    let mut too_large = first;

    too_large.tabs[0].summary = "x".repeat(model::LIMIT as usize);
    assert!(store.prepare(too_large)().is_err());
    assert_eq!(fs::read(&path).unwrap(), before);
    let mut next = document(dir.path());

    next.tabs[0].summary = "retry".into();
    store.prepare(next.clone())().unwrap();
    assert_eq!(Store::load(&path).unwrap(), Some(next));
}

#[cfg(unix)]
#[test]
fn preserves_non_utf8_repository_roots_and_private_permissions() {
    use std::os::unix::{ffi::OsStringExt, fs::PermissionsExt};
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("session.json");

    let root = dir
        .path()
        .join(std::ffi::OsString::from_vec(b"repo-\xff".to_vec()));

    let expected = document(&root);

    Store::new(path.clone()).prepare(expected.clone())().unwrap();
    let loaded = Store::load(&path).unwrap().unwrap();

    assert_eq!(loaded, expected);
    assert_eq!(loaded.tabs[0].root.path().unwrap(), root);
    assert_eq!(
        fs::metadata(path).unwrap().permissions().mode() & 0o777,
        0o600
    );
}

#[test]
fn older_sessions_load_without_stashes_and_invalid_saved_stash_intent_is_rejected() {
    let temporary = tempfile::tempdir().unwrap();
    let expected = document(temporary.path());
    let mut value = serde_json::to_value(&expected).unwrap();

    for tab in value["tabs"].as_array_mut().unwrap() {
        tab.as_object_mut().unwrap().remove("stashes");
    }

    let mut loaded: Document = serde_json::from_value(value).unwrap();

    assert_eq!(loaded, expected);
    loaded.tabs[0].stashes = Some(StashView {
        visible: true,
        selected: Some("a".repeat(40)),
        file: Some(("b".repeat(40), b"a.txt".to_vec())),
        split_diff: true,
        sidebar: 310.,
        detail_fraction: 0.5,
    });
    loaded.validate().unwrap();
    loaded.tabs[0].stashes.as_mut().unwrap().selected = Some("invalid".into());
    assert!(loaded.validate().is_err());
    loaded.tabs[0].stashes.as_mut().unwrap().selected = None;
    loaded.tabs[0].stashes.as_mut().unwrap().file = Some(("b".repeat(40), b"../outside".to_vec()));
    assert!(loaded.validate().is_err());
    loaded.tabs[0].stashes.as_mut().unwrap().file = None;
    loaded.tabs[0].stashes.as_mut().unwrap().sidebar = f32::NAN;
    assert!(loaded.validate().is_err());
}

#[test]
fn graph_intent_round_trips_and_pre_graph_sessions_still_load() {
    let dir = tempfile::tempdir().unwrap();
    let mut doc = document(dir.path());

    let graph = GraphView {
        visible: true,
        reference: Some("refs/tags/v1".into()),
        query: "v1".into(),
        kind: crate::workspace::graph::Kind::Tags,
        details: doc.tabs[0].history.clone(),
        selected: true,
        rows: 500,
        sidebar: 230.,
        detail_fraction: 0.52,
        anchor: Some("2".repeat(40)),
        row: 250,
        offset: 5.,
        horizontal: -25.,
    };

    doc.tabs[0].graph = Some(graph);
    assert!(doc.validate().is_ok());
    assert_eq!(
        serde_json::from_slice::<Document>(&serde_json::to_vec(&doc).unwrap()).unwrap(),
        doc
    );
    let mut old = serde_json::to_value(&doc).unwrap();

    old["tabs"][0].as_object_mut().unwrap().remove("graph");
    let old: Document = serde_json::from_value(old).unwrap();

    assert!(old.tabs[0].graph.is_none());
    assert!(old.validate().is_ok());

    for invalid in [f32::NAN, 37., -1.] {
        let mut bad = doc.clone();

        bad.tabs[0].graph.as_mut().unwrap().offset = invalid;
        assert!(bad.validate().is_err());
    }

    let mut bad = doc;

    bad.tabs[0].graph.as_mut().unwrap().anchor = Some("HEAD".into());
    assert!(bad.validate().is_err());
}
