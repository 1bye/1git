//! Ports source graph reader/filtering cases and exercises retained native workspace state.
use super::*;

use crate::workspace::{
    RepositoryWorkspace, Section,
    tests::{Fixture, contents},
};

use onegit_ui::{GraphViewport, Theme};
use rake::gpui::prelude::*;

fn merge_fixture() -> Fixture {
    let f = Fixture::new();

    f.write("base.rs", "fn main() {}\n");
    f.commit();
    f.git(&["switch", "-c", "feature"]);
    f.write("feature.rs", "pub fn feature() {}\n");
    f.commit();
    f.git(&["tag", "-a", "v1.0", "-m", "Release"]);
    f.git(&["switch", "main"]);
    f.write("main.rs", "pub fn main_work() {}\n");
    f.commit();
    f.git(&["merge", "--no-ff", "feature", "-m", "Merge feature"]);
    f.git(&["update-ref", "refs/remotes/origin/main", "HEAD"]);

    f
}

fn setup(
    f: &Fixture,
) -> (
    gpui::TestAppContext,
    gpui::WindowHandle<RepositoryWorkspace>,
) {
    let mut cx = gpui::TestAppContext::single();

    cx.update(|cx| Theme::light().install(cx));
    let v = cx.open_window(gpui::size(px(1280.), px(820.)), |window, cx| {
        let mut view = RepositoryWorkspace::new(window, cx, None);

        view.process = f.process();
        view.open(f.root.clone(), None, cx);

        view
    });

    draw(&mut cx, v);
    v.update(&mut cx, |view, _, cx| {
        view.change_section(&"graph".into(), cx)
    })
    .unwrap();
    draw(&mut cx, v);

    (cx, v)
}

fn draw(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<RepositoryWorkspace>) {
    for _ in 0..3 {
        cx.run_until_parked();
        cx.update_window(v.into(), |_, window, cx| window.draw(cx).clear(cx))
            .unwrap();
    }

    cx.run_until_parked();
}

fn graph(
    v: gpui::WindowHandle<RepositoryWorkspace>,
    cx: &gpui::TestAppContext,
) -> gpui::Entity<Graph> {
    v.read_with(cx, |v, _| v.graph.clone()).unwrap()
}

#[test]
fn refs_all_merge_parents_and_exact_reference_scope_are_read_only() {
    let f = merge_fixture();
    let source = f.load();
    let before = contents(&f.root);
    let refs = read::references(&source, &Cancellation::default()).unwrap();

    assert_eq!(refs.items.len(), 4);
    assert_eq!(refs.items.last().unwrap().id, "refs/tags/v1.0");
    let branches = source.repository.branches(None).unwrap();

    assert_eq!(
        refs.items[..3].iter().map(|r| &r.id).collect::<Vec<_>>(),
        branches
            .branches
            .iter()
            .map(|b| &b.full_name)
            .collect::<Vec<_>>()
    );
    assert!(
        refs.items
            .iter()
            .any(|r| r.id == "refs/tags/v1.0" && r.kind == CommitRefKind::Tag)
    );
    assert!(
        refs.items
            .iter()
            .any(|r| r.id == "refs/remotes/origin/main" && r.kind == CommitRefKind::Remote)
    );
    let tips = refs.tips(None);
    let all = read::page(&source, &refs, &tips, Vec::new(), &Cancellation::default()).unwrap();

    assert_eq!(all.commits.len(), 4);
    assert_eq!(all.commits[0].parent_oids.len(), 2);
    assert_eq!(all.data.commits()[0].item.references[0].label, "HEAD");
    let tip = refs.tips(Some("refs/heads/feature"));
    let branch = read::page(&source, &refs, &tip, Vec::new(), &Cancellation::default()).unwrap();

    assert_eq!(branch.commits.len(), 2);
    assert_eq!(branch.commits[0].oid, tip[0]);
    assert!(branch.data.lanes() >= 1);
    assert_eq!(contents(&f.root), before);
}

