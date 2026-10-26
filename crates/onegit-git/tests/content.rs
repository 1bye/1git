//! Covers: byte-preserving working/revision/blob previews, 10 MiB bounds and path containment.
//! Real: Git CLI, filesystem reads, descriptor traversal and disposable repositories.
//! Doubles: isolated Git identity/configuration; no services or user data.
//! Requires: Git and writable Unix temporary storage; no network.

mod common;

use common::symlink;
use std::fs;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use common::{Fixture, files_under};
use onegit_git::{Cancellation, FileData, FileSource, GitError, Repository, RepositoryError};
use serde_json::{Value, json};

#[test]
fn matches_frozen_legacy_content_encodings_and_byte_lengths() {
    let reference: Value = serde_json::from_str(include_str!("content-reference.json")).unwrap();
    let fixture = Fixture::new();

    for case in reference["cases"].as_array().unwrap() {
        let hex = case["bytesHex"].as_str().unwrap();

        let bytes: Vec<_> = (0..hex.len())
            .step_by(2)
            .map(|offset| u8::from_str_radix(&hex[offset..offset + 2], 16).unwrap())
            .collect();

        fs::write(fixture.root.join(case["path"].as_str().unwrap()), &bytes).unwrap();
    }

    fixture.commit("content vectors");

    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();

    for case in reference["cases"].as_array().unwrap() {
        let path = common::git_path(case["path"].as_str().unwrap());

        let source = if case["kind"] == "working" {
            FileSource::Working
        } else {
            FileSource::Revision("HEAD")
        };

        let content = repository.file_content(source, &path, None).unwrap();

        let (encoded, encoding) = match &content.content {
            FileData::Utf8(text) => (text.clone(), "utf8"),
            FileData::Binary(bytes) => (STANDARD.encode(bytes), "base64"),
        };

        assert_eq!(encoded, case["expected"]["content"].as_str().unwrap());
        assert_eq!(encoding, case["expected"]["encoding"].as_str().unwrap());
        assert_eq!(json!(content.size_bytes()), case["expected"]["sizeBytes"]);
    }
}

#[test]
fn reads_exact_utf8_bom_binary_and_empty_working_files() {
    let fixture = Fixture::new();
    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();

    for (name, bytes, binary) in [
        ("bom", b"\xef\xbb\xbfhello\r\n".as_slice(), false),
        ("nul", b"hello\0world", false),
        ("binary", b"\xff\0\xfe", true),
        ("empty", b"", false),
    ] {
        fs::write(fixture.root.join(name), bytes).unwrap();

        let content = repository
            .file_content(FileSource::Working, &common::git_path(name), None)
            .unwrap();

        assert_eq!(content.content.as_bytes(), bytes);
        assert_eq!(content.size_bytes(), bytes.len());
        assert_eq!(content.revision, "WORKTREE");
        assert_eq!(matches!(content.content, FileData::Binary(_)), binary);
    }
}

#[test]
fn revision_and_object_previews_resolve_immutable_blobs_with_exact_path_labels() {
    let fixture = Fixture::new();

    fixture.write("file\t\n*", "committed\n");
    fixture.git_os(["add".into(), "--".into(), "file\t\n*".into()]);
    fixture.git(&["commit", "-m", "initial"]);

    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();
    let before_committed = files_under(&fixture.root);

    let committed = repository
        .file_content(
            FileSource::Revision("HEAD"),
            &common::git_path("file\t\n*"),
            None,
        )
        .unwrap();

    assert_eq!(files_under(&fixture.root), before_committed);
    fixture.write("file\t\n*", "working\n");

    let before = files_under(&fixture.root);

    let object = repository
        .file_content(
            FileSource::Object(&committed.revision),
            &common::git_path("path label"),
            None,
        )
        .unwrap();

    let current = repository
        .file_content(FileSource::Working, &common::git_path("file\t\n*"), None)
        .unwrap();

    assert_eq!(object.content.as_bytes(), b"committed\n");
    assert_eq!(committed.revision, object.revision);
    assert_eq!(object.path, common::git_path("path label"));
    assert_eq!(current.content.as_bytes(), b"working\n");
    assert!(matches!(
        repository.file_content(FileSource::Object("HEAD"), &common::git_path("file"), None),
        Err(RepositoryError::NotAFile)
    ));
    assert_eq!(files_under(&fixture.root), before);
}

#[test]
fn allows_internal_symlinks_and_rejects_escapes_directories_and_replaced_roots() {
    let fixture = Fixture::new();

    fixture.write("file", "inside\n");
    symlink("file", fixture.root.join("inside-link")).unwrap();

    let outside = fixture.temporary.path().join("outside");

    fs::write(&outside, "outside fixture").unwrap();
    symlink(&outside, fixture.root.join("outside-link")).unwrap();

    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();

    assert_eq!(
        repository
            .file_content(FileSource::Working, &common::git_path("inside-link"), None)
            .unwrap()
            .content
            .as_bytes(),
        b"inside\n"
    );
    assert!(matches!(
        repository.file_content(FileSource::Working, &common::git_path("outside-link"), None),
        Err(RepositoryError::PathOutsideRepository)
    ));
    assert!(onegit_git::GitPath::new("../outside").is_err());
    assert!(matches!(
        repository.file_content(FileSource::Working, &common::git_path(".git"), None),
        Err(RepositoryError::InvalidPath)
    ));

    fs::rename(&fixture.root, fixture.temporary.path().join("old-root")).unwrap();
    fs::create_dir(&fixture.root).unwrap();
    fs::write(fixture.root.join("file"), "replacement").unwrap();

    assert!(matches!(
        repository.file_content(FileSource::Working, &common::git_path("file"), None),
        Err(RepositoryError::InvalidInput(_))
    ));
}

#[test]
fn enforces_the_preview_limit_on_working_and_committed_sources_and_honors_cancellation() {
    let fixture = Fixture::new();
    let boundary = vec![b'x'; 10 * 1024 * 1024];

    fs::write(fixture.root.join("large"), &boundary).unwrap();
    fixture.commit("boundary");

    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();

    assert_eq!(
        repository
            .file_content(FileSource::Working, &common::git_path("large"), None)
            .unwrap()
            .size_bytes(),
        boundary.len()
    );
    assert_eq!(
        repository
            .file_content(
                FileSource::Revision("HEAD"),
                &common::git_path("large"),
                None
            )
            .unwrap()
            .size_bytes(),
        boundary.len()
    );

    let mut oversized = boundary;

    oversized.push(b'x');
    fs::write(fixture.root.join("large"), &oversized).unwrap();
    fixture.commit("over boundary");

    assert!(matches!(
        repository.file_content(FileSource::Working, &common::git_path("large"), None),
        Err(RepositoryError::Git(GitError::OutputTooLarge { .. }))
    ));
    assert!(matches!(
        repository.file_content(
            FileSource::Revision("HEAD"),
            &common::git_path("large"),
            None
        ),
        Err(RepositoryError::Git(GitError::OutputTooLarge { .. }))
    ));

    let cancellation = Cancellation::default();

    cancellation.cancel();

    assert!(matches!(
        repository.file_content(
            FileSource::Working,
            &common::git_path("large"),
            Some(&cancellation)
        ),
        Err(RepositoryError::Git(GitError::Cancelled))
    ));
}
