use super::*;

#[test]
fn partial_multihunk_selection_accounts_for_omitted_additions_and_deletions() {
    let fixture = Fixture::new();
    let mut base: Vec<_> = (1..=30).map(|index| format!("line {index}")).collect();

    fixture.write("multi", &format!("{}\n", base.join("\n")));
    fixture.commit("base");
    fixture.write(
        "multi",
        &format!(
            "extra\n{}\nLAST\n{}\n",
            base[..27].join("\n"),
            base[28..].join("\n")
        ),
    );
    let repository = open(&fixture);
    let input = partial_request(&repository, "multi", &["-:28", "+:29"]);
    let working = unchanged_working(&fixture);

    repository.commit_selected_files(&input, None).unwrap();
    base[27] = "LAST".into();
    assert_eq!(
        fixture.git(&["show", "HEAD:multi"]),
        format!("{}\n", base.join("\n")).as_bytes()
    );
    working();
}

#[test]
fn partial_unborn_file_preserves_missing_newline_and_partial_delete_keeps_the_file() {
    let fixture = Fixture::new();

    fixture.write("new file", "first\nsecond");
    let repository = open(&fixture);
    let working = unchanged_working(&fixture);

    repository
        .commit_selected_files(&partial_request(&repository, "new file", &["+:2"]), None)
        .unwrap();
    assert_eq!(fixture.git(&["show", "HEAD:new file"]), b"second");
    working();

    let fixture = Fixture::new();

    fixture.write("deleted", "one\ntwo\nthree\n");
    fixture.commit("base");
    fs::remove_file(fixture.root.join("deleted")).unwrap();
    let repository = open(&fixture);

    repository
        .commit_selected_files(&partial_request(&repository, "deleted", &["-:2"]), None)
        .unwrap();
    assert_eq!(fixture.git(&["show", "HEAD:deleted"]), b"one\nthree\n");
    assert!(fixture.git(&["diff", "--cached"]).is_empty());
    assert!(!fixture.root.join("deleted").exists());
}

#[test]
fn changed_patches_and_unknown_keys_leave_the_exact_real_index_and_head_unchanged() {
    let fixture = Fixture::new();

    fixture.write("file", "one\ntwo\n");
    fixture.commit("base");
    fixture.write("file", "ONE\nTWO\n");
    let repository = open(&fixture);
    let stale = partial_request(&repository, "file", &["+:1"]);
    let head = fixture.git(&["rev-parse", "HEAD"]);
    let index = fs::read(fixture.root.join(".git/index")).unwrap();

    fixture.write("file", "different\n");
    assert!(
        repository
            .commit_selected_files(&stale, None)
            .unwrap_err()
            .to_string()
            .contains("changed since")
    );
    let invalid = partial_request(&repository, "file", &["+:999"]);

    assert!(repository.commit_selected_files(&invalid, None).is_err());
    assert_eq!(fixture.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
}
