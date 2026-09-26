# @1git/git

Typed, structured repository control for the 1git desktop application. The
package executes the system Git binary without a shell, converts output into
serializable objects, and returns stable result objects instead of throwing
through the application boundary.

## Usage

```ts
import { GitRepository } from "@1git/git";

const opened = await GitRepository.open({ path: "/path/to/repository" });

if (!opened.ok) {
  // Handle opened.error.code without parsing Git's human-readable output.
  throw new Error(opened.error.message);
}

const repository = opened.value;
const snapshot = await repository.getSnapshot();

if (snapshot.ok) {
  console.log(snapshot.value.head, snapshot.value.files);
}
```

Every method returns `GitResult<T>`:

```ts
type GitResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: GitError };
```

## API areas

- Repository sessions: open, initialize, clone, cancellation, bounded output
- State: snapshot, HEAD/tracking, active operation, changes, stashes
- History: paginated commits, commit metadata, committed file lists, file content, structured diffs
- Index and commits: stage, unstage, restore, reset, commit, amend
- Branches: create, switch, rename, delete, set upstream
- Sequences: merge, rebase, cherry-pick, revert, continue/skip/abort
- Sharing: remotes, fetch, pull, push, tags
- Stashes: create, list, apply, pop, drop
- Worktrees: create, list, move, remove, lock, unlock, prune, repair
- Configuration: read, write, and unset local or worktree values

Mutations on one `GitRepository` instance are serialized. Reads wait for the
last queued mutation, so callers receive coherent post-mutation state.
Destructive worktree restore and hard reset require explicit
`allowDestructive: true`.

`getCommitFiles(revision, { signal })` returns a commit's changed paths, status,
optional rename source, and before/after blob OIDs without loading patches. Diffs
are relative to the first parent, or the empty tree for root commits. All-zero OIDs
identify an absent side. Use `getDiff({ target: { kind: "commit", revision }, paths })`
for a selected path and `getFileContent({ path, source: { kind: "object", objectId } })`
for its immutable bytes. `getHistory({ revision, offset, limit })` can anchor pages
to an OID independently of later HEAD or working-tree changes.

## Guarded single-branch synchronization

`syncBranch({ kind, expectedHead, expectedBranch, remote, remoteRef, signal })`
provides a conservative UI workflow alongside the general `pull`/`push` methods.
The kind is `pull`, `push`, or `publish`. Supply the reviewed HEAD OID and local
branch name. For an existing upstream, use `BranchInfo.upstreamRemote` and
`upstreamRef`; do not infer a destination by splitting the display label.

Pull requires a clean working tree and fast-forwards only, without rebase or
autostash. Push sends the reviewed OID to the explicit upstream branch with no
force, mirror, automatic tags, or recursive submodule pushes. Publish requires
no existing upstream, sends the current branch to the same name on the explicitly
chosen remote, and sets tracking. Push and Publish reject multiple push URLs.
All three reject detached/unborn HEAD, stale branch identity and active operations.

The API uses configured credentials and hooks; callers provide deadlines and
serialize separate instances that share a Git common directory. It does not lock
out external Git processes. Always refresh after completion or failure. Cancelling
a command does not roll back a completed remote write; never retry automatically.

## Selected-file commits

`commitFiles({ paths, message, expectedHead, expectedBranch })` commits current
whole-file contents at exact changed paths. Pass the last reviewed snapshot's
`head.oid` and `head.branch` (including `null` for unborn/detached states as applicable).
Unlike `commit`, it does not commit the entire staging area: excluded index entries
and working files are retained. Renames include their old path automatically.

The operation holds the real index lock and prepares an alternate index for
Git's `commit --only`. Hooks and configured signing are honored. Partial staging
in selected files, submodules, conflicts, active operations, stale HEAD/branch,
and paths that could include unchecked directory descendants are rejected.
It stops honoring cancellation once index preparation starts; let it finish before
closing its owner. Reads and writes on the same repository instance stay serialized.

`GitResult<CommitFilesResult>` separates ordinary preflight/command failures from
post-write recovery. An `ok` result has `outcome: "committed" | "unknown"`, optional
`oid`/`snapshot`, and an optional `warning`. A confirmed commit remains successful
even if refresh fails. An uncertain outcome or index-install failure retains recovery
files and explains where to find them. Do not automatically retry; inspect History
and the warning first. Ordinary rejected commits leave the original index untouched;
configured hooks can have their own filesystem side effects.

## Tests

```bash
bun run --cwd packages/git test
```

Parser and process tests cover protocol boundaries. Integration tests use
isolated, real Git repositories from `tests/_shared/repository-fixture.ts`;
they do not mock the behavior under test.
