# Native platform boundary

The private `platform` module selects Unix or Windows at compile time. Other
hosts produce a compile error. Repository names use public `GitPath`; there are no UI or
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
| `GitPath::to_native` / `native_path_from_git_bytes` | Exact bytes become native `OsString` only at filesystem access | Validate UTF-8 and every Git component before creating a native path. Refuse literal backslashes, colons, device names and other unrepresentable names with the typed path error. |
| `absolute_path_from_git_bytes` | Identical original byte conversion | Separate decoder for absolute `rev-parse` and worktree paths. Require an absolute native path and valid UTF-8 without NUL. |
| `path_to_git_bytes` (native locations only) | Borrow native bytes | Encode UTF-8, normalize native separators, strip extended-length prefixes; reject unpaired surrogates. Never decodes private characters or Git names. |
| `validate_relative_filesystem_path` | No-op, preserving existing validation | Validate Windows filename representability and reject root/prefix/parent components before a repository path is joined to its root. Component and path-based native open helpers validate too. Unrepresentable names return `io::ErrorKind::InvalidInput` carrying `PathEncodingError`. |
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
- **Git names and native names are separate.** `GitPath` can display and compare
  `aux.c`, `a:b`, literal backslashes, control bytes and trailing-dot/space names.
  Windows native conversion rejects unrepresentable names before a filesystem
  join/open. Git argument conversion retains literal UTF-8 spelling independently
  of native filename validation; non-UTF-8 argv on Windows returns the typed path
  error. Native user-supplied folders never pass through a Git-name decoder.
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
| 4. Unsupported names break parsing | Fixed: exact-byte Git parsing is separate from typed filesystem validation; status regression includes `aux.c` and `a:b`. |
| 5. Background daemons killed | Fixed: best-effort disarm after normal completion; no breakaway during cancellation-sensitive work. |
| 6. Verbatim cwd | Fixed: tested DOS/UNC conversion with UTF-16 MAX_PATH and verbatim-only semantic checks. |
| 7. Case-sensitive comment | Fixed comment and added exact volume-relative handle-leaf checks; query failures stay errors. |
| 8. Drive prefixes escape root | Fixed: distinct Git/native path types and representability checks before filesystem joins. |
| 9. Discard reads file data | Fixed: attribute-only final open, tested against a handle denying read-data sharing. |
| 10. Unreliable IDs | Fixed zero/unsupported rejection; unsupported network/FAT identity guarantees documented. |
| 11. Snapshot / ACL owner | Deliberately documented: retain documented resumption APIs and token-default OWNER RIGHTS semantics. |

## Follow-up findings A–E

| Finding | Disposition |
| --- | --- |
| A. Backslash splitting/collisions | Fixed with bytewise `GitPath` identity, direct Git-byte arguments, and typed rejection before native filesystem access. |
| B. Drive-letter name verification | Fixed using `VOLUME_NAME_NONE`; query errors are distinct from absence and retain their cause. |
| C. Unavailable graceful termination | Fixed: Windows reports no graceful termination and skips the delay. Unix timing is unchanged. |
| D. Completed result replaced by disarm error | Fixed: best-effort disarm marks the child finished and preserves Git's result; descendant-termination risk is documented. |
| E. Visible drive guard | Fixed by the breaking `GitPath` API: labels show drive-like names literally and require no native guard. |

## GitPath API and migration inventory

`GitPath(Arc<[u8]>)` owns exact Git bytes with bytewise `Eq`, `Ord` and `Hash`.
`new(impl AsRef<[u8]>) -> Result<GitPath, GitPathError>` and `TryFrom<&str>`
reject empty, rooted, NUL, repeated-separator, dot and parent components.
One trailing `/` is accepted and preserved for Git's ignored-directory status
marker; component/filename/parent views omit that marker. This exception preserves
existing status bytes and was explicitly approved during this task.

`as_bytes()` borrows the exact spelling; `to_str()` returns `Option<&str>`;
`display()` shows valid UTF-8 literally, replacing only invalid UTF-8 in a label.
`components()` is a cloneable double-ended iterator of borrowed byte slices,
`file_name()` borrows the final component, and `parent()` borrows the parent bytes
or returns `None`. There is no implicit native-path conversion or native-path
comparison. `to_native()` and `to_argument()` remain crate-private and route through
`platform`; conversion failures are `InvalidInput` I/O errors carrying the existing
`PathEncodingError`. No serde support was added because the crate has no existing
serde-facing path-type convention. No dependencies were added.

