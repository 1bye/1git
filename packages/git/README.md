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
- Sequences: merge, reviewed squash merge/rebase, cherry-pick, revert, continue/skip/abort
- Sharing: remotes, fetch, pull, push, tags
- Stashes: create, list, apply, pop, drop
- Worktrees: create, list, move, remove, lock, unlock, prune, repair
- Configuration: read, write, and unset local or worktree values

Mutations on one `GitRepository` instance are serialized. Reads wait for the
last queued mutation, so callers receive coherent post-mutation state.
Destructive worktree restore and hard reset require explicit
`allowDestructive: true`.

`cherryPickCommit({ commit, expectedHead, expectedBranch, targetBranch, expectedTarget })`
is the guarded single-commit History workflow alongside general `cherryPick`.
It requires an exact source commit reachable from the reviewed source HEAD, clean
index/worktree, no active operation, and an unchanged, unoccupied local destination.
It rejects merge commits and commits already contained in that destination before
switching. After switching it rechecks the destination and retains Git hooks/signing.
Failures stay on the destination for inspection; there is no forced checkout,
automatic stash, rollback or push. `finishOperation` accepts reviewed `cherry-pick`
identity and metadata tokens for Continue/Abort. Abort restores the destination's
pre-replay state. Other repository instances and external Git processes are not locked.

`integrateBranch({ kind, branch, expectedTarget, expectedHead, expectedBranch, message })`
provides the reviewed `rebase`/`squash-merge` workflows alongside the general methods.
Pass an exact full branch ref and both reviewed OIDs. It rejects detached/unborn HEAD,
changed tips, dirty index/working files and active operations. Rebase refuses
replayed commits reachable from known remote-tracking refs and merge commits;
fetch first if that knowledge may be stale. It retains the old tip under
`refs/1git/rebase/<id>`, disables autostash/updateRefs, and never force-pushes.
Squash requires a first-line message summary, applies the exact target tip and
creates one single-parent commit with that message, preserving hooks/signing.
Already-included work does not produce an empty commit. Both keep the source branch.

Conflicts remain for `finishOperation` with refreshed identity/token; always reread
after failure. Squash uses Git's `SQUASH_MSG` for pending-state detection and its
reviewed message across restarts. Continue commits existing staged resolutions;
Abort uses `reset --merge` only if `ORIG_HEAD` matches the reviewed current tip.
The marker is cleared only after success. Serialization covers one repository
instance; applications must coordinate linked worktrees and avoid external Git writes.

`getCommitFiles(revision, { signal })` returns a commit's changed paths, status,
optional rename source, and before/after blob OIDs without loading patches. Diffs
are relative to the first parent, or the empty tree for root commits. All-zero OIDs
identify an absent side. Use `getDiff({ target: { kind: "commit", revision }, paths })`
for a selected path and `getFileContent({ path, source: { kind: "object", objectId } })`
for its immutable bytes. `getHistory({ revision, offset, limit })` can anchor pages
to an OID independently of later HEAD or working-tree changes.

## One-shot authenticated cloning

`clone({ path, remoteUrl, httpAuthentication: { username, password }, signal })`
accepts optional transient HTTPS credentials. The remote must be credential-free,
without a query or fragment; authenticated submodule recursion is rejected. The
Authorization header is scoped to this remote through `GIT_CONFIG_COUNT` in the
child's environment, not command arguments or a saved config file. The returned
repository does not retain the credential. Normal unauthenticated clone and later
fetch/push use the caller's existing Git credential helpers unless transient
credentials are explicitly supplied for that operation.

Authenticated clone isolates inherited Git config, helpers, traces and templates,
enforces HTTPS/TLS verification and refuses redirects. Custom global Git proxy/CA
settings are intentionally ignored. Error output is replaced with a safe summary,
including when a remote reflects the password/header. No temporary credential files
are created. Child environments/memory can still be inspected by same-user debugging
tools; never log or dump them. The application must authenticate account identity,
authorize the destination host/path, and validate the local destination before calling.

The disposable TLS integration check uses Git/OpenSSL and a local HTTP server,
not a real hosting account: `bun test tests/authenticated-clone.integration.test.ts`.

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

`fetch({ remote, httpAuthentication: { url, username, password } })` and
`syncBranch({ ..., httpAuthentication })` can use one-shot HTTPS authentication.
The supplied URL must exactly match the freshly resolved single fetch/push URL.
Account-authenticated operations refuse redirects and recursive submodule network
access and clear credential helpers/traces. Existing hooks and TLS/proxy/LFS configuration are retained; tokens
are never retained by the repository session. Applications must verify the account
and authorize its host/path before supplying credentials. SSH and unauthenticated
operations retain their normal Git configuration and hooks. As with ordinary Git,
only run network operations in trusted repositories: hooks/filters inherit the
child environment and same-user code can inspect transient credentials.

