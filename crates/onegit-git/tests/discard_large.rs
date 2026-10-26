//! Covers: streamed binary recovery above 64 MiB and the source's 1148-file bundle case.
//! Real: local Git, disk-backed patches, actual symlinks and manual/API recovery.
//! Doubles: none; random bytes are disposable non-secret fixture data.
//! Requires: POSIX Git, /dev/urandom and temporary storage; no service or user data.

mod common;

use common::Fixture;
use common::symlink;
use onegit_git::{BranchIdentity, DiscardFiles, DiscardRecovery, Repository};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;

fn large_file(path: &Path) -> [u8; 32] {
    let mut random = File::open("/dev/urandom").unwrap();
    let mut file = File::create(path).unwrap();
    let mut buffer = [0; 65536];
    let mut hash = Sha256::new();

    for _ in 0..(54 * 1024 * 1024 / buffer.len()) {
        random.read_exact(&mut buffer).unwrap();
        file.write_all(&buffer).unwrap();
        hash.update(buffer);
    }

    hash.finalize().into()
}

fn hash_file(path: &Path) -> [u8; 32] {
    let mut file = File::open(path).unwrap();
    let mut hash = Sha256::new();
    let mut buffer = [0; 65536];

    loop {
        let count = file.read(&mut buffer).unwrap();

        if count == 0 {
            break;
        }

        hash.update(&buffer[..count]);
    }

    hash.finalize().into()
}

fn request(
    fixture: &Fixture,
    repository: &Repository,
    paths: Vec<std::path::PathBuf>,
) -> DiscardFiles {
    DiscardFiles {
        paths,
        allow_destructive: true,
        recovery: Some(DiscardRecovery {
            directory: fixture.temporary.path().join("recovery"),
            expected: BranchIdentity::from_snapshot(&repository.snapshot(false, None).unwrap()),
        }),
    }
}

#[test]
fn streamed_untracked_binary_patch_exceeds_capture_cap_and_preserves_the_real_index() {
    let fixture = Fixture::new();

    fixture.write("base.txt", "base\n");
    fixture.commit("Base");
    fixture.write("base.txt", "excluded staged\n");
    fixture.git_os(["add", "--", "base.txt"].map(Into::into));
    fixture.write("base.txt", "excluded working\n");
    let expected = large_file(&fixture.root.join("large[1].bin"));
    let index = fs::read(fixture.root.join(".git/index")).unwrap();
    let refs = common::files_under(&fixture.root.join(".git/refs"));

    let repository =
        Repository::open(&fixture.root, fixture.process_with_limit(1024), None).unwrap();

    let result = repository
        .discard_files(
            &request(&fixture, &repository, vec!["large[1].bin".into()]),
            None,
        )
        .unwrap();

    let patch = result.recovery.directory.join("working.patch");

    assert!(fs::metadata(&patch).unwrap().len() > 64 * 1024 * 1024);
    assert!(!fixture.root.join("large[1].bin").exists());
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
    assert_eq!(
        fs::read(fixture.root.join("base.txt")).unwrap(),
        b"excluded working\n"
    );
    fixture.git_os([
        "apply".into(),
        "--check".into(),
        patch.as_os_str().to_owned(),
    ]);
    fixture.git_os(["apply".into(), patch.into_os_string()]);
    assert_eq!(hash_file(&fixture.root.join("large[1].bin")), expected);
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
    assert_eq!(common::files_under(&fixture.root.join(".git/refs")), refs);
}

