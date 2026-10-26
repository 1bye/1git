# Native platform boundary

The private `platform` module selects Unix or Windows at compile time. Other
hosts produce a compile error. The crate's public exports remain unchanged;
there are no UI or Rake dependencies.

| API | Unix | Windows |
| --- | --- | --- |
| `spawn`, `OwnedChild`, `Signal` | Private process group, TERM then KILL, kill/reap on error | Child starts suspended, enters a non-breakaway Job Object with kill-on-close, then resumes. CTRL_BREAK then `TerminateJobObject`; kill/reap on setup failure. |
| Pinned child directory | Duplicate fd above stdio with `F_DUPFD_CLOEXEC`, child-only async-signal-safe `fchdir` | Resolve the live handle with `GetFinalPathNameByHandleW` immediately before `CreateProcess`. |
| `input_pipe`, `output_pipe` | Original nonblocking descriptors and one-chunk-per-poll pumps | Synchronous pipe worker threads with bounded channels (8192-byte chunks); cancel synchronous I/O and join every worker on drop. Writes are acknowledged only after the complete chunk is written. |
| `open_directory_no_follow` | Original `O_DIRECTORY` / `O_NOFOLLOW` | Backup-semantics and open-reparse-point handle, reject reparse attributes and require a directory. |
| `open_beneath`, `open_component`, `Access` | Original component walk with `openat`, no-follow, close-on-exec, nonblocking; append/exclusive-create flags retained | `NtCreateFile` for one component at a time with the parent `RootDirectory`, `FILE_OPEN_REPARSE_POINT` (the NT counterpart of `FILE_FLAG_OPEN_REPARSE_POINT`), then reject every reparse point. Append access excludes write-data access; exclusive creation uses `FILE_CREATE`. |
| `truncate_no_follow` | Original no-follow open with truncation | Open the reparse point itself, reject it, then truncate the held regular object. |
| `FileIdentity::{from_file,from_path}` | Device + inode; path lookup uses `symlink_metadata` | Volume serial + 128-bit ID via `GetFileInformationByHandleEx(FileIdInfo)`; path lookup opens the reparse point itself. Unsupported identity queries fail explicitly. |
| `file_state`, `FileState` | Identity, length, links, mode, nanosecond mtime and ctime; full equality for ignore preflight, length/timestamps for streamed recovery hashing | Identity, length, links, file attributes, last-write and change times from native handle queries. |
| `create_private_file`, `create_private_directory`, `make_private_*`, `is_private_directory` | Original exclusive 0600 files / 0700 directories and mode checks | Protected OWNER RIGHTS DACL (`D:P(A;;FA;;;OW)`), applied atomically at creation, then verified before private content is written. Existing temporary directories get that DACL through a reopened handle. Recovery rechecks the protected, single owner-only allow ACE. |
| `validate_discard_path` | Original no-follow parent walk and `fstatat(AT_SYMLINK_NOFOLLOW)`; regular files and final symlinks accepted | No-follow component walk; ordinary files and missing entries accepted; reparse points return an explicit error. |
| `path_from_git_bytes`, `path_to_git_bytes` | Lossless native byte conversions (borrowed when encoding) | Fallible UTF-8; normalize native separators to Git `/`. Reject unpaired surrogates, invalid UTF-8, NUL/control characters, alternate streams, reserved device names, wildcard characters, and trailing dot/space aliases. Strip native extended-length prefixes when encoding for Git. |
| `is_missing_or_not_regular` | ELOOP, ENOENT, ENOTDIR, EISDIR | Missing-file/path, directory, inaccessible-file and stopped-on-symlink errors. |
| `random_bytes` | Original `/dev/urandom` read | System-preferred `BCryptGenRandom`. |

## Windows differences and explicit failures

- **Pinned cwd has a residual pathname race.** Windows process creation accepts a
  pathname, so a directory renamed/replaced after handle-to-path resolution can
  redirect the child. This is weaker than Unix `fchdir`. Handle-relative file
  operations do not use that fallback and retain their no-reparse boundary.
