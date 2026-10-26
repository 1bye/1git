use super::*;

#[test]
fn public_review_returns_the_exact_unpublished_tip_without_mutating_staged_or_working_data() {
    let fixture = Fixture::new();

    fixture.write("file", "base\n");
    fixture.commit("parent");

    let parent = fixture.git(&["rev-parse", "HEAD"]);

    fixture.write("file", "original\n");
    fixture.commit("Original\n\nDetails");
    fixture.write("file", "staged\n");
    fixture.git(&["add", "file"]);
    fixture.write("file", "working\n");

    let repository = open(&fixture);
    let input = request(&repository, &[]);
    let index = fs::read(fixture.root.join(".git/index")).unwrap();
    let refs = fixture.git(&["show-ref"]);
    let working = unchanged_working(&fixture);

    let reviewed = repository
        .review_last_commit(&input.expected, None)
        .unwrap();

    assert_eq!(Some(&reviewed.oid), input.expected.oid.as_ref());
    assert_eq!(
        reviewed.parent_oids,
        vec![std::str::from_utf8(&parent).unwrap().trim().to_owned()]
    );
    assert_eq!(reviewed.summary, "Original");
    assert_eq!(reviewed.body, "Original\n\nDetails");
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
    assert_eq!(fixture.git(&["show-ref"]), refs);
    working();
}

#[test]
fn amend_keeps_original_changes_parent_author_and_excluded_staging_with_a_new_committer() {
    let fixture = Fixture::new();

    fixture.write("file", "base\n");
    fixture.commit("parent");
    let parent = fixture.git(&["rev-parse", "HEAD"]);

    fixture.write("file", "original\n");
    fixture.write("excluded", "base\n");
    fixture.write("original-only", "retain\n");
    fixture.commit("original");
    let old_head = fixture.git(&["rev-parse", "HEAD"]);
    let author = fixture.git(&["show", "-s", "--format=%an <%ae> %aI"]);
    let count = fixture.git(&["rev-list", "--count", "HEAD"]);

    fixture.write("file", "selected\n");
    fixture.write("new", "new\n");
    fixture.write("excluded", "staged excluded\n");
    fixture.git(&["add", "excluded"]);
    fixture.write("excluded", "working excluded\n");
    let runner = process(&fixture, "git").with_environment([
        ("GIT_COMMITTER_NAME".into(), "New Committer".into()),
        (
            "GIT_COMMITTER_EMAIL".into(),
            "new-committer@example.invalid".into(),
        ),
    ]);

    let repository = Repository::open(&fixture.root, runner, None).unwrap();
    let mut input = request(&repository, &["file", "new"]);

    input.amend = true;
    let working = unchanged_working(&fixture);
    let result = repository.commit_selected_files(&input, None).unwrap();

    assert_eq!(result.outcome, CommitOutcome::Committed);
    assert!(result.warning.is_none());
    assert_eq!(fixture.git(&["rev-list", "--count", "HEAD"]), count);
    assert_eq!(fixture.git(&["rev-parse", "HEAD^"]), parent);
    assert_eq!(
        fixture.git(&["show", "-s", "--format=%an <%ae> %aI"]),
        author
    );
    assert_eq!(
        fixture.git(&["show", "-s", "--format=%cn <%ce>"]),
        b"New Committer <new-committer@example.invalid>\n"
    );

    for (path, contents) in [
        ("file", "selected\n"),
        ("new", "new\n"),
        ("original-only", "retain\n"),
        ("excluded", "base\n"),
    ] {
        assert_eq!(
            fixture.git(&["show", &format!("HEAD:{path}")]),
            contents.as_bytes()
        );
    }

    assert_eq!(fixture.git(&["show", ":excluded"]), b"staged excluded\n");
    assert_eq!(
        fixture.git(&["for-each-ref", "--format=%(objectname)", "refs/1git/amend/"]),
        old_head
    );
    working();
}

