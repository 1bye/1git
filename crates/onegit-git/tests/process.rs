//! Covers: binary I/O, exit errors, output limits, isolated indexes and process-group cleanup.
//! Real: Git CLI, POSIX pipes/signals and disposable filesystem state.
//! Doubles: shell executables that reproduce noisy or stalled Git helpers.
//! Requires: Git, /bin/sh and writable temporary storage; no network or user credentials.

use std::fs::{self, File};
use std::io::{Seek, SeekFrom};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use onegit_git::{Cancellation, GitCommand, GitError, GitOutput, GitProcess};
use tempfile::TempDir;

struct Fixture(TempDir);

impl Fixture {
    fn new() -> Self {
        Self(tempfile::tempdir().unwrap())
    }

    fn path(&self) -> &Path {
        self.0.path()
    }

    fn command(&self, args: &[&str]) -> GitCommand<'_> {
        let mut command = GitCommand::new(self.path(), args.iter().copied());

        command.environment = vec![
            ("GIT_CONFIG_GLOBAL".into(), "/dev/null".into()),
            ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
            ("GIT_CONFIG_COUNT".into(), "0".into()),
            ("HOME".into(), self.path().into()),
        ];

        command
    }

    fn git(&self, args: &[&str]) -> GitOutput {
        GitProcess::default().run(self.command(args)).unwrap()
    }

    fn script(&self, body: &str) -> PathBuf {
        let path = self.path().join("git-fixture");

        fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();

        path
    }
}

#[test]
fn preserves_large_binary_input_and_output_without_a_shell() {
    let fixture = Fixture::new();

    fixture.git(&["init", "--initial-branch=main"]);

    let bytes: Vec<u8> = (0..1_048_576).map(|i| (i % 256) as u8).collect();
    let mut command = fixture.command(&["hash-object", "-w", "--stdin"]);

    command.stdin = &bytes;

    let output = GitProcess::default().run(command).unwrap();
    let oid = String::from_utf8(output.stdout).unwrap();
    let read = fixture.git(&["cat-file", "blob", oid.trim()]);

    assert_eq!(read.stdout, bytes);
    assert!(read.stderr.is_empty());
}

#[test]
fn streams_a_held_file_past_the_output_cap_without_reopening_a_substituted_path() {
    let fixture = Fixture::new();

    fixture.git(&["init", "--initial-branch=main"]);
    let bytes: Vec<u8> = (0..2_097_152).map(|i| (i % 256) as u8).collect();
    let path = fixture.path().join("input");

    fs::write(&path, &bytes).unwrap();
    let file = File::open(&path).unwrap();

    fs::rename(&path, fixture.path().join("retired-input")).unwrap();
    fs::write(&path, "substituted\n").unwrap();
    let mut expected = fixture.command(&["hash-object", "--stdin"]);

    expected.stdin = &bytes;
    let expected = GitProcess::default().run(expected).unwrap().stdout;
    let mut streamed = fixture.command(&["hash-object", "--stdin"]);

    streamed.stdin_file = Some(file);
    let actual = GitProcess::new("git", 64).run(streamed).unwrap();

    assert_eq!(actual.stdout, expected);
    assert_eq!(fs::read(path).unwrap(), b"substituted\n");
    assert!(actual.stderr.is_empty());
}

#[test]
fn streams_from_the_current_file_offset_and_rejects_two_input_sources_before_spawn() {
    let fixture = Fixture::new();
    let path = fixture.path().join("input");

    fs::write(&path, "prefix\0binary\n").unwrap();
    let mut file = File::open(&path).unwrap();

    file.seek(SeekFrom::Start(7)).unwrap();
    let script = fixture.script("cat");
    let mut command = fixture.command(&[]);

    command.stdin_file = Some(file);
    let actual = GitProcess::new(&script, 64).run(command).unwrap();

    assert_eq!(actual.stdout, b"binary\n");
    let mut conflicting = fixture.command(&[]);

    conflicting.stdin_file = Some(File::open(&path).unwrap());
    conflicting.stdin = b"ambiguous";
    let marker = fixture.path().join("unexpected-spawn");
    let script = fixture.script("touch unexpected-spawn");
    let error = GitProcess::new(script, 64).run(conflicting).unwrap_err();

    assert!(
        matches!(error, GitError::Io(error) if error.kind() == std::io::ErrorKind::InvalidInput)
    );
    assert!(!marker.exists());
}

#[test]
fn streams_file_to_file_while_stderr_overflow_still_cleans_up_the_process_group() {
    let fixture = Fixture::new();
    let path = fixture.path().join("input");
    let output = fixture.path().join("output");
    let bytes = vec![0x81; 2_097_152];

    fs::write(&path, &bytes).unwrap();
    let script = fixture.script("cat; printf 'stderr-overflow' >&2; sleep 10");
    let mut command = fixture.command(&[]);

    command.stdin_file = Some(File::open(&path).unwrap());
    command.stdout_file = Some(File::create(&output).unwrap());
    command.timeout = Some(Duration::from_secs(5));
    let started = Instant::now();
    let error = GitProcess::new(script, 8).run(command).unwrap_err();

    assert!(matches!(error, GitError::OutputTooLarge { limit: 8 }));
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_eq!(fs::read(output).unwrap(), bytes);
}

