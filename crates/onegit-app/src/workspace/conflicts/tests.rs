//! Source preview cases and real Git writes against disposable repositories.
use super::*;
use crate::workspace::{read as workspace_read, tests::Fixture};
use onegit_git::{Cancellation, ConflictSide, FileStatus, GitCommand, OperationState};

pub(in crate::workspace) fn paused(rebase: bool) -> Fixture {
    paused_path(rebase, std::path::Path::new("shared.txt"))
}

fn paused_path(rebase: bool, path: &std::path::Path) -> Fixture {
    let f = Fixture::new();

    std::fs::write(f.root.join(path), "base\n").unwrap();
    f.write("keep.txt", "keep\n");
    f.commit();
    f.git(&["switch", "-c", "topic"]);
    std::fs::write(f.root.join(path), "theirs\n").unwrap();
    f.commit();
    f.git(&["switch", "main"]);
    std::fs::write(f.root.join(path), "ours\n").unwrap();
    f.commit();
    let process = f.process();

    assert!(
        process
            .run(GitCommand::new(
                &f.root,
                if rebase {
                    vec!["rebase", "topic"]
                } else {
                    vec!["merge", "topic"]
                }
            ))
            .is_err()
    );

    f
}

fn loaded(f: &Fixture) -> Arc<Loaded> {
    workspace_read::load(&f.root, f.process(), &Cancellation::default()).unwrap()
}

fn preview(source: &Loaded) -> Preview {
    match super::preview(
        &source.repository,
        &onegit_git::GitPath::new("shared.txt").unwrap(),
        &Cancellation::default(),
    )
    .unwrap()
    {
        workspace_read::Preview::Conflict(preview) => *preview,
        _ => panic!("expected text conflict"),
    }
}

#[test]
fn source_marker_cases_keep_multiple_and_incomplete_blocks_unresolved() {
    assert_eq!(
        markers(
            "a << 7;\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> topic\n<<<<<<<< HEAD\na\n========\nb\n>>>>>>>> incoming\n"
        ),
        (2, true)
    );

    for marker in ["=======\n", "||||||| base\n", ">>>>>>> other\n"] {
        assert_eq!(markers(marker), (0, true));
    }

    assert_eq!(markers("resolved\r\n"), (0, false));
}

#[test]
fn comparison_retains_markers_context_unicode_and_bounds_without_mutating_input() {
    let source = "\u{feff}const café = 1;\r\n";
    let result = "\u{feff}const café = 2;\r\n";

    let patch = read::compare(source, result, &Cancellation::default())
        .unwrap()
        .unwrap();

    assert!(patch.patch().contains("café = 2;\r"));
    assert!(
        read::compare(source, source, &Cancellation::default())
            .unwrap()
            .is_none()
    );
    assert!(read::compare("a", &"x".repeat(4001), &Cancellation::default()).is_err());
    assert!(read::compare("a", &"line\n".repeat(2001), &Cancellation::default()).is_err());
    let lines = (0..120)
        .map(|index| format!("context {index}\n"))
        .collect::<String>();

    let result = lines
        .replace(
            "context 20\n",
            "<<<<<<< HEAD\ncontext 20\n=======\nincoming\n>>>>>>> topic\n",
        )
        .replace("context 100\n", "changed\n");

    let patch = read::compare(&lines, &result, &Cancellation::default())
        .unwrap()
        .unwrap();

    assert!(patch.patch().contains("+<<<<<<< HEAD"));
    assert_eq!(patch.patch().matches("@@ -").count(), 2);
    assert!(!patch.patch().contains(" context 60\n"));
}

#[test]
fn source_manual_resolution_stages_only_reviewed_file_and_never_continues() {
    let f = paused(false);

    f.write("keep.txt", "unrelated\n");
    f.git(&["add", "keep.txt"]);
    f.write("shared.txt", "resolved\n");
    let source = loaded(&f);
    let before = f.git(&["rev-parse", "HEAD"]);
    let action = preview(&source).resolve(None);
    let outcome = run(source, &action, &[]);

    assert!(outcome.result.is_ok());
    assert_eq!(f.git(&["rev-parse", "HEAD"]), before);
    assert!(f.git(&["ls-files", "--unmerged"]).is_empty());
    assert_eq!(f.git(&["show", ":keep.txt"]), b"unrelated\n");
    assert_eq!(
        outcome.loaded.unwrap().snapshot.operation,
        OperationState::Merge
    );
}

