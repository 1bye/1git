//! Graph metadata writes retain independent state in duplicate and linked tabs.
use super::tests::{draw, open, setup};
use super::*;
use crate::workspace::{Section, graph, tests::Fixture, write};
use std::time::Duration;

#[test]
fn graph_branch_creation_refreshes_duplicate_and_linked_workspaces_without_switching() {
    let f = Fixture::new();

    f.write("a.txt", "base\n");
    f.commit();
    let linked = f.directory.path().join("linked");

    f.git(&["worktree", "add", "-b", "linked", linked.to_str().unwrap()]);
    f.write("a.txt", "dirty original\n");
    std::fs::write(linked.join("a.txt"), "dirty linked\n").unwrap();
    let (mut cx, v) = setup(&f);
    let a = open(&mut cx, v, &f.root);
    let b = open(&mut cx, v, &f.root);
    let c = open(&mut cx, v, &linked);

    for (tab, draft) in [(&a, "one"), (&b, "two"), (&c, "linked")] {
        tab.update(&mut cx, |view, cx| {
            view.summary
                .update(cx, |input, cx| input.set_text(draft, cx));
            view.change_section(&"graph".into(), cx);
        });
    }

    draw(&mut cx, v);
    let oid = f.load().snapshot.status.head.oid.clone().unwrap();
    let root = f.load().snapshot.repository.root.clone();

    v.update(&mut cx, |_, window, cx| {
        a.update(cx, |view, cx| {
            view.start_write(
                write::Operation::GraphBranch(graph::Submit {
                    root,
                    name: "graph/shared".into(),
                    oid: oid.clone(),
                }),
                window,
                cx,
            )
        });
    })
    .unwrap();
    draw(&mut cx, v);
    cx.executor().advance_clock(Duration::from_millis(500));
    draw(&mut cx, v);

    for (tab, draft, branch) in [
        (&a, "one", "main"),
        (&b, "two", "main"),
        (&c, "linked", "linked"),
    ] {
        tab.read_with(&cx, |view, cx| {
            assert_eq!(view.summary.read(cx).text(), draft);
            assert_eq!(view.section, Section::Graph);

            let RepositoryState::Ready(source) = &view.state else {
                panic!()
            };

            assert_eq!(source.snapshot.status.head.branch.as_deref(), Some(branch));
            assert!(
                source
                    .repository
                    .branches(None)
                    .unwrap()
                    .branches
                    .iter()
                    .any(|b| b.name == "graph/shared" && b.oid == oid)
            );
        });
    }

    assert_eq!(
        std::fs::read(f.root.join("a.txt")).unwrap(),
        b"dirty original\n"
    );
    assert_eq!(
        std::fs::read(linked.join("a.txt")).unwrap(),
        b"dirty linked\n"
    );
}
