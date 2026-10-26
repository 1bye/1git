//! Covers: all patch targets, temporary-index isolation, omission, literal paths and converters.
//! Real: Git CLI and disposable repositories; frozen old-service results also used real Git.
//! Doubles: isolated identity/config and a forbidden converter marker command.
//! Requires: Git and temporary storage; no network or user data.

mod common;

use common::symlink;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use common::{Fixture, files_under};

use onegit_git::{
    Cancellation, DiffOptions, DiffTarget, GitError, PatchOmission, Repository, RepositoryError,
};

use serde_json::{Value, json};

#[test]
fn matches_frozen_legacy_diff_service_results_without_modifying_repositories() {
    let reference: Value = serde_json::from_str(include_str!("diff-reference.json")).unwrap();

    for case in reference["cases"].as_array().unwrap() {
        let fixture = Fixture::new();

        for step in case["steps"].as_array().unwrap() {
            if step["kind"] == "write" {
                fixture.write(
                    step["path"].as_str().unwrap(),
                    step["content"].as_str().unwrap(),
                );
            } else {
                let args: Vec<_> = step["args"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|arg| arg.as_str().unwrap())
                    .collect();

                if args.first() == Some(&"commit") {
                    fixture.commit(args[2]);
                } else {
                    fixture.git_os(args.iter().map(|arg| (*arg).into()));
                }
            }
        }

        let input = &case["options"];
        let target = &input["target"];
        let kind = target["kind"].as_str().unwrap();

        let target = match kind {
            "working" => DiffTarget::Working,
            "staged" => DiffTarget::Staged,
            "changes" => DiffTarget::Changes,
            "commit" => DiffTarget::Commit(target["revision"].as_str().unwrap().into()),
            "range" => DiffTarget::Range {
                base: target["base"].as_str().unwrap().into(),
                head: target["head"].as_str().unwrap().into(),
                merge_base: target["mergeBase"].as_bool().unwrap_or(false),
            },
            other => panic!("unknown reference target {other}"),
        };

        let paths: Option<Vec<PathBuf>> = input["paths"].as_array().map(|paths| {
            paths
                .iter()
                .map(|path| PathBuf::from(path.as_str().unwrap()))
                .collect()
        });

        let options = DiffOptions {
            target,
            paths: paths.as_deref(),
            ignore_whitespace: input["ignoreWhitespace"].as_bool().unwrap_or(false),
            context_lines: input["contextLines"].as_u64().unwrap_or(3) as u32,
        };

        let runner = fixture.process_with_limit(
            case["maxOutputBytes"].as_u64().unwrap_or(64 * 1024 * 1024) as usize,
        );

        let repository = Repository::open(&fixture.root, runner, None).unwrap();
        let before = files_under(&fixture.root);

        let diff = repository
            .diff(options, None)
            .unwrap_or_else(|error| panic!("{}: {error}", case["name"]));

        let mut normalized = json!({
            "patch": diff.patch, "target": input["target"],
            "stats": diff.stats.iter().map(|stat| {
                let mut value = json!({ "path": stat.path.to_str().unwrap(), "addedLines": stat.added_lines, "deletedLines": stat.deleted_lines });

                if let Some(original) = &stat.original_path { value.as_object_mut().unwrap().insert("originalPath".into(), json!(original.to_str().unwrap())); }

                value
            }).collect::<Vec<_>>(),
        });

        if diff.patch_omitted == Some(PatchOmission::TooLarge) {
            normalized
                .as_object_mut()
                .unwrap()
                .insert("patchOmittedReason".into(), json!("too-large"));
        }

        assert_eq!(normalized, case["expected"], "{}", case["name"]);
        assert_read_only(&fixture.root, &before, false);
    }
}