#[test]
fn graph_search_filters_only_refs_and_details_keep_drafts_and_selection_on_refresh() {
    let f = merge_fixture();

    for i in 0..80 {
        f.git(&["commit", "--allow-empty", "-m", &format!("Older {i}")]);
    }

    f.write("base.rs", "fn main() { /* draft */ }\n");
    let (mut cx, v) = setup(&f);
    let graph = graph(v, &cx);
    let before = contents(&f.root);

    v.update(&mut cx, |view, _, cx| {
        view.summary
            .update(cx, |input, cx| input.set_text("Keep my draft", cx))
    })
    .unwrap();
    let selected = graph.read_with(&cx, |view, _| view.commits[80].oid.clone());

    graph.update(&mut cx, |view, cx| {
        view.select(&selected.clone().into(), cx)
    });
    draw(&mut cx, v);
    assert!(graph.read_with(&cx, |view, cx| {
        view.inspector.read(cx).session_preview_ready()
    }));
    let original = graph.read_with(&cx, |view, cx| view.inspector.read(cx).session(cx));
    let state = graph.read_with(&cx, |view, _| view.state.clone());
    let anchor = graph.read_with(&cx, |view, _| view.commits[30].oid.clone());

    state.update(&mut cx, |state, _| {
        state.restore(GraphViewport {
            anchor: Some(anchor.clone().into()),
            row: 30,
            offset: 5.,
            horizontal: 0.,
        })
    });
    draw(&mut cx, v);
    graph.update(&mut cx, |view, cx| {
        view.query
            .update(cx, |input, cx| input.set_text("  V1.0  ", cx));
        view.kind = Kind::Tags;
        view.filter(cx);
        cx.notify();
    });
    draw(&mut cx, v);
    graph.read_with(&cx, |view, _| {
        assert_eq!(view.visible.len(), 1);
        assert_eq!(view.data.len(), 84);
        assert_eq!(view.refs.items[view.visible[0]].label, "v1.0");
    });
    assert_eq!(contents(&f.root), before);
    f.git(&["commit", "--allow-empty", "-m", "New tip"]);
    v.update(&mut cx, |view, _, cx| view.refresh(cx)).unwrap();
    draw(&mut cx, v);
    graph.read_with(&cx, |view, cx| {
        assert_eq!(view.data.len(), 85);
        assert_eq!(view.selected.as_deref(), Some(selected.as_str()));
        assert_eq!(view.inspector.read(cx).session(cx).file, original.file);
        let saved = view.state.read(cx).viewport();

        assert_eq!(saved.anchor.as_deref(), Some(anchor.as_str()));
        assert_eq!(saved.offset, 5.);
    });
    v.update(&mut cx, |view, _, cx| {
        view.change_section(&"changes".into(), cx)
    })
    .unwrap();
    draw(&mut cx, v);
    v.update(&mut cx, |view, _, cx| {
        view.change_section(&"graph".into(), cx)
    })
    .unwrap();
    draw(&mut cx, v);
    assert_eq!(
        v.read_with(&cx, |view, cx| view.summary.read(cx).text().to_owned())
            .unwrap(),
        "Keep my draft"
    );
    assert_eq!(
        graph
            .read_with(&cx, |view, _| view.selected.clone())
            .as_deref(),
        Some(selected.as_str())
    );
}

#[test]
fn superseded_reference_reads_and_repository_replacement_cannot_publish_stale_results() {
    let f = merge_fixture();
    let other = Fixture::new();

    other.write("other.txt", "other\n");
    other.commit();
    let (mut cx, v) = setup(&f);
    let graph = graph(v, &cx);

    graph.update(&mut cx, |view, cx| {
        view.scope(Some("refs/heads/feature".into()), cx);
        view.scope(Some("refs/heads/main".into()), cx);
    });
    draw(&mut cx, v);
    assert_eq!(graph.read_with(&cx, |view, _| view.data.len()), 4);
    graph.update(&mut cx, |view, cx| {
        view.scope(Some("refs/tags/v1.0".into()), cx);
        view.set_source(Some(other.load()), cx);
    });
    draw(&mut cx, v);
    graph.read_with(&cx, |view, _| {
        assert_eq!(view.data.len(), 1);
        assert!(view.reference.is_none());
        assert_eq!(
            view.commits[0].oid,
            other.load().snapshot.status.head.oid.clone().unwrap()
        );
        assert!(view.selected.is_none());
    });
}