### Public fields and functions changed

| Public surface | Decision |
| --- | --- |
| `FileChange::{path, original_path}` | `GitPath` / `Option<GitPath>`: porcelain names, including ignored directory markers. |
| `DiffOptions::paths` | `Option<&[GitPath]>`: literal repository filters. |
| `DiffStat::{path, original_path}` | `GitPath` / `Option<GitPath>`: Git numstat names. Untracked no-index counts use the already selected Git name, never the native `/dev/null` sentinel. |
| `CommitFile::{path, original_path}` | `GitPath` / `Option<GitPath>`: committed tree names. |
| `HistoryOptions::{paths, file_path}` | `Option<&[GitPath]>` / `Option<&GitPath>`: literal filters and rename-follow selection. |
| `FileContent::path`, `Repository::file_content(requested)` | `GitPath` / `&GitPath`: requested tree name; working preview converts at filesystem access. |
| `ResolveConflict::path`, `Repository::conflict_preview(path)` | `GitPath` / `&GitPath`: exact conflicted tree entry. |
| `IgnoreFile::path`, `ignore_pattern(path)` | `GitPath` / `&GitPath`: selected changed file; existing UTF-8/line-break/scope rules still apply. |
| `PartialCommitFile::path`, `CommitFiles::paths`, `CommitFiles::new(paths)` | `GitPath`, `Vec<GitPath>`, `Vec<GitPath>`: reviewed complete/partial selection. |
| `DiscardFiles::paths`, `DiscardUndo::path` | `Vec<GitPath>` / `GitPath`: selected names and first selected undo entry. |
| `Repository::{stage, unstage}(paths)` | `&[GitPath]`: exact literal names. |

Methods consuming/returning these records retain their operation contracts;
status, diff, history, conflict and integration parsers construct `GitPath` directly
from output bytes. Pathspec argv uses byte-preserving platform argument conversion;
NUL-separated stdin uses `as_bytes()` directly. Neither goes through a native path.
`require_paths` accepts `GitPath`, rejects empty selections and `.git` components;
constructor validation prevents NUL/root/dot/parent traversal and negative depth.

### Public native paths deliberately retained

| Public surface | Reason |
| --- | --- |
| `RepositoryInfo::{root, git_directory, common_directory}` (`PathBuf`) | Real canonical working/admin directories. |
| `Branch::worktree_path` (`Option<PathBuf>`), `Worktree::path` (`PathBuf`) | Registered native checkout locations. |
| `DiscardRecovery::directory`, `RecoveryBackup::directory` (`PathBuf`) | Persistent native backup destinations. |
| `CreateWorktree::path` (`&Path`), `CreateWorktree::new(path)` | Native linked-checkout destination. |
| `WorktreeRequest::{Create, Remove}::path`, `WorktreeMutation::path` (`PathBuf`) | Reviewed native destination/registration and resulting checkout. |
| `CloneOptions::destination` (`&Path`), `CloneOptions::new(remote, destination)` | Native clone destination. |
| `ToolCommand::{executable, cwd}` (`&Path`), `ToolCommand::new(executable, cwd, args)` | Native process location and working directory. |
| `GitCommand::{cwd, index_file}` (`&Path` / `Option<&Path>`), `GitCommand::new(cwd, args)` | Native working/admin locations, including alternate index files. |
| `GitProcess::new(executable: impl Into<PathBuf>, ...)` | Native executable. |
| `Repository::open(path)`, `Repository::initialize(destination)` | Native repository selection/setup. |
| `Repository::{clone, create_worktree, change_worktree}` | Their options/requests above retain native destinations. |
| `Repository::move_worktree(path, new_path)`; `remove_worktree(path)`; `lock_worktree(path)`; `unlock_worktree(path)` | Native registered checkout locations. |
| `Repository::repair_worktrees(paths: &[PathBuf])` | Native checkout directories to repair. |
| `SavedBranchChanges::from_stashes(root: &Path, ...)` | Native canonical root identifies a worktree's stash metadata. |
| `RepositoryCoordinator::pending_writes(common_directory: &Path)` | Native common admin directory identifies the queue. |

Private `Recovery::paths`, selected-commit sets, integration candidates and all
other repository-relative helpers also use `GitPath`; `Recovery::path`, private
index/lock files and pinned filesystem handles remain native. Conversion occurs
only before working-file preview/open, selected-file metadata checks, integration
ancestor metadata checks and discard no-follow validation. The existing platform
filesystem helpers continue validating their native inputs.

