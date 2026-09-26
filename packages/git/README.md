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

## Tests

```bash
bun run --cwd packages/git test
```

Parser and process tests cover protocol boundaries. Integration tests use
isolated, real Git repositories from `tests/_shared/repository-fixture.ts`;
they do not mock the behavior under test.