#[test]
fn separate_large_staged_and_working_patches_restore_distinct_states_with_undo() {
    let fixture = Fixture::new();

    fixture.write("base.txt", "base\n");
    fixture.commit("Base");
    large_file(&fixture.root.join("large-staged.bin"));
    fixture.git_os(["add", "--", "large-staged.bin"].map(Into::into));
    let staged = fixture.git(&["rev-parse", ":large-staged.bin"]);

    fixture.write("large-staged.bin", "working version\n");
    fixture.write("keep.txt", "keep\n");
    let refs = common::files_under(&fixture.root.join(".git/refs"));

    let repository =
        Repository::open(&fixture.root, fixture.process_with_limit(1024), None).unwrap();

    let result = repository
        .discard_files(
            &request(&fixture, &repository, vec!["large-staged.bin".into()]),
            None,
        )
        .unwrap();

    for name in ["staged.patch", "working.patch"] {
        assert!(
            fs::metadata(result.recovery.directory.join(name))
                .unwrap()
                .len()
                > 64 * 1024 * 1024,
            "{name}"
        );
    }

    assert!(!fixture.root.join("large-staged.bin").exists());
    repository.undo_discard(&result.undo.token, None).unwrap();
    assert_eq!(fixture.git(&["rev-parse", ":large-staged.bin"]), staged);
    assert_eq!(
        fs::read(fixture.root.join("large-staged.bin")).unwrap(),
        b"working version\n"
    );
    assert_eq!(fs::read(fixture.root.join("keep.txt")).unwrap(), b"keep\n");
    assert_eq!(common::files_under(&fixture.root.join(".git/refs")), refs);
}

#[test]
fn discards_and_recovers_all_1148_bundle_files_links_and_empty_files_without_index_writes() {
    let fixture = Fixture::new();

    fixture.write("base.txt", "base\n");
    fixture.commit("Base");
    let bundle = "Build.app/Contents";
    let framework = format!("{bundle}/Frameworks/Example.framework");

    fs::create_dir_all(fixture.root.join(format!("{framework}/Versions/A"))).unwrap();
    fs::create_dir_all(fixture.root.join(format!("{bundle}/Resources"))).unwrap();
    let mut paths = Vec::new();

    for index in 0..1144 {
        let path = format!("{bundle}/Resources/locale-{index}.pak");

        fixture.write(&path, &format!("file {index}\n"));
        paths.push(path.into());
    }

    let binary = format!("{framework}/Versions/A/Example");
    let empty = format!("{bundle}/Resources/empty");
    let current = format!("{framework}/Versions/Current");
    let link = format!("{framework}/Example");

    fs::write(fixture.root.join(&binary), [0, 1, 255, 18]).unwrap();
    fixture.write(&empty, "");
    symlink("A", fixture.root.join(&current)).unwrap();
    symlink("Versions/Current/Example", fixture.root.join(&link)).unwrap();
    paths.extend([
        binary.clone().into(),
        empty.clone().into(),
        current.clone().into(),
        link.clone().into(),
    ]);
    assert_eq!(paths.len(), 1148);
    let index = fs::read(fixture.root.join(".git/index")).unwrap();
    let refs = common::files_under(&fixture.root.join(".git/refs"));
    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();

    let result = repository
        .discard_files(&request(&fixture, &repository, paths), None)
        .unwrap();

    assert!(result.snapshot.status.files.is_empty());
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
    fixture.git_os([
        "apply".into(),
        "--check".into(),
        result
            .recovery
            .directory
            .join("working.patch")
            .into_os_string(),
    ]);
    fixture.git_os([
        "apply".into(),
        result
            .recovery
            .directory
            .join("working.patch")
            .into_os_string(),
    ]);

    for index in 0..1144 {
        assert_eq!(
            fs::read(
                fixture
                    .root
                    .join(format!("{bundle}/Resources/locale-{index}.pak"))
            )
            .unwrap(),
            format!("file {index}\n").as_bytes()
        );
    }

    assert_eq!(
        fs::read(fixture.root.join(binary)).unwrap(),
        [0, 1, 255, 18]
    );
    assert_eq!(fs::metadata(fixture.root.join(empty)).unwrap().len(), 0);
    assert_eq!(
        fs::read_link(fixture.root.join(current)).unwrap(),
        Path::new("A")
    );
    assert_eq!(
        fs::read_link(fixture.root.join(link)).unwrap(),
        Path::new("Versions/Current/Example")
    );
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
    assert_eq!(common::files_under(&fixture.root.join(".git/refs")), refs);
}
