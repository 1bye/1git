# onegit-git porting notes

The local repository facade now has a Rust equivalent for all 86 public methods
in `packages/git/src/repository.ts` at source commit
`e1adb74ae01a7618e10a1522c74284311e35d69f`. The TypeScript Git sources are identical
in the Rust baseline. This crate owns native Git execution and repository rules;
Rake/GPUI views, accounts/OS vaults, SSH connection orchestration and AI providers
remain application work. The existing Rust SSH helper can embed these rules later;
the JavaScript global runtime-injection mechanism is not reproduced in this crate.

## API mapping

`GitRepository` becomes `Repository`; `GitResult<T>` becomes typed Rust `Result`.
Read failures retain `RepositoryError`; writes also identify pre-command, command
and refresh phases. `Failure::from_repository`/`from_process` retain presentation
codes and safe messages. Public repository-relative names use exact-byte `GitPath`.

| TypeScript method | Rust method |
| --- | --- |
| `open` | `Repository::open` |
| `initialize` | `Repository::initialize` |
| `clone` | `Repository::clone` |
| `getSnapshot` | `Repository::snapshot` |
| `getHistory` | `Repository::history` |
| `getUnpushedCommits` | `Repository::unpushed_commits` |
| `getHistoryCount` | `Repository::history_count` |
| `getCommit` | `Repository::commit` |
| `getCommitFiles` | `Repository::commit_files` |
| `compareBranches` | `Repository::compare_branches` |
| `getBranches` | `Repository::branches` |
| `getTags` | `Repository::tags` |
| `getRemotes` | `Repository::remotes` |
| `getStashes` | `Repository::stashes` |
| `getWorktrees` | `Repository::worktrees` |
| `getDiff` | `Repository::diff` |
| `getFileContent` | `Repository::file_content` |
| `resolveConflict` | `Repository::resolve_conflict` |
| `stage` | `Repository::stage` |
| `changeHunk` | `Repository::change_hunk` |
| `ignoreFile` | `Repository::ignore_file` |
| `discardFiles` | `Repository::discard_files` |
| `undoDiscard` | `Repository::undo_discard` |
| `stageAll` | `Repository::stage_all` |
| `unstage` | `Repository::unstage` |
| `unstageAll` | `Repository::unstage_all` |
| `restore` | `Repository::restore` |
| `reset` | `Repository::reset` |
| `commitFiles` | `Repository::commit_selected_files` |
| `getCommitRecovery` | `Repository::review_last_commit` |
| `undoCommit` | `Repository::undo_last_commit` |
| `getResetCommitPlan` | `Repository::reset_commit_plan` |
| `resetToCommit` | `Repository::reset_to_commit` |
| `getSquashPlan` | `Repository::squash_plan` |
| `squashCommits` | `Repository::squash_commits` |
| `getReorderPlan` | `Repository::reorder_plan` |
| `reorderCommits` | `Repository::reorder_commits` |
| `commit` | `Repository::commit_index` |
| `createBranch` | `Repository::create_branch` |
| `checkoutBranch` | `Repository::checkout_branch` |
| `renameBranch` | `Repository::rename_branch` |
| `deleteBranch` | `Repository::delete_branch` |
| `setUpstream` | `Repository::set_upstream` |
| `merge` | `Repository::merge` |
| `finishOperation` | `Repository::finish_operation` |
| `abortMerge` | `Repository::abort_merge` |
| `continueMerge` | `Repository::continue_merge` |
| `rebase` | `Repository::rebase` |
| `integrateBranch` | `Repository::integrate_branch` |
| `continueRebase` | `Repository::continue_rebase` |
| `skipRebase` | `Repository::skip_rebase` |
| `abortRebase` | `Repository::abort_rebase` |
| `cherryPick` | `Repository::cherry_pick` |
| `cherryPickCommit` | `Repository::cherry_pick_commit` |
| `continueCherryPick` | `Repository::continue_cherry_pick` |
| `abortCherryPick` | `Repository::abort_cherry_pick` |
| `revert` | `Repository::revert` |
| `revertCommit` | `Repository::revert_commit` |
| `continueRevert` | `Repository::continue_revert` |
| `abortRevert` | `Repository::abort_revert` |
| `createReleaseTag` | `Repository::create_release_tag` |
| `pushTag` | `Repository::push_tag` |
| `createTag` | `Repository::create_tag` |
| `deleteTag` | `Repository::delete_tag` |
| `addRemote` | `Repository::add_remote` |
| `renameRemote` | `Repository::rename_remote` |
| `setRemoteUrl` | `Repository::set_remote_url` |
| `removeRemote` | `Repository::remove_remote` |
| `fetch` | `Repository::fetch` |
| `pull` | `Repository::pull` |
| `push` | `Repository::push` |
| `syncBranch` | `Repository::sync_branch` |
| `stash` | `Repository::stash` |
| `applyStash` | `Repository::apply_stash` |
| `popStash` | `Repository::pop_stash` |
| `dropStash` | `Repository::drop_stash` |
| `createWorktree` | `Repository::create_worktree` |
| `moveWorktree` | `Repository::move_worktree` |
| `removeWorktree` | `Repository::remove_worktree` |
| `lockWorktree` | `Repository::lock_worktree` |
| `unlockWorktree` | `Repository::unlock_worktree` |
| `pruneWorktrees` | `Repository::prune_worktrees` |
| `repairWorktrees` | `Repository::repair_worktrees` |
| `getConfig` | `Repository::config` |
| `setConfig` | `Repository::set_config` |
| `unsetConfig` | `Repository::unset_config` |