#[test]
fn amend_selected_lines_and_linked_root_commit_preserve_unchecked_work() {
    let fixture = Fixture::new();

    fixture.write("partial", "one\ntwo\nthree\n");
    fixture.commit("original");
    fixture.write("partial", "ONE\ntwo\nTHREE\n");
    fixture.write("excluded", "staged\n");
    fixture.git(&["add", "excluded"]);
    let repository = open(&fixture);
    let mut input = partial_request(&repository, "partial", &["-:1", "+:1"]);

    input.amend = true;
    let working = unchanged_working(&fixture);

    repository.commit_selected_files(&input, None).unwrap();
    assert_eq!(fixture.git(&["show", "HEAD:partial"]), b"ONE\ntwo\nthree\n");
    assert!(
        fixture
            .git(&["diff", "--cached", "--", "partial"])
            .is_empty()
    );
    assert_eq!(fixture.git(&["show", ":excluded"]), b"staged\n");
    assert!(
        fixture
            .git(&["ls-tree", "--name-only", "HEAD", "excluded"])
            .is_empty()
    );
    assert_eq!(fixture.git(&["rev-list", "--count", "HEAD"]), b"1\n");
    working();
    let main = fixture.git(&["rev-parse", "HEAD"]);
    let linked = fixture.temporary.path().join("linked");

    fixture.git_os([
        "worktree".into(),
        "add".into(),
        "-b".into(),
        "feature".into(),
        linked.clone().into_os_string(),
    ]);
    let repository = Repository::open(&linked, fixture.process(), None).unwrap();
    let mut input = request(&repository, &[]);

    input.amend = true;
    input.message = "Worktree message".into();
    let result = repository.commit_selected_files(&input, None).unwrap();

    assert_eq!(
        result.snapshot.unwrap().status.head.branch.as_deref(),
        Some("feature")
    );
    assert_eq!(fixture.git(&["rev-parse", "HEAD"]), main);
    assert_eq!(
        fs::read(linked.join("partial")).unwrap(),
        b"ONE\ntwo\nthree\n"
    );
}

#[test]
fn published_and_stale_amends_are_refused_before_recovery_refs_or_index_changes() {
    let fixture = Fixture::new();

    fixture.write("file", "base\n");
    fixture.commit("base");
    let remote = fixture.temporary.path().join("remote.git");

    fixture.git_os([
        "init".into(),
        "--bare".into(),
        remote.clone().into_os_string(),
    ]);
    fixture.git_os([
        "remote".into(),
        "add".into(),
        "origin".into(),
        remote.into_os_string(),
    ]);
    fixture.git(&["push", "origin", "main"]);
    fixture.write("selected", "selected\n");
    fixture.git(&["add", "selected"]);
    let repository = open(&fixture);
    let mut input = request(&repository, &["selected"]);

    input.amend = true;
    let index = fs::read(fixture.root.join(".git/index")).unwrap();

    assert!(
        repository
            .commit_selected_files(&input, None)
            .unwrap_err()
            .to_string()
            .contains("published")
    );
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
    assert_eq!(
        fixture.git(&["rev-parse", "HEAD"]),
        format!("{}\n", input.expected.oid.as_ref().unwrap()).as_bytes()
    );
    fixture.commit("next");
    let next = fixture.git(&["rev-parse", "HEAD"]);

    assert!(repository.commit_selected_files(&input, None).is_err());
    assert_eq!(fixture.git(&["rev-parse", "HEAD"]), next);
    assert!(
        fixture
            .git(&["for-each-ref", "refs/1git/amend/"])
            .is_empty()
    );
}

#[test]
fn amend_refuses_unborn_detached_active_and_merge_tips() {
    let fixture = Fixture::new();
    let repository = open(&fixture);
    let mut input = request(&repository, &[]);

    input.amend = true;
    assert!(repository.commit_selected_files(&input, None).is_err());
    fixture.write("file", "base\n");
    fixture.commit("base");
    fixture.git(&["checkout", "--detach"]);
    let mut input = request(&repository, &[]);

    input.amend = true;
    assert!(repository.commit_selected_files(&input, None).is_err());
    fixture.git(&["checkout", "main"]);
    let mut input = request(&repository, &[]);

    input.amend = true;
    fixture.write(
        ".git/MERGE_HEAD",
        &format!("{}\n", input.expected.oid.as_ref().unwrap()),
    );
    assert!(repository.commit_selected_files(&input, None).is_err());
    fs::remove_file(fixture.root.join(".git/MERGE_HEAD")).unwrap();
    fixture.git(&["checkout", "-b", "other"]);
    fixture.write("other", "other\n");
    fixture.commit("other");
    fixture.git(&["checkout", "main"]);
    fixture.git(&["merge", "--no-ff", "-m", "merge", "other"]);
    let mut input = request(&repository, &[]);

    input.amend = true;
    assert!(
        repository
            .commit_selected_files(&input, None)
            .unwrap_err()
            .to_string()
            .contains("merge")
    );
    assert_eq!(
        fixture.git(&["rev-parse", "HEAD"]),
        format!("{}\n", input.expected.oid.unwrap()).as_bytes()
    );
    assert!(
        fixture
            .git(&["for-each-ref", "refs/1git/amend/"])
            .is_empty()
    );
}