The API otherwise uses configured credentials and hooks; callers provide deadlines and
serialize separate instances that share a Git common directory. It does not lock
out external Git processes. Always refresh after completion or failure. Cancelling
a command does not roll back a completed remote write; never retry automatically.

## Reviewed release tags

`createReleaseTag({ name, message, commit, expectedHead, expectedBranch, signal })`
creates an annotated local tag at an exact commit in the reviewed History.
It validates the ref name, commit object and reachability, rejects existing names
and stale HEAD/branch or active operations, and leaves working files/index untouched.
Detached HEAD is supported with `expectedBranch: null`. Configured signing is retained.

`pushTag({ name, expectedOid, expectedTarget, remote, expectedUrl, expectedHead,
expectedBranch, httpAuthentication, signal })` is a separate explicit action.
The tag object and peeled target must still match, and the selected remote must
have exactly one matching push URL. It sends the reviewed tag object to only
`refs/tags/<name>` at that URL, never branches, extra tags, force, mirror or recursive
submodule pushes. Existing different remote tags are rejected. Local filesystem
destinations are made absolute to avoid ambiguity with remote names. URLs are
resolved through Git's configured rewrite rules; changing external Git configuration
concurrently is outside the app lock.

Transient HTTPS authentication uses the same validated, non-persisted credential
boundary as branch synchronization; otherwise Git's normal SSH/helpers and hooks
apply. These are Git tags, not provider release records. Callers must authorize
accounts, serialize writes sharing a common directory, supply deadlines and refresh
after any outcome. A cancelled or failed push can have completed remotely: inspect
before retrying, never automatically retry. Disposable coverage:
`bun test tests/tags/release.integration.test.ts`.

## Selected-file commits

`commitFiles({ paths, message, expectedHead, expectedBranch })` commits current
whole-file contents at exact changed paths. Pass the last reviewed snapshot's
`head.oid` and `head.branch` (including `null` for unborn/detached states as applicable).
Unlike `commit`, it does not commit the entire staging area: excluded index entries
and working files are retained. Renames include their old path automatically.

The operation holds the real index lock and prepares an alternate index for
Git's `commit --only`. Hooks and configured signing are honored. Partial staging
in selected files is rejected by default. A checked-whole-file UI can explicitly
pass `includePartialStaging: true` to include **all current edits** in each selected
file, preserving excluded index entries. Submodules, conflicts, active operations, stale HEAD/branch,
and paths that could include unchecked directory descendants are rejected.
It stops honoring cancellation once index preparation starts; let it finish before
closing its owner. Reads and writes on the same repository instance stay serialized.

For partial text commits, pass `partialFiles: [{ path, expectedPatch, includedLines }]`.
Use the unfiltered `getDiff({ target: { kind: "changes" }, paths: [path] })` patch with
default context. `PartialPatch` exposes stable `-:oldLine` / `+:newLine` keys. The transaction
rejects a stale patch, unsupported metadata or unknown coordinates. It prepares a separate
HEAD-based commit index and applies only included edits; hooks and signing still run.
Excluded edits remain in working files as unstaged changes; unchecked files' index entries
are preserved. Line inclusion never edits working files or stages the user's index.

Pass `amend: true` to replace the reviewed unpublished, non-merge branch tip instead
of creating another commit. Empty `paths` change only its message, preserving all
staged and working edits. Whole-file and partial selections add to the original
commit's tree; Git retains the original author and parents. Staged mode is not
supported for amendments. Publication/identity checks reuse `getCommitRecovery`
and are repeated immediately before writing; old commits are retained under
`refs/1git/amend/<id>` for manual recovery. Hooks, signing and uncertain outcomes
behave as for normal selected-file commits. Remote knowledge can be stale: fetch
first when another tool may have published the tip. External Git writers are not locked.

`GitResult<CommitFilesResult>` separates ordinary preflight/command failures from
post-write recovery. An `ok` result has `outcome: "committed" | "unknown"`, optional
`oid`/`snapshot`, and an optional `warning`. A confirmed commit remains successful
even if refresh fails. An uncertain outcome or index-install failure retains recovery
files and explains where to find them. Do not automatically retry; inspect History
and the warning first. Ordinary rejected commits leave the original index untouched;
configured hooks can have their own filesystem side effects.

`getDiff({ target: { kind: "changes" }, paths })` previews those complete
HEAD-to-current-file changes (including first-commit files). It uses a disposable
index containing existing object IDs only; the real index and object store are
not modified. Existing `working` (index-to-worktree) and `staged` (HEAD-to-index)
targets remain available to clients that expose staging.

## Tests

```bash
bun run --cwd packages/git test
```

Parser and process tests cover protocol boundaries. Integration tests use
isolated, real Git repositories from `tests/_shared/repository-fixture.ts`;
they do not mock the behavior under test.