#[test]
fn passes_metacharacters_literally_and_preserves_exit_diagnostics() {
    let fixture = Fixture::new();
    let script = fixture.script("printf '%s' \"$5\"; printf 'fixture failure' >&2; exit 23");
    let process = GitProcess::new(script, 1024);

    let error = process
        .run(fixture.command(&["$(touch injected); & | `id`"]))
        .unwrap_err();

    let GitError::CommandFailed { status, output } = error else {
        panic!("expected a command failure: {error}");
    };

    assert_eq!(status.code(), Some(23));
    assert_eq!(output.stdout, b"$(touch injected); & | `id`");
    assert_eq!(output.stderr, b"fixture failure");
    assert!(!fixture.path().join("injected").exists());
}

#[test]
fn bounds_stdout_and_stderr_together() {
    let fixture = Fixture::new();
    let script = fixture.script("printf '%033d' 0; printf '%033d' 0 >&2");
    let process = GitProcess::new(script, 64);

    let error = process.run(fixture.command(&[])).unwrap_err();

    assert!(matches!(error, GitError::OutputTooLarge { limit: 64 }));
}

#[test]
fn per_command_output_limits_can_only_tighten_the_runner_limit() {
    let fixture = Fixture::new();

    for (runner_limit, command_limit) in [(8, 64), (64, 8)] {
        let mut command = fixture.command(&["--version"]);

        command.max_output_bytes = Some(command_limit);

        assert!(matches!(
            GitProcess::new("git", runner_limit).run(command),
            Err(GitError::OutputTooLarge { limit: 8 })
        ));
    }
}

#[test]
fn streams_stdout_to_a_file_while_bounding_stderr() {
    let fixture = Fixture::new();
    let script = fixture.script("printf '%131072d' 0; printf 'ok' >&2");
    let path = fixture.path().join("output");
    let mut command = fixture.command(&[]);

    command.stdout_file = Some(File::create(&path).unwrap());

    let output = GitProcess::new(script, 32).run(command).unwrap();

    assert!(output.stdout.is_empty());
    assert_eq!(output.stderr, b"ok");
    assert_eq!(fs::metadata(path).unwrap().len(), 131_072);
}

#[test]
fn overrides_only_the_child_index_and_keeps_the_real_index_unchanged() {
    let fixture = Fixture::new();

    fixture.git(&["init", "--initial-branch=main"]);
    fs::write(fixture.path().join("file"), "content").unwrap();
    fixture.git(&["add", "--", "file"]);

    let original = fs::read(fixture.path().join(".git/index")).unwrap();
    let alternate = fixture.path().join("alternate-index");
    let mut command = fixture.command(&["read-tree", "--empty"]);

    command.index_file = Some(&alternate);

    GitProcess::default().run(command).unwrap();

    assert!(alternate.exists());
    assert_eq!(
        fs::read(fixture.path().join(".git/index")).unwrap(),
        original
    );
    assert_eq!(fixture.git(&["ls-files"]).stdout, b"file\n");
}

#[test]
fn reports_missing_git_and_cancellation_before_spawn() {
    let fixture = Fixture::new();
    let process = GitProcess::new(fixture.path().join("missing"), 1024);

    assert!(matches!(
        process.run(fixture.command(&[])),
        Err(GitError::GitNotFound(_))
    ));

    let cancellation = Cancellation::default();

    cancellation.cancel();

    let mut command = fixture.command(&[]);

    command.cancellation = Some(&cancellation);

    assert!(matches!(process.run(command), Err(GitError::Cancelled)));
}

#[test]
fn cancellation_stops_term_ignoring_helpers_before_returning() {
    let fixture = Fixture::new();
    let script = fixture.script("trap '' TERM; sleep 60 &\necho $! > helper-pid\nwait");
    let cancellation = Cancellation::default();

    thread::scope(|scope| {
        let worker = scope.spawn(|| {
            let mut command = fixture.command(&[]);

            command.cancellation = Some(&cancellation);
            command.timeout = Some(Duration::from_secs(10));

            GitProcess::new(script, 1024).run(command)
        });

        let helper = wait_for_pid(&fixture.path().join("helper-pid"));

        cancellation.cancel();

        assert!(matches!(worker.join().unwrap(), Err(GitError::Cancelled)));
        assert_process_gone(helper);
    });
}

#[test]
fn deadline_cleans_up_helpers_after_the_leader_exits() {
    let fixture = Fixture::new();
    let script = fixture.script("sleep 60 &\necho $! > helper-pid\nexit 0");
    let mut command = fixture.command(&[]);

    command.timeout = Some(Duration::from_secs(2));

    let result = GitProcess::new(script, 1024).run(command);

    assert!(matches!(result, Err(GitError::TimedOut)));

    let helper = wait_for_pid(&fixture.path().join("helper-pid"));

    assert_process_gone(helper);
}

fn wait_for_pid(path: &Path) -> i32 {
    let start = Instant::now();

    loop {
        if let Ok(pid) = fs::read_to_string(path)
            && let Ok(pid) = pid.trim().parse()
        {
            return pid;
        }

        assert!(
            start.elapsed() < Duration::from_secs(3),
            "fixture helper did not start"
        );
        thread::sleep(Duration::from_millis(5));
    }
}

fn assert_process_gone(pid: i32) {
    let start = Instant::now();

    loop {
        // SAFETY: signal 0 probes the synthetic fixture PID without sending a signal.
        if unsafe { libc::kill(pid, 0) } == -1 {
            assert_eq!(
                std::io::Error::last_os_error().raw_os_error(),
                Some(libc::ESRCH)
            );

            return;
        }

        assert!(
            start.elapsed() < Duration::from_secs(3),
            "helper {pid} survived cleanup"
        );
        thread::sleep(Duration::from_millis(5));
    }
}