### Removed internals and tests

Removed the reversible private-character codec, drive display guard,
`relative_git_path`, `git_path_text`, and the old argument-validator shim.
The private-use character is ordinary filename text again. The native-only
`path_to_git_bytes` helper remains for real folders/admin paths, without escape
interpretation. Only tests checking literal private-use text contain its codepoint.

Only these escape/guard-specific tests were deleted:

- `relative_decode_rejects_roots_and_guards_drive_relative_display_names`
- `backslashes_and_the_escape_character_round_trip_without_aliasing`
- `short_git_names_have_injective_native_components_and_lossless_encoding`
- `drive_like_names_use_the_same_guard_in_all_relative_decoders` (Windows-only)

Their still-relevant root/component refusal assertions are covered by the portable
native-name policy test. Existing behavior tests are migrated, including constructor
rejection for invalid paths that can no longer be represented as request values.
The staged-mode ignored selection uses `.git/ignored-in-staged-mode`, a structurally
valid but operation-invalid name, to retain the original ignored-selection assertion.

## Verification (macOS, 2026-10-26)

The non-UTF-8 Unix end-to-end regression uses a real committed Git index/tree
name, reads it from status, stages its deletion and checks the exact cached name
and committed content. APFS rejects non-UTF-8 filesystem entries, so this tests
Git's real raw-byte flow without pretending such a native entry can exist here.

All required commands passed:

| Command | Result |
| --- | --- |
| `cargo fmt -p onegit-git --check` | Passed |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | Passed |
| `cargo clippy -p onegit-git --all-targets --target x86_64-pc-windows-msvc --locked -- -D warnings` | Passed |
| `cargo clippy -p onegit-git --all-targets --target x86_64-unknown-linux-gnu --locked -- -D warnings` | Passed |
| `cargo test -p onegit-git --locked` | 260 passed, including doctests; 0 failed/ignored |

The test-name audit against `b0085968` accounts for all 255 baseline tests:
three portable escape-only tests removed, eight portable tests added, giving 260.
The fourth removed test was Windows-only. The new test functions are:

- `git_path::tests::constructor_rejects_invalid_git_components_without_native_path_rules`
- `git_path::tests::equality_ordering_and_hashing_use_exact_bytes`
- `git_path::tests::labels_show_valid_names_literally_and_only_invalid_utf8_is_lossy`
- `git_path::tests::component_filename_and_parent_views_split_only_on_git_separators`
- `platform::windows_policy::tests::native_git_paths_reject_unrepresentable_components_without_transport_escapes`
- `repository::diff::tests::numstat_keeps_reserved_colon_and_literal_backslash_git_names`
- `status_keeps_reserved_colon_and_literal_backslash_git_names`
- `non_utf8_name_round_trips_from_status_to_staging` (Unix; executed on macOS)
- `git_path::tests::native_conversion_refuses_unrepresentable_names_with_the_typed_error` (Windows-only; compiled/linted)

The existing non-UTF-8 numstat parser test now runs on every OS. All other existing
test function names remain, including Windows safety tests migrated to explicit
native conversion. Source-name comparison confirms exactly the four removed and
nine added functions listed above.

The OS-reference scan found 43 `std::os::{unix,fd,windows}` / `libc` references,
all in `src/platform/`. There are three remaining private-use-codepoint literals:
two in `git_path.rs` tests (literal display/native acceptance), one in Windows
tests (distinct identity and native acceptance). None implements a transport
representation or reserves that character. The removed codec/argument-validator
symbols have no Rust implementation or call sites. `git diff --check` passed.

No Windows runtime test was possible; Linux was cross-compiled/linted only.
Formatting was restricted to this crate; the main checkout and Rake were not
edited. No serde convention or dependency was added. No changeset is needed for
this unreleased crate.

## API references

- [FlushFileBuffers access requirement](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)
- [Reparse tags](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-point-tags), [FILE_ATTRIBUTE_TAG_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_attribute_tag_info), [ReOpenFile](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-reopenfile)
- [Process creation flags](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags), [job limit flags](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information)
- [Final handle path](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfinalpathnamebyhandlew), [Windows path rules](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file)
- [FILE_ID_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info), [filesystem-specific ID limitations](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/ns-fileapi-by_handle_file_information)
- [Default owner of a new object](https://learn.microsoft.com/en-us/windows/win32/secauthz/owner-of-a-new-object)