`CloneOptions`/`FetchOptions`/`SyncBranch`/`PushTag` borrow transient
`HttpAuthentication`. These requests do not store credentials in the repository.
`GitCommand::{on_output,on_progress}` expose incremental bounded output and
sanitized object-phase progress. Raw output callbacks are suppressed during account
authentication, and nonzero authenticated command output is replaced with safe
summaries. `commit_selected_files_with_progress` adds preparing/committing/refreshing
and incremental hook bytes while retaining the ordinary selected-commit API.
Callbacks run synchronously on the owned worker: they must not block or reenter
repository methods while the write queue is held. Observer panics cannot interrupt
process, index or ref cleanup.

## Test mapping

Existing parser/reference fixtures and the local-core suites remain in place.
The following additions cover the previously missing source API families; related
source cases share real-Git fixtures rather than duplicating setup.

| Source suite/cases | Rust coverage |
| --- | --- |
| `remotes-stash.integration`: add/list/rename/set/add/push URLs/remove and credential refusal | `metadata_writes.rs::adds_renames_updates_and_removes_remotes_without_persisting_http_credentials` |
| `branches.integration`: lightweight/annotated/duplicate/forced/deleted tags | `metadata_writes.rs::creates_and_deletes_lightweight_and_annotated_tags_with_explicit_force` |
| `repository.integration`: scoped config, restore/reset consent | `metadata_writes.rs` configuration and restore/reset tests |
| `remotes-stash.integration`: selected paths, untracked files, apply/pop/drop, saved staging and conflicted pop | `metadata_writes.rs` stash tests, including literal glob-neighbor refusal |
| `repository.integration`: stage/unstage/discard individual hunks and consent | `hunks.rs`, plus the shared discard/undo suites |
| `branches.integration`: ordinary cherry-pick/revert | `sequences.rs::cherry_picks_a_commit_and_reverts_it_with_ordinary_git_hooks` |
| History reviewed cherry-pick/revert guards and durable operation Continue/Abort | `sequences.rs` reviewed replay tests and `integration.rs` existing reviewed operation-state coverage |
| `repository.integration`: index commit, summary/body, empty commit | `sequences.rs::creates_a_structured_index_commit_and_rejects_empty_summaries` |
| Commit-files lifecycle and incremental hook output | `sequences.rs::selected_commit_streams_lifecycle_and_output_without_allowing_observers_to_break_cleanup` |
| `remotes-stash.integration`: upstream push, fetch all, pull, invalid branch-only input | `network.rs::pushes_establishes_upstream_fetches_and_pulls_from_a_local_remote` |
| UI branch sync: publication, exact refs, stale/tracking/dirty/divergent/ambiguous destinations | `network.rs` reviewed sync tests with disposable local remotes |
| `tags/release.integration`: reviewed annotated object, duplicate refusal, exact single-tag push, hooks, different remote tag, relative-path alias | `network.rs` release tag tests |
| `authenticated-clone.integration`: real TLS clone/fetch/pull/push, inherited config isolation, recursive refusal, redirect/401/403 redaction and cancellation | `https_authentication.rs` with `fixtures/https_git.py` |
| `git-process/environment.integration`: child-only config, cleared override variables, no saved credentials | `authentication.rs` |
| `git-process/progress.unit`: split chunks/CRLF, deduplication, bounded lines, invalid percentages, no raw remote text | `progress.rs` unit tests |
| `history/squash.integration`: middle/root range, later/empty replay, original refs/index/tree, hooks, external branch movement and refusal guards | `history_rewrite.rs` squash tests |
| `history/reorder.integration`: permutation/root, replay conflicts, final-tree mismatch, hooks, original refs/index, linked worktree and shallow/merge refusal | `history_rewrite.rs` reorder tests |
| `history/reset.integration`: ancestor/count/publication, merge-side reachability, current-tip/dirty/stale/lock refusal, index/files preservation | `history_rewrite.rs` guarded reset tests |
| Windows bulk selections beyond CreateProcess limits, including unborn index removal | `staging.rs::streams_literal_bulk_selections_beyond_windows_argv_limits_including_unborn_unstage` |

