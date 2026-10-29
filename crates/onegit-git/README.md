# onegit-git

Native Git CLI execution and repository rules for the Rust 1git application,
independent of Rake, GPUI and JavaScript. Calls block: run them on an owned
background worker, retain cancellation/close protection, and await cleanup.

The local API covers repository setup/status/history/content/diffs, exact-name
staging and hunk selection, commits/amend/undo, private discard/recovery,
branches/worktrees, merge/rebase/cherry-pick/revert, remotes/sync/tags/stashes,
scoped configuration and reviewed unpublished-history squash/reorder/reset.

```rust,no_run
use onegit_git::{GitProcess, Repository};
# fn main() -> Result<(), Box<dyn std::error::Error>> {
let repository = Repository::open(std::path::Path::new("/local/repository"), GitProcess::default(), None)?;
let snapshot = repository.snapshot(false, None)?;
for file in snapshot.status.files {
    println!("{}", file.path.display());
}
# Ok(())
```

Use `RepositoryCoordinator` when several sessions share aliases or linked worktrees.
It serializes application writes; other Git processes can still change the repository.
Use captured `BranchIdentity` and guarded requests for reviewed UI actions. Inspect
post-write warnings and uncertain outcomes before retrying any mutation.

Account authentication is optional, child-only and HTTPS-only. Caller-validated account
identity and exact destination remain the app's responsibility. Hooks/filters in an
existing repository can inherit the transient child environment: use trusted repositories.
Cloning with account credentials isolates inherited Git config/templates/hooks, refuses
redirects and submodule recursion, and never saves an Authorization header or password.

See [PORTING.md](PORTING.md) for all 86 source API mappings, test coverage and deliberate
behavior differences, and [platform policies](src/platform/README.md) for Windows
filesystem/process limits. The Python/OpenSSL tools used by TLS tests are not runtime
dependencies. This crate does not implement UI, SSH connection management or hosting APIs.