#[test]
fn merge_and_rebase_resolve_reviewed_sides_then_continue_or_abort_separately() {
    for rebase in [false, true] {
        let f = paused(rebase);
        let source = loaded(&f);
        let preview = preview(&source);

        assert_eq!(preview.ours.label.starts_with("Upstream"), rebase);
        assert_eq!(preview.theirs.label.starts_with("Replayed"), rebase);
        let action = preview.resolve(Some(ConflictSide::Theirs));
        let outcome = run(source, &action, &[]);

        assert!(outcome.result.is_ok(), "{:?}", outcome.result);
        let source = outcome.loaded.unwrap();

        assert!(
            source
                .files
                .iter()
                .all(|file| file.status != FileStatus::Unmerged)
        );
        assert!(can_continue(&source.snapshot));
        let action = finish_request(&source.snapshot, FinishKind::Continue).unwrap();
        let outcome = run(source, &action, &[]);

        assert!(outcome.result.is_ok(), "{:?}", outcome.result);
        assert_eq!(
            outcome.loaded.unwrap().snapshot.operation,
            OperationState::Normal
        );

        let f = paused(rebase);
        let source = loaded(&f);
        let action = finish_request(&source.snapshot, FinishKind::Abort).unwrap();
        let outcome = run(source, &action, &[]);

        assert!(outcome.result.is_ok(), "{:?}", outcome.result);
        assert_eq!(
            outcome.loaded.unwrap().snapshot.operation,
            OperationState::Normal
        );
        assert_eq!(std::fs::read(f.root.join("shared.txt")).unwrap(), b"ours\n");
    }
}

#[test]
fn stale_edits_and_operation_identity_reject_and_refresh_without_retrying() {
    let f = paused(false);
    let source = loaded(&f);
    let action = preview(&source).resolve(Some(ConflictSide::Ours));

    f.write("shared.txt", "new edits\n");
    let outcome = run(source, &action, &[]);

    assert!(outcome.result.is_err());
    assert_eq!(
        std::fs::read(f.root.join("shared.txt")).unwrap(),
        b"new edits\n"
    );
    assert!(!f.git(&["ls-files", "--unmerged"]).is_empty());
    let source = outcome.loaded.unwrap();
    let mut action = finish_request(&source.snapshot, FinishKind::Abort).unwrap();

    if let Action::Finish(request) = &mut action {
        request.token = "stale".into();
    }

    let outcome = run(source, &action, &[]);

    assert!(outcome.result.is_err());
    assert_eq!(
        outcome.loaded.unwrap().snapshot.operation,
        OperationState::Merge
    );
}

#[test]
fn indexed_previews_and_resolution_keep_literal_unicode_and_pattern_paths() {
    use std::path::Path;
    let bytes = "shared-été[1].txt".as_bytes();
    let native = Path::new(std::str::from_utf8(bytes).unwrap());
    let f = paused_path(false, native);
    let source = loaded(&f);

    let result = super::preview(
        &source.repository,
        &onegit_git::GitPath::new(bytes).unwrap(),
        &Cancellation::default(),
    )
    .unwrap();

    let workspace_read::Preview::Conflict(preview) = result else {
        panic!("text conflict");
    };

    assert!(preview.ours.usable && preview.theirs.usable);
    let outcome = run(source, &preview.resolve(Some(ConflictSide::Theirs)), &[]);

    assert!(outcome.result.is_ok(), "{:?}", outcome.result);
    assert_eq!(std::fs::read(f.root.join(native)).unwrap(), b"theirs\n");
    assert_eq!(
        outcome.loaded.unwrap().snapshot.operation,
        OperationState::Merge
    );
}
