//! Covers: metadata/raw-diff parser parity, framing errors and legacy Unicode whitespace.
//! Real: native parsers compared with frozen TypeScript/JavaScript outputs.
//! Doubles: synthetic byte records; no processes or services.
//! Requires: none.

use serde_json::{Value, json};

use super::{CommitFile, parse_commit_files, parse_file_history, parse_history};
use crate::{FileStatus, output};

fn normalize_file(file: &CommitFile) -> Value {
    let mut value = json!({
        "path": file.path.to_str().unwrap(), "beforeOid": file.before_oid, "afterOid": file.after_oid,
        "status": match file.status {
            FileStatus::Added => "A", FileStatus::Deleted => "D", FileStatus::Modified => "M",
            FileStatus::Renamed => "R", FileStatus::Copied => "C", FileStatus::TypeChanged => "T",
            status => panic!("unexpected committed status {status:?}"),
        },
    });

    if let Some(path) = &file.original_path {
        value
            .as_object_mut()
            .unwrap()
            .insert("originalPath".into(), json!(path.to_str().unwrap()));
    }

    value
}

#[test]
fn matches_frozen_legacy_metadata_and_raw_file_records() {
    let reference: Value = serde_json::from_str(include_str!("history-reference.json")).unwrap();

    for case in reference["cases"].as_array().unwrap() {
        let commits = parse_history(case["input"].as_str().unwrap().as_bytes()).unwrap();

        let actual: Vec<_> = commits
            .iter()
            .map(|commit| {
                json!({
                    "oid": commit.oid, "parentOids": commit.parent_oids,
                    "author": { "name": commit.author.name, "email": commit.author.email },
                    "committer": { "name": commit.committer.name, "email": commit.committer.email },
                    "authoredAt": commit.authored_at, "committedAt": commit.committed_at,
                    "summary": commit.summary, "body": commit.body,
                })
            })
            .collect();

        assert_eq!(json!(actual), case["expected"]);
    }

    for case in reference["rawCases"].as_array().unwrap() {
        let files = parse_commit_files(case["input"].as_str().unwrap().as_bytes()).unwrap();

        assert_eq!(
            json!(files.iter().map(normalize_file).collect::<Vec<_>>()),
            case["expected"]
        );
    }

    for case in reference["whitespace"].as_array().unwrap() {
        let input = case["input"].as_str().unwrap();

        assert_eq!(output::trim(input), case["trim"].as_str().unwrap());
        assert_eq!(output::trim_end(input), case["trimEnd"].as_str().unwrap());
    }
}

#[test]
fn rejects_incomplete_records_and_consumes_file_history_paths_by_shape() {
    assert!(parse_history(b"not complete\0").is_err());
    assert!(parse_commit_files(b":100644 100644 truncated").is_err());

    let oid = "a".repeat(40);
    let record = format!("{oid}\0\n:100644 100644 {oid} {oid} R100\0{oid}\0:looks like a header\0");
    let files = parse_file_history(record.as_bytes()).unwrap();

    assert_eq!(
        files[0].1.original_path.as_ref().unwrap().to_str(),
        Some(oid.as_str())
    );
    assert_eq!(files[0].1.path.to_str(), Some(":looks like a header"));
    assert!(parse_file_history(record.trim_end_matches('\0').as_bytes()).is_err());
}
