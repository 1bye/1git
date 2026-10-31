use super::*;

fn branch(name: &str, kind: BranchKind) -> Branch {
    Branch {
        name: name.into(),
        full_name: format!(
            "refs/{}/{}",
            if kind == BranchKind::Local {
                "heads"
            } else {
                "remotes"
            },
            name
        ),
        oid: "1".repeat(40),
        kind,
        checked_out: false,
        remote: None,
        upstream: None,
        upstream_remote: None,
        upstream_ref: None,
        ahead: 0,
        behind: 0,
        committed_at: None,
        summary: String::new(),
        worktree_path: None,
    }
}

#[test]
fn current_first_search_is_case_insensitive_and_tracked_remote_refs_are_hidden() {
    let mut main = branch("main", BranchKind::Local);

    main.upstream = Some("origin/main".into());
    main.upstream_remote = Some("origin".into());
    let mut remote = branch("origin/main", BranchKind::Remote);

    remote.remote = Some("origin".into());
    let mut other = branch("origin/feature", BranchKind::Remote);

    other.remote = Some("origin".into());
    let data = BranchCollection {
        current: Some("main".into()),
        branches: vec![branch("feature/UI", BranchKind::Local), main, remote, other],
    };

    assert_eq!(visible(&data, "", false), vec![1, 0, 3]);
    assert_eq!(visible(&data, " UI ", false), vec![0]);
    assert!(visible(&data, "absent", true).is_empty());
    assert_eq!(remote_target(&data.branches[3], &data).unwrap(), "feature");
}

#[test]
fn remote_tracking_name_preserves_slashes_and_rejects_local_collisions() {
    let mut remote = branch("origin/feature/UI", BranchKind::Remote);

    remote.remote = Some("origin".into());
    let mut data = BranchCollection {
        current: None,
        branches: vec![remote.clone()],
    };

    assert_eq!(remote_target(&remote, &data).unwrap(), "feature/UI");
    data.branches.push(branch("feature/UI", BranchKind::Local));
    assert!(
        remote_target(&remote, &data)
            .unwrap_err()
            .contains("already exists")
    );
    remote.remote = Some("other".into());
    assert!(remote_target(&remote, &data).is_err());
}

#[test]
fn relative_commit_ages_match_source_numeric_auto_labels() {
    let now = chrono::DateTime::parse_from_rfc3339("2026-09-26T12:00:00Z")
        .unwrap()
        .timestamp_millis();

    assert_eq!(commit_age(None, now), "");
    assert_eq!(commit_age(Some("invalid"), now), "");

    for (date, label) in [
        ("2026-09-26T12:00:00Z", "just now"),
        ("2026-09-26T10:00:00Z", "2 hours ago"),
        ("2026-09-25T12:00:00Z", "yesterday"),
        ("2026-09-26T12:01:00Z", "in 1 minute"),
    ] {
        assert_eq!(commit_age(Some(date), now), label);
    }
}