The TLS suite uses real Git/OpenSSL and a disposable Python standard-library server
on loopback. Its wrapper trusts only the generated test CA; production never disables
certificate verification. The library itself requires neither Python nor OpenSSL CLI.
All remotes/credentials/working trees in these tests are disposable test data.

## Deliberate differences and preserved policies

- Rust API names distinguish read-only `commit`/`commit_files` queries from
  `commit_index`/`commit_selected_files` mutations. Requests use typed enums/options.
- Operations block on the caller-owned worker. `RepositoryCoordinator` can share FIFO
  guards across reopened aliases and linked worktrees; external Git is not locked out.
- The existing selected-commit contract defers late cancellation once private-index
  preparation begins. The owner waits for completion/cleanup and retains close
  protection. New progress callbacks do not change that contract.
- Ref installation for history edits is uncancellable once it starts. The old tip and
  branch move commit together under compare-and-swap. Post-write warnings must never
  trigger automatic retries. Scratch objects can be created even on a refused rewrite.
- Squash/reorder retain the source's 1,000 affected-commit limit, clean named linear
  unpublished history, root ordering, submodule/shallow refusal, effective signing/hooks,
  author/message/empty-commit retention and final-tree equality. Hooks can have independent
  filesystem/network effects; the crate does not sandbox them. Publication means
  locally known remote reachability; callers must fetch when that knowledge may be stale.
- Ordinary lower-level reset/amend/push options retain explicit destructive or
  force-with-lease behavior. Reviewed UI flows use the conservative guarded variants.
- Hunk actions and selected-line commits verify Git's decoded apply destination equals
  the requested exact path. The regressions for `diff.noprefix` prevent writes or commits
  to an unchecked neighbor; rename metadata or custom prefixes that select another path
  are refused explicitly. This tightens source behavior at the write boundary.
- Hunk discard uses the Rust core's held-file, private disk-backed recovery rather
  than the source's in-memory patch token. The existing one-use 15-second undo contract
  remains; backups are retained even after expiry or session shutdown.
- Literal selections stay exact. Stage/unstage/restore/stash use NUL-delimited input
  to avoid Windows argument limits. Stash uses per-name `:(literal)` prefixes so Git's
  internal root-magic cleanup continues to work; no global literal mode reaches it.
- `GitPath` retains raw Unix bytes. Windows refuses unrepresentable native names and
  backslash pathspec aliases instead of silently normalizing them. Windows final-symlink
  discard refusal, directory durability and supported-filesystem limits remain documented
  in `src/platform/README.md`.
- The two existing 54 MiB Windows binary stress tests retain their 15-minute measured
  budget. Other tests retain five minutes. No stress fixture or safety assertion was cut.

## Verification

The API audit enumerated all 86 public TypeScript repository methods and checked
that every mapped Rust method is publicly defined. Focused real-Git suites,
workspace Clippy and Windows/Linux cross-target Clippy are run during development.
Final validation uses:

```sh
cargo fmt -p onegit-git --check
cargo build -p onegit-git --locked
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo doc -p onegit-git --no-deps --locked
cargo test -p onegit-git --locked
```

The manual `Rust platforms` workflow runs unfiltered native tests, doctests and
warnings-as-errors Clippy on Linux, Windows and macOS. Run evidence is recorded in
GitHub Actions for `rust/gpui`; app/UI launch and packaging are separate checks.
No changeset is needed: this Rust crate is unreleased (`publish = false`).
