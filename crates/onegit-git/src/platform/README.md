# Native platform boundary

The private `platform` module selects Unix or Windows at compile time. Other
hosts produce a compile error. Public exports are unchanged; there are no UI or
Rake dependencies. Unix wrappers keep the original operations and behavior.

| API | Unix | Windows |
| --- | --- | --- |
| `spawn`, `OwnedChild::{signal,finish}` | Private process group, TERM then KILL, kill/reap on error; normal completion leaves descendants alone | Spawn suspended with `CREATE_NO_WINDOW`, assign to a non-breakaway Job Object, then resume. Kill-on-close is armed during execution; normal completion attempts to disarm it without changing Git's result on failure. Cancellation/deadline/overflow kill the job without a console-signal grace period. |
| Pinned child directory | Duplicate fd above stdio, async-signal-safe child-only `fchdir` | Resolve the live handle immediately before spawn. Prefer plain DOS/UNC cwd syntax only when removing the verbatim prefix preserves semantics and stays below 260 UTF-16 code units. |
| `input_pipe`, `output_pipe` | Nonblocking descriptors, one chunk per poll | Bounded 8192-byte worker channels; cancel synchronous I/O and join every worker on drop. Acknowledge input only after the complete chunk is written. |
| `open_directory_no_follow` | Original `O_DIRECTORY` / `O_NOFOLLOW` | Open the final reparse point itself and require a directory; reject name-surrogate tags, allow non-surrogate filters using the policy below. |
| `open_beneath`, `open_component`, `Access` | Original `openat` walk, no-follow/close-on-exec/nonblocking flags, append and exclusive-create flags | One `NtCreateFile` component at a time relative to the held parent. Inspect its tag before data access. Verify the leaf spelling using a normalized, volume-relative handle path (`VOLUME_NAME_NONE`); query failures are verification errors, never absence. `Inspect` requests only `FILE_READ_ATTRIBUTES \| SYNCHRONIZE`. |
| `truncate_no_follow` | Original no-follow open with truncation | Inspect the final object and verify its name before truncating the held, data-ready object. |
| `FileIdentity::{from_file,from_path}` | Device + inode; no-follow path metadata | Volume serial + nonzero 128-bit `FileIdInfo`. Unsupported queries and all-zero IDs return `Unsupported`; no 64-bit or pathname fallback. |
| `file_state`, `FileState` | Identity, length, links, mode, nanosecond mtime/ctime | Identity, length, links, file attributes, last-write/change times. Full equality for ignore preflight; length/timestamps for streamed recovery hashing. |
| Private object APIs | Exclusive 0600 files / 0700 directories and mode checks | Protected OWNER RIGHTS DACL `D:P(A;;FA;;;OW)`, applied at creation and verified before private bytes are written. Existing temporary directories receive and verify it through a reopened handle. |
| `validate_discard_path` | Original no-follow parent walk and `fstatat(AT_SYMLINK_NOFOLLOW)` | No-follow parent walk; final entry opened with attribute-only access, without hydration or a data read. Missing entries are accepted, ordinary files accepted, name-surrogate links refused. |
| `path_from_git_bytes` | Original lossless byte conversion | Decode UTF-8 Git paths with `/` as the only separator. Escape literal backslashes and the private marker reversibly within each native component; reject empty/dot/parent components and drive-rooted slash forms. Guard drive-like names such as `a:b` as `.\a:b`; encoding removes the guard. |
| `absolute_path_from_git_bytes` | Identical original byte conversion | Separate decoder for absolute `rev-parse` and worktree paths. Require an absolute native path and valid UTF-8 without NUL. |
| `path_to_git_bytes` | Original borrowed native bytes | Encode UTF-8, normalize native separators and strip the display guard/extended-length prefix **before** reversing private escapes. Literal Git backslashes therefore survive. Reject malformed escapes and unpaired surrogates. |
| `validate_relative_filesystem_path` | No-op, preserving existing validation | Validate Windows filename representability and reject root/prefix/parent components before a repository path is joined to its root. Component and path-based native open helpers validate too. Unrepresentable names return `io::ErrorKind::InvalidInput` carrying `PathEncodingError`. |
| `validate_path_argument` | No-op | Refuse private transport escapes in path-specific requests before their `PathBuf` spelling can become a direct Git argv value. Filesystem helpers reject the private marker too. |
| `GRACEFUL_TERMINATION` | `true`: retain the two-second TERM/KILL grace | `false`: kill immediately because console signalling is unavailable. |
| `sync_directory` | Exactly `File::sync_all()` | Explicit no-op. File `sync_all` calls are unchanged and their failures still propagate. |
| Error classification / randomness | Original errno mapping / `/dev/urandom` | Win32 missing/directory/link errors / system-preferred `BCryptGenRandom`. |

