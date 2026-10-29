//! Covers: legacy ref-parser results, native NUL framing and malformed-read rejection.
//! Real: ref/worktree parsers against frozen TypeScript outputs.
//! Doubles: synthetic Git output records; no processes or services.
//! Requires: none.

use serde_json::{Value, json};

use super::{BranchKind, TagKind, parse_branches, parse_stashes, parse_tags, parse_worktrees};

#[test]
fn matches_all_frozen_legacy_reference_parsers() {
    let reference: Value = serde_json::from_str(&if cfg!(windows) {
        include_str!("refs-reference.json")
            .replace(r"\u0000/repo", r"\u0000C:/repo")
            .replace(r#": "/repo"#, r#": "C:/repo"#)
            .replace("worktree /tmp", "worktree C:/tmp")
            .replace(r#": "/tmp"#, r#": "C:/tmp"#)
    } else {
        include_str!("refs-reference.json").to_owned()
    })
    .unwrap();

    for case in reference["cases"].as_array().unwrap() {
        let bytes = case["input"].as_str().unwrap().as_bytes();

        let actual = match case["kind"].as_str().unwrap() {
            "branches" => {
                let collection = parse_branches(bytes).unwrap();

                let branches: Vec<Value> = collection.branches.iter().map(|branch| json!({
                    "fullName": branch.full_name, "name": branch.name, "oid": branch.oid,
                    "checkedOut": branch.checked_out, "type": if branch.kind == BranchKind::Local { "local" } else { "remote" },
                    "remote": branch.remote, "upstream": branch.upstream,
                    "upstreamRemote": branch.upstream_remote, "upstreamRef": branch.upstream_ref,
                    "ahead": branch.ahead, "behind": branch.behind, "committedAt": branch.committed_at,
                    "summary": branch.summary, "worktreePath": branch.worktree_path.as_ref().map(|path| path.to_str().unwrap()),
                })).collect();

                json!({ "branches": branches, "current": collection.current })
            }
            "tags" => json!(parse_tags(bytes).unwrap().iter().map(|tag| json!({
                "name": tag.name, "oid": tag.oid, "targetOid": tag.target_oid,
                "type": if tag.kind == TagKind::Annotated { "annotated" } else { "lightweight" },
                "createdAt": tag.created_at, "message": tag.message,
            })).collect::<Vec<_>>()),
            "stashes" => json!(parse_stashes(bytes).unwrap().iter().map(|stash| json!({
                "reference": stash.reference, "oid": stash.oid, "createdAt": stash.created_at, "summary": stash.summary,
            })).collect::<Vec<_>>()),
            "worktrees" => json!(parse_worktrees(bytes).unwrap().iter().map(|worktree| json!({
                "path": worktree.path.to_str().unwrap(), "headOid": worktree.head_oid,
                "branch": worktree.branch, "detached": worktree.detached, "locked": worktree.locked,
                "lockReason": worktree.lock_reason, "prunable": worktree.prunable, "pruneReason": worktree.prune_reason,
            })).collect::<Vec<_>>()),
            other => panic!("unknown reference kind {other}"),
        };

        assert_eq!(actual, case["expected"], "{}", case["kind"]);
    }
}

#[test]
fn preserves_newlines_inside_native_ref_fields_and_rejects_truncation() {
    let fields = [
        "refs/heads/main",
        "main",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "*",
        "",
        "",
        "",
        "Subject",
        if cfg!(windows) {
            "C:/repo\nwith newline"
        } else {
            "/repo\nwith newline"
        },
        "",
        "",
    ];

    let input = fields.join("\0") + "\0\n";
    let collection = parse_branches(input.as_bytes()).unwrap();

    assert_eq!(
        collection.branches[0]
            .worktree_path
            .as_ref()
            .unwrap()
            .to_str(),
        Some(if cfg!(windows) {
            "C:/repo\nwith newline"
        } else {
            "/repo\nwith newline"
        })
    );
    assert!(parse_branches(b"refs/heads/main\0main\n").is_err());
    assert!(parse_tags(b"v1\0").is_err());
    assert!(parse_tags(&[0; 6]).is_err());
    assert!(parse_stashes(b"stash@{0}\0").is_err());
    assert!(parse_stashes(&[0; 4]).is_err());
    assert!(parse_worktrees(b"worktree /repo\0HEAD truncated\0").is_err());
}