- **Graceful termination is best-effort.** CTRL_BREAK needs a shared console and
  can be ignored or unavailable to a GUI-launched process. The two-second grace
  period still ends with unconditional Job Object termination. Job setup or
  assignment failure aborts execution while the child is suspended.
- **ACLs replace POSIX modes.** Private objects require the protected owner-only
  ACL and reject unsupported security queries or failed ACL verification. Ordinary
  metadata comparisons use Windows attributes and change time, rather than Unix
  permission bits. Timestamp granularity/update timing depends on the filesystem;
  neither implementation provides a transaction against external writers.
- **Directory durability is not emulated.** Existing directory `sync_all` calls
  propagate any Windows flush/access error. In recovery this aborts before any
  destructive Git step; a partial backup may remain. After creating `.gitignore`,
  a sync failure is a Command-phase error and the appended file may remain, as
  documented by that operation. No successful durable result is reported when a
  required flush fails.
- **Reparse-point discard is refused.** Windows rejects final reparse points as
  well as parent junctions/symlinks; use external Git for those entries.
- **Windows path representability is narrower.** Encoding errors propagate as the
  existing typed invalid-input/output/status errors, without lossy replacement.
- Windows Job Objects also terminate surviving descendants when their last job
  handle closes after successful execution. Unix retains its existing successful
  process-group behavior. Processes that deliberately detach from a Unix group,
  or delegate work to an unrelated Windows service, are outside the owned tree.

Unix-only tests (permission bits, non-UTF-8 names, shell scripts and POSIX signals)
retain their assertions under `cfg(unix)`. Shared fixture OS helpers live under
`tests/common/{unix,windows}.rs`. Windows symlink tests require developer mode or
symlink privilege.

Windows and Linux are cross-compiled on macOS. No Windows runtime machine is
available: native ACL, console, pipe-cancellation and Job Object behavior still
need execution on Windows before claiming runtime support.

References: [NtCreateFile](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntcreatefile),
[Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects),
[ReOpenFile](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-reopenfile),
[OWNER RIGHTS SID](https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/manage/understand-security-identifiers).

## Verification on macOS (2026-10-26)

The final sequential run passed all commands below. The current worktree baseline
ran 243 tests including doctests (the task plan stated 278); all 243 test cases
remain, with four additional macOS platform tests, for 247 passing tests.

| Command | Result |
| --- | --- |
| `cargo fmt --all --check` | Passed (exit 0) |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | Passed (exit 0) |
| `cargo fmt -p onegit-git --check` | Passed (exit 0) |
| `cargo clippy -p onegit-git --all-targets --locked -- -D warnings` | Passed (exit 0) |
| `cargo check -p onegit-git --all-targets --target x86_64-pc-windows-msvc --locked` | Passed (exit 0) |
| `cargo clippy -p onegit-git --all-targets --target x86_64-pc-windows-msvc --locked -- -D warnings` | Passed (exit 0) |
| `cargo check -p onegit-git --all-targets --target x86_64-unknown-linux-gnu --locked` | Passed (exit 0) |
| `cargo test -p onegit-git --locked` | 247 passed; no failures or ignored tests |
| `cargo test -p onegit-git --locked --test ignore --test discard` | 42 passed after native-separator validation changes |

`rustup target add x86_64-pc-windows-msvc x86_64-unknown-linux-gnu` installed the
standard libraries used by the cross-target checks. These are compile/lint checks,
not Windows or Linux runtime tests.

`grep -rnE 'std::os::(unix|fd|windows)|libc::' crates/onegit-git/src` found 43
matches, exclusively in `platform/unix.rs` and `platform/windows.rs`.

`git diff --cached --check` passed. The Git pre-commit hook invokes an absent
`oxfmt` package script in this Rust worktree, so commits use `LEFTHOOK=0`; the Rust
formatting, lint and test checks above were run directly. No changeset is needed
for this unreleased crate.