## Windows differences and explicit policies

- **Directory durability is weaker.** Directory sync is deliberately a no-op:
  the original read-only directory handles cannot satisfy `FlushFileBuffers`'s
  write-access requirement. Requesting directory write access would add permission
  failures to otherwise valid operations, without an established portable
  directory-fsync contract. NTFS metadata journaling protects filesystem
  consistency; it is not a Unix-equivalent power-loss durability guarantee for
  new names. File contents are still flushed. A successful recovery or ignore
  operation does not promise that its directory entries survive sudden power loss.
- **Reparse points are classified by tag.** Read `FILE_ATTRIBUTE_TAG_INFO` from
  the no-follow handle. Reject only the `0x20000000` name-surrogate bit, covering
  symlinks/junctions and other name redirections. Cloud/OneDrive, WOF and dedup
  tags without that bit are allowed. Attribute-only inspection keeps the
  no-follow handle and never hydrates data. Data/directory access reopens the
  held object without `OPEN_REPARSE_POINT`, then rechecks its tag and nonzero
  identity before returning it for I/O. Reopen, hydration, unsupported identity,
  or identity mismatch errors propagate; there is no pathname-follow fallback.
  Actual filter-provider behavior still needs Windows runtime verification.
- **Children have no console.** `CREATE_NO_WINDOW` means no console handle,
  rather than a separate hidden console. CTRL_BREAK cannot be delivered and
  `Signal::Terminate` does nothing on Windows. `GRACEFUL_TERMINATION = false`
  makes the shared runner escalate to `TerminateJobObject` immediately; Unix
  keeps its two-second TERM-to-KILL interval. Setup/I/O failures still terminate
  the owned job immediately during cleanup.
- **Background helpers survive normal completion.** No silent/explicit breakaway
  is enabled during an invocation, so cancellation covers the assigned tree.
  Once the leader is reaped and owned pipes close, `finish` clears kill-on-close
  before closing the job, including a normal nonzero exit, matching Unix's normal
  completion behavior. Disarming is best-effort: if the API fails, mark the
  child finished and preserve its success/nonzero result. The still-armed job may
  terminate background descendants on close; this must not turn successful Git
  work into a reported failure. A helper retaining captured pipes still prevents normal completion
  and is subject to the invocation's timeout/cancellation. Unlike Unix `setsid`,
  Windows detachment does not exempt a helper from cancellation while the
  invocation is active; explicit job-breakaway requests are not enabled. Work
  delegated to unrelated services lies outside either owned tree.
- **Pinned cwd retains a pathname race.** `GetFinalPathNameByHandleW` is resolved
  just before process creation. A concurrent rename/replacement can redirect
  cwd lookup; this remains weaker than Unix `fchdir`. Plain DOS/UNC conversion
  preserves long, trailing-dot/space, reserved-name or other verbatim-only paths
  by retaining the original verbatim spelling when conversion is not safe.
- **Case-insensitive lookup is not assumed to preserve spelling.** Object-manager
  and filesystem settings can alias case even with `OBJECT_ATTRIBUTES.Attributes`
  set to zero. Component opens compare the normalized **volume-relative** handle
  path's leaf with the requested spelling and reject mismatches before access.
  Entry verification needs no drive letter. Failed name queries are wrapped as
  `Other` errors with their original cause, so discard cannot mistake them for
  a missing entry. Only failure of the actual component open with `NotFound`
  qualifies as absence. Canonical repository-root selection still accepts native
  path aliases. These checks detect observed changes, not an external-write transaction.
