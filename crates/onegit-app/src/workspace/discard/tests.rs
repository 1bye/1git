//! Source canDiscard and all-list scope contracts use ordinary disposable repositories.
use super::*;
use crate::workspace::tests::Fixture;

#[test]
fn confirmation_paths_are_unique_independent_of_staged_sides_and_untracked_are_separate() {
    let f = Fixture::new();

    f.write("a.txt", "base\n");
    f.commit();
    f.write("a.txt", "staged\n");
    f.git(&["add", "a.txt"]);
    f.write("a.txt", "working\n");
    f.write("new.txt", "new\n");
    let source = f.load();
    let tracked = Selection::new(&source, None, DiscardScope::Tracked).unwrap();

    assert_eq!(tracked.paths, [GitPath::new("a.txt").unwrap()]);
    assert_eq!(tracked.label, "all 1 tracked file");
    assert_eq!(
        Selection::new(&source, None, DiscardScope::Untracked)
            .unwrap()
            .paths,
        [GitPath::new("new.txt").unwrap()]
    );
    assert!(
        Selection::new(
            &source,
            Some(&GitPath::new("new.txt").unwrap()),
            DiscardScope::Tracked
        )
        .is_none()
    );
}

#[test]
fn renamed_and_type_changed_files_disable_the_whole_selected_batch() {
    let f = Fixture::new();

    f.write("a.txt", "base\n");
    f.write("b.txt", "keep\n");
    f.commit();
    f.git(&["mv", "a.txt", "renamed.txt"]);
    f.write("b.txt", "changed\n");
    let source = f.load();

    assert!(Selection::new(&source, None, DiscardScope::Tracked).is_none());
    assert!(
        Selection::new(
            &source,
            Some(&GitPath::new("b.txt").unwrap()),
            DiscardScope::Tracked
        )
        .is_some()
    );
}

#[test]
fn recovery_storage_failure_preserves_files_index_and_reports_no_write() {
    let f = Fixture::new();

    f.write("a.txt", "base\n");
    f.commit();
    f.write("a.txt", "working\n");
    let source = f.load();
    let selection = Selection::new(&source, None, DiscardScope::Tracked).unwrap();
    let parent = f.directory.path().join("not-a-directory");

    std::fs::write(&parent, "block recovery").unwrap();
    let result = run(source, &Action::Discard { selection, parent }, &[]);

    assert!(result.result.unwrap_err().contains("Nothing was discarded"));
    assert_eq!(std::fs::read(f.root.join("a.txt")).unwrap(), b"working\n");
    assert_eq!(f.git(&["show", ":a.txt"]), b"base\n");
    assert!(result.discard_completion.unwrap().recovery.is_none());
}