#[test]
fn session_restores_graph_filters_panes_viewport_and_immutable_details() {
    let f = merge_fixture();
    let (mut cx, v) = setup(&f);
    let graph = graph(v, &cx);
    let selected = graph.read_with(&cx, |view, _| view.commits[1].oid.clone());

    graph.update(&mut cx, |view, cx| {
        view.select(&selected.clone().into(), cx);
        view.query
            .update(cx, |input, cx| input.set_text("feature", cx));
        view.kind = Kind::Local;
        view.filter(cx);
    });
    draw(&mut cx, v);
    let mut saved = graph.read_with(&cx, |view, cx| view.session(cx));

    saved.visible = true;
    saved.details.split_diff = true;
    saved.sidebar = 260.;
    saved.detail_fraction = 0.6;
    saved.anchor = Some(selected.clone());
    saved.row = 1;
    saved.offset = 7.;
    let bytes = serde_json::to_vec(&saved).unwrap();
    let saved: super::super::tabs::session::GraphView = serde_json::from_slice(&bytes).unwrap();

    let restored = v
        .update(&mut cx, |_, window, cx| {
            cx.new(|cx| {
                let host = onegit_ui::DialogHostState::new(cx);
                let mut view = Graph::new(&host, window, cx);

                view.restore(&saved, window, cx);
                view.set_source(Some(f.load()), cx);
                view.activate(cx);

                view
            })
        })
        .unwrap();

    cx.run_until_parked();
    restored.read_with(&cx, |view, cx| {
        assert_eq!(view.query.read(cx).text(), "feature");
        assert_eq!(view.kind, Kind::Local);
        assert_eq!(view.selected.as_deref(), Some(selected.as_str()));
        assert!(view.inspector.read(cx).session(cx).split_diff);
        assert!(view.inspector.read(cx).session_preview_ready());
        let actual = view.session(cx);

        assert_eq!(actual.sidebar, 260.);
        assert_eq!(actual.detail_fraction, 0.6);
        assert_eq!(actual.anchor, Some(selected));
        assert_eq!(actual.offset, 7.);
    });
    assert!(
        v.read_with(&cx, |view, _| view.section == Section::Graph)
            .unwrap()
    );
}