#[test]
fn preserves_binary_and_renamed_paths_and_never_runs_external_converters() {
    let fixture = Fixture::new();

    fixture.write("old\t\nname", "one\ntwo\nthree\nfour\n");
    fs::write(fixture.root.join("binary"), [0, 255, 0]).unwrap();
    fixture.commit("initial");
    fixture.git(&["mv", "--", "old\t\nname", "new\t\nname"]);
    fixture.write("new\t\nname", "one\ntwo\nthree\nfour\nfive\n");
    fs::write(fixture.root.join("binary"), [0, 254, 0]).unwrap();
    fixture.write(".gitattributes", "* diff=forbidden\n");
    fixture.git(&[
        "config",
        "diff.forbidden.command",
        "touch converter-was-run",
    ]);
    fixture.git(&[
        "config",
        "diff.forbidden.textconv",
        "touch converter-was-run",
    ]);

    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();
    let before = files_under(&fixture.root);

    let diff = repository
        .diff(DiffOptions::new(DiffTarget::Changes), None)
        .unwrap();

    let renamed = diff
        .stats
        .iter()
        .find(|stat| stat.path == Path::new("new\t\nname"))
        .unwrap();

    let binary = diff
        .stats
        .iter()
        .find(|stat| stat.path == Path::new("binary"))
        .unwrap();

    assert_eq!(
        renamed.original_path.as_deref(),
        Some(Path::new("old\t\nname"))
    );
    assert_eq!(renamed.added_lines, Some(1));
    assert!(binary.added_lines.is_none());
    assert!(!fixture.root.join("converter-was-run").exists());
    assert_read_only(&fixture.root, &before, false);
}

#[test]
fn handles_split_indexes_and_rejects_cancelled_or_invalid_requests() {
    let fixture = Fixture::new();

    fixture.write("file", "initial\n");
    fixture.commit("initial");
    fixture.git(&["update-index", "--split-index"]);
    fixture.write("file", "edited\n");

    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();
    let before = files_under(&fixture.root);

    assert!(
        repository
            .diff(DiffOptions::new(DiffTarget::Changes), None)
            .unwrap()
            .patch
            .contains("+edited")
    );
    assert_read_only(&fixture.root, &before, true);

    let cancellation = Cancellation::default();

    cancellation.cancel();

    assert!(matches!(
        repository.diff(DiffOptions::new(DiffTarget::Changes), Some(&cancellation)),
        Err(RepositoryError::Git(GitError::Cancelled))
    ));
    assert!(matches!(
        repository.diff(DiffOptions::new(DiffTarget::Commit("--help".into())), None),
        Err(RepositoryError::InvalidInput(_))
    ));
}

#[test]
fn bounds_aggregate_untracked_patches_and_previews_symlinks_without_reading_their_target() {
    let fixture = Fixture::new();

    fixture.write("one", &("x".repeat(1000) + "\n"));
    fixture.write("two", &("y".repeat(1000) + "\n"));

    let repository =
        Repository::open(&fixture.root, fixture.process_with_limit(2048), None).unwrap();

    let diff = repository
        .diff(DiffOptions::new(DiffTarget::Working), None)
        .unwrap();

    assert_eq!(diff.patch_omitted, Some(PatchOmission::TooLarge));
    assert!(diff.patch.is_empty());

    fs::remove_file(fixture.root.join("one")).unwrap();
    fs::remove_file(fixture.root.join("two")).unwrap();

    let outside = fixture.temporary.path().join("outside");

    fs::write(&outside, "DO NOT PREVIEW THIS TARGET").unwrap();
    symlink(&outside, fixture.root.join("link")).unwrap();

    let diff = repository
        .diff(DiffOptions::new(DiffTarget::Working), None)
        .unwrap();

    assert!(diff.patch.contains("new file mode 120000"));
    assert!(!diff.patch.contains("DO NOT PREVIEW THIS TARGET"));
}

fn assert_read_only(
    root: &Path,
    before: &BTreeMap<PathBuf, (Vec<u8>, SystemTime)>,
    split_index: bool,
) {
    let after = files_under(root);

    assert!(after.len() == before.len(), "repository file count changed");

    for (path, (bytes, modified)) in before {
        let (actual, timestamp) = after
            .get(path)
            .unwrap_or_else(|| panic!("missing {}", path.display()));

        assert!(actual == bytes, "contents changed: {}", path.display());

        // Git freshens shared-index usage mtimes even for read-only commands.
        if split_index
            && path.parent() == Some(Path::new(".git"))
            && path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("sharedindex.")
        {
            assert!(
                timestamp >= modified,
                "shared-index timestamp moved backwards"
            );
        } else {
            assert!(timestamp == modified, "mtime changed: {}", path.display());
        }
    }
}