- **Display names are not filesystem names.** `aux.c`, `con.h`, colons, control
  characters and trailing-dot/space names can be displayed in status/diff/history.
  Accessing such a file through Windows filesystem helpers fails just that
  operation with the typed path error. The `.\` guard for a literal `a:b` is
  needed because an unguarded Windows `PathBuf` would interpret `a:` as a prefix.
  True absolute/drive-rooted input belongs only in the absolute decoder. Unix
  byte-exact behavior is unchanged.
- **Literal Git backslashes have a private transport representation.** A literal
  `\` becomes `U+E000` followed by `b`; a literal `U+E000` becomes `U+E000`
  followed by `e`. The marker is escaped too, preventing collisions with real
  Git names containing that Unicode character. `/` alone divides Git components.
  Thus `folder\file` remains one native component and differs from `folder/file`
  in `PathBuf` equality and both hash/ordered sets. Decoding then Git-byte encoding
  is lossless for accepted names. Empty, repeated-slash, dot and parent components
  are refused rather than normalized into aliases.
  Status, diff and history parsing retain encoded entries and all ordinary entries.
  `output::path` and relative integration parsing share the decoder; absolute
  worktree/ref paths keep their separate native-path decoder. Path-specific
  operations reject private transport values before direct Git argv or native
  filesystem access, so selecting one cannot affect an unrelated real filename.
  This also reserves the marker in native path arguments: concrete access to a
  name containing a literal `U+E000` is unsupported through this representation.
- **Raw labels remain representation-aware.** Public fields are still `PathBuf`.
  Raw `Path::display` can expose the private escapes or the `.\` guard for `a:b`.
  Internally the Git-byte codec restores the original name; all relative decoders
  use the same representation and compare consistently. Equality with an arbitrary
  native `PathBuf::from("a:b")` is not promised, because Windows interprets that
  as drive-relative. Fully transparent labels/native-path equality require a
  dedicated public Git path type; that API change is deliberately out of scope.
- **Network/SMB and FAT are unsupported for identity guarantees.** They have not
  been runtime-validated and may return unsupported, zero, changing or reused
  IDs. Queries that fail or return zero are refused explicitly. A server returning
  nonzero IDs is not a guarantee against reconnect/reuse semantics. Support
  requires Windows/filesystem-specific runtime evidence; there is no weakened
  identity fallback.
- **ACLs replace POSIX modes.** OWNER RIGHTS follows the object's default owner.
  An elevated token can make that owner `BUILTIN\Administrators`, authorizing the
  privileged group rather than one user. This is deliberately documented beside
  Unix's equivalent limitation: privileged root can access 0600/0700 objects.
  Normal metadata comparisons use Windows attributes/change time instead of mode
  bits; timestamp resolution/update timing depends on the filesystem. Neither
  implementation locks out external writers.
- **Thread resumption retains ToolHelp.** `std::Child` hides the initial thread
  handle. The system-wide snapshot has a cost, but uses documented
  `Thread32First`/`OpenThread`/`ResumeThread` APIs and keeps standard `Child`
  ownership. An undocumented `NtResumeProcess` binding or replacing the complete
  spawn implementation is not justified by an unmeasured optimization.

## Findings disposition

| Finding | Disposition |
| --- | --- |
| 1. Directory flush | Fixed by the explicit Windows no-op; weaker durability documented. Unix and file syncs unchanged. |
| 2. All reparse points refused | Fixed: reject name-surrogate tags, reopen data filters by handle, compare identity/tag. |
| 3. Visible consoles | Fixed with `CREATE_NO_WINDOW`; corrected the plan's hidden-console wording to no console. |
| 4. Unsupported names break parsing | Fixed: display decoding is separate from typed filesystem validation; status regression includes `aux.c` and `a:b`. |
| 5. Background daemons killed | Fixed: best-effort disarm after normal completion; no breakaway during cancellation-sensitive work. |
| 6. Verbatim cwd | Fixed: tested DOS/UNC conversion with UTF-16 MAX_PATH and verbatim-only semantic checks. |
| 7. Case-sensitive comment | Fixed comment and added exact volume-relative handle-leaf checks; query failures stay errors. |
| 8. Drive prefixes escape root | Fixed: distinct relative/absolute decoders, guarded drive-like display literals and checks before filesystem joins. |
| 9. Discard reads file data | Fixed: attribute-only final open, tested against a handle denying read-data sharing. |
| 10. Unreliable IDs | Fixed zero/unsupported rejection; unsupported network/FAT identity guarantees documented. |
| 11. Snapshot / ACL owner | Deliberately documented: retain documented resumption APIs and token-default OWNER RIGHTS semantics. |

## Follow-up findings A–E

| Finding | Disposition |
| --- | --- |
| A. Backslash splitting/collisions | Fixed with a reversible per-component private encoding, marker escaping, collision/round-trip tests, and rejection before native paths or direct Git argv. |
| B. Drive-letter name verification | Fixed using `VOLUME_NAME_NONE`; query errors are distinct from absence and retain their cause. |
| C. Unavailable graceful termination | Fixed: Windows reports no graceful termination and skips the delay. Unix timing is unchanged. |
| D. Completed result replaced by disarm error | Fixed: best-effort disarm marks the child finished and preserves Git's result; descendant-termination risk is documented. |
| E. Visible drive guard | Documented: the public `PathBuf` representation and guard remain; all relative decoders compare consistently. A transparent Git path type would require a public API change. |

## Verification

Pure path, cwd, reparse-tag, identity and entry-verification policies run on every
host. The path tests cover round trips, a collision corpus, both Windows separator
spellings, and escaped-marker lookalikes. Windows-only tests cover actual `PathBuf`
hash/ordered-set identity, mixed status entries, typed filesystem refusal, decoder
consistency, and a forced job-disarm failure, as well as the existing regressions.

All existing Unix assertions remain intact. No Windows machine is available, so
Windows tests are compiled/linted, not executed. Linux is also cross-compiled.
No changeset is needed for this unreleased crate. Formatting is restricted to
`cargo fmt -p onegit-git --check`; do not use `--all` on the adjacent Rake dependency.
Final commands and results follow.

## Final follow-up verification (macOS, 2026-10-26)

All 252 baseline test names from `2201f157` remain. Three portable regressions
bring the total to 255 passing tests, including doctests; none failed or were
ignored. Windows-only regressions were compiled and linted, not executed.

| Command | Result |
| --- | --- |
| `cargo fmt -p onegit-git --check` | Passed (exit 0) |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | Passed (exit 0) |
| `cargo clippy -p onegit-git --all-targets --target x86_64-pc-windows-msvc --locked -- -D warnings` | Passed (exit 0) |
| `cargo clippy -p onegit-git --all-targets --target x86_64-unknown-linux-gnu --locked -- -D warnings` | Passed (exit 0) |
| `cargo test -p onegit-git --locked` | 255 passed |

`grep -rnE 'std::os::(unix|fd|windows)|libc::' crates/onegit-git/src`
returned 43 matches, all within `src/platform/`. `git diff --cached --check`
passed. No Windows runtime test was possible. No `cargo fmt --all` was used for
these follow-ups; the main checkout and adjacent Rake sources were not edited.

## API references

- [FlushFileBuffers access requirement](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)
- [Reparse tags](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-point-tags), [FILE_ATTRIBUTE_TAG_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_attribute_tag_info), [ReOpenFile](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-reopenfile)
- [Process creation flags](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags), [job limit flags](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information)
- [Final handle path](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfinalpathnamebyhandlew), [Windows path rules](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file)
- [FILE_ID_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info), [filesystem-specific ID limitations](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/ns-fileapi-by_handle_file_information)
- [Default owner of a new object](https://learn.microsoft.com/en-us/windows/win32/secauthz/owner-of-a-new-object)
