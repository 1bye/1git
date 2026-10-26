//! Covers: bounded non-Git native helpers sharing process-group cleanup without Git decoration.
//! Real: POSIX argv, literal stdin/output pipes, deadlines and cancellation.
//! Doubles: disposable executable scripts only; no native app/network/user configuration.
//! Requires: POSIX shell and temporary storage.

use onegit_git::{Cancellation, GitError, ToolCommand, execute_tool};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::time::{Duration, Instant};

fn script(root: &std::path::Path, body: &str) -> std::path::PathBuf {
    let path = root.join("tool-fixture");

    fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();

    path
}

#[test]
fn native_helper_receives_only_literal_arguments_and_empty_stdin() {
    let root = tempfile::tempdir().unwrap();

    let executable = script(
        root.path(),
        "[ -z \"$(cat)\" ] || exit 8\nprintf '%s\\0' \"$@\"",
    );

    let args = ["-a", "file ' ; $().txt", "line\nbreak"];

    let result = execute_tool(ToolCommand::new(&executable, root.path(), args)).unwrap();

    assert_eq!(
        result.stdout,
        args.iter()
            .flat_map(|arg| arg.as_bytes().iter().copied().chain([0]))
            .collect::<Vec<_>>()
    );
    assert!(result.stderr.is_empty());
}

#[test]
fn native_helper_pumps_exact_binary_stdin_without_shell_or_git_decoration() {
    let root = tempfile::tempdir().unwrap();
    let executable = script(root.path(), "printf '%s' \"$#\" > argument-count\n/bin/cat");

    let mut bytes = (0..262_144)
        .map(|index| (index % 256) as u8)
        .collect::<Vec<_>>();

    bytes.extend_from_slice(b"\n$(touch pwned); literal input\0\r\n");
    let mut command = ToolCommand::new(&executable, root.path(), std::iter::empty::<&str>());

    command.stdin = &bytes;
    let output = execute_tool(command).unwrap();

    assert_eq!(output.stdout, bytes);
    assert!(output.stderr.is_empty());
    assert_eq!(fs::read(root.path().join("argument-count")).unwrap(), b"0");
    assert!(!root.path().join("pwned").exists());
}

#[test]
fn native_helper_output_overflow_is_bounded_and_reaped() {
    let root = tempfile::tempdir().unwrap();

    let executable = script(
        root.path(),
        "trap '' TERM\nwhile :; do printf '0123456789abcdef'; done",
    );

    let mut command = ToolCommand::new(&executable, root.path(), std::iter::empty::<&str>());

    command.max_output_bytes = 4096;
    command.timeout = Duration::from_secs(5);
    let start = Instant::now();

    assert!(matches!(
        execute_tool(command),
        Err(GitError::OutputTooLarge { limit: 4096 })
    ));
    assert!(start.elapsed() < Duration::from_secs(4));
}

#[test]
fn native_helper_deadline_cleans_a_term_ignoring_process_group() {
    let root = tempfile::tempdir().unwrap();
    let executable = script(root.path(), "trap '' TERM\nsleep 20 &\nwait");
    let mut command = ToolCommand::new(&executable, root.path(), std::iter::empty::<&str>());

    command.timeout = Duration::from_millis(60);
    let start = Instant::now();

    assert!(matches!(execute_tool(command), Err(GitError::TimedOut)));
    assert!(start.elapsed() < Duration::from_secs(4));
}

#[test]
fn native_helper_cancellation_joins_owned_backpressured_stdin_and_output_pipes() {
    let root = tempfile::tempdir().unwrap();
    let executable = script(root.path(), "trap '' TERM\ntouch entered\nsleep 20 &\nwait");
    let directory = root.path().to_path_buf();
    let cancellation = Cancellation::default();
    let cancel = cancellation.clone();

    let worker = std::thread::spawn(move || {
        let input = vec![b'x'; 2_097_152];
        let mut command = ToolCommand::new(&executable, &directory, std::iter::empty::<&str>());

        command.stdin = &input;
        command.cancellation = Some(&cancellation);

        execute_tool(command)
    });

    let until = Instant::now() + Duration::from_secs(5);

    while !root.path().join("entered").exists() {
        assert!(Instant::now() < until);
        std::thread::sleep(Duration::from_millis(5));
    }

    cancel.cancel();

    assert!(matches!(worker.join().unwrap(), Err(GitError::Cancelled)));
}