#[test]
fn graph_branch_form_uses_its_reviewed_commit_and_keeps_dirty_work_and_inspector_state() {
    let f = merge_fixture();

    f.write("base.rs", "dirty working file\n");
    let (mut cx, v) = setup(&f);
    let graph = graph(v, &cx);
    let selected = graph.read_with(&cx, |view, _| view.commits[1].clone());

    v.update(&mut cx, |view, _, cx| {
        view.summary
            .update(cx, |input, cx| input.set_text("Retain draft", cx))
    })
    .unwrap();
    graph.update(&mut cx, |view, cx| {
        view.select(&selected.oid.clone().into(), cx)
    });
    draw(&mut cx, v);

    let details = graph.read_with(&cx, |view, cx| view.inspector.read(cx).session(cx));
    let form = graph.read_with(&cx, |view, _| view.form.clone());
    let inspector = graph.read_with(&cx, |view, _| view.inspector.clone());

    inspector.update(&mut cx, |_, cx| {
        cx.emit(super::super::history::CreateBranch(selected.clone()))
    });
    draw(&mut cx, v);
    assert!(form.read_with(&cx, |form, cx| form.is_open(cx)));
    form.update(&mut cx, |form, cx| {
        form.name.update(cx, |input, cx| input.set_text("main", cx));
        form.submit(cx);
    });
    assert!(!form.read_with(&cx, |form, _| form.busy));

    let before = std::fs::read(f.root.join("base.rs")).unwrap();
    let index = std::fs::read(f.root.join(".git/index")).unwrap();
    let head = f.git(&["rev-parse", "HEAD"]);

    form.update(&mut cx, |form, cx| {
        form.name
            .update(cx, |input, cx| input.set_text("graph/selected", cx));
        form.submit(cx);
    });
    draw(&mut cx, v);
    assert_eq!(
        f.git(&["rev-parse", "graph/selected"]),
        format!("{}\n", selected.oid).into_bytes()
    );
    assert_eq!(f.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(std::fs::read(f.root.join("base.rs")).unwrap(), before);
    assert_eq!(std::fs::read(f.root.join(".git/index")).unwrap(), index);
    assert_eq!(
        v.read_with(&cx, |view, cx| view.summary.read(cx).text().to_owned())
            .unwrap(),
        "Retain draft"
    );
    graph.read_with(&cx, |view, cx| {
        assert_eq!(view.selected.as_deref(), Some(selected.oid.as_str()));
        assert_eq!(view.inspector.read(cx).session(cx).file, details.file);
        assert!(
            view.refs
                .items
                .iter()
                .any(|reference| reference.id == "refs/heads/graph/selected"
                    && reference.oid == selected.oid)
        );
    });
    assert!(!form.read_with(&cx, |form, _| form.busy));
}

#[test]
fn an_open_graph_branch_form_cannot_write_a_replaced_repository() {
    let f = merge_fixture();
    let other = Fixture::new();

    other.write("a.txt", "other\n");
    other.commit();
    let (mut cx, v) = setup(&f);
    let graph = graph(v, &cx);
    let commit = graph.read_with(&cx, |view, _| view.commits[0].clone());
    let form = graph.read_with(&cx, |view, _| view.form.clone());
    let inspector = graph.read_with(&cx, |view, _| view.inspector.clone());

    inspector.update(&mut cx, |_, cx| {
        cx.emit(super::super::history::CreateBranch(commit))
    });
    draw(&mut cx, v);
    v.update(&mut cx, |view, _, cx| {
        view.open(other.root.clone(), None, cx)
    })
    .unwrap();
    draw(&mut cx, v);
    form.update(&mut cx, |form, cx| {
        form.name
            .update(cx, |input, cx| input.set_text("wrong-root", cx));
        form.submit(cx);
    });
    draw(&mut cx, v);

    for fixture in [&f, &other] {
        assert!(
            fixture
                .process()
                .run(onegit_git::GitCommand::new(
                    &fixture.root,
                    ["show-ref", "--verify", "refs/heads/wrong-root"]
                ))
                .is_err()
        );
    }

    assert!(!form.read_with(&cx, |form, _| form.busy));
}

#[test]
fn full_workspace_opens_range_confirmation_from_graph_and_cancels_without_a_write() {
    let f = Fixture::new();

    for name in ["base", "one", "two", "later"] {
        f.write(name, name);
        f.commit();
    }

    let source = f.load();

    let commits: Vec<_> = ["HEAD^", "HEAD^^"]
        .into_iter()
        .map(|oid| std::sync::Arc::new(source.repository.commit(oid, None).unwrap()))
        .collect();

    let old = source.snapshot.status.head.oid.clone();
    let (mut cx, v) = setup(&f);

    for kind in [
        super::super::replay::Kind::Squash,
        super::super::replay::Kind::Reorder,
    ] {
        v.update(&mut cx, |view, window, cx| {
            let event = super::super::replay::Open {
                kind,
                commits: commits.clone(),
            };

            view.open_replay(&event, window, cx);
        })
        .unwrap();
        draw(&mut cx, v);
        v.read_with(&cx, |view, cx| assert!(view.replay.read(cx).is_open(cx)))
            .unwrap();
        cx.update_window(v.into(), |_, window, cx| {
            use gpui::InputEvent as _;
            let keystroke = gpui::Keystroke::parse("escape").unwrap();

            window.dispatch_event(
                gpui::KeyDownEvent {
                    keystroke: keystroke.clone(),
                    is_held: false,
                    prefer_character_input: false,
                }
                .to_platform_input(),
                cx,
            );
            window.dispatch_event(gpui::KeyUpEvent { keystroke }.to_platform_input(), cx);
        })
        .unwrap();
        draw(&mut cx, v);
        v.read_with(&cx, |view, cx| {
            assert!(!view.replay.read(cx).is_open(cx));
            assert!(view.write_job.is_none());
        })
        .unwrap();
    }

    assert_eq!(f.load().snapshot.status.head.oid, old);
    assert!(
        f.git(&["for-each-ref", "refs/1git/squash/", "refs/1git/reorder/"])
            .is_empty()
    );
}
