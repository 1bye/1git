# @1git/git

## 0.0.2

### Patch Changes

- e4b4eba: Prevent conflict resolution from following replaced symlinks and reuse SSH connections during concurrent reconnects. Support dotted Codex MCP names and filenames containing tabs when generating AI commit messages.
- 53d6a39: Fix Graph tag creation and cherry-picking for commits from other branches, remote refs, and tags while preserving repository and destination checks.
- 5b7f333: Protect reviewed merges from concurrent checkouts and preserve SSH passwords if removing a machine fails. Improve remote file cancellation, batch AI context collection, limit and share restored repository reads, and disable graph branch creation during unfinished Git operations.
- d87006f: - Target exact filenames when resolving conflicts, staging, unstaging, restoring, or stashing selected files.
  - Delete only the reviewed stash during concurrent Git updates, including branch backup cleanup. Safely refuse deletion for unsupported reference formats.
  - Prevent background SSH requests from racing machine settings, removal, or disconnection.
  - Update the source branch when refreshing a pull-request preview after switching branches.
  - Avoid collisions with configured Codex MCP servers when reading large selections.
- 7b9b708: Keep repository setup bound to the selected folder during concurrent filesystem changes, support connected accounts for mixed-case HTTPS remotes, and treat history path filters as literal filenames.
- f12a0a4: Prevent custom API headers from being reused with another server, correctly continue and abort git am conflicts, and count changed file paths once on Home.

## 0.0.1

### Patch Changes

- 37e9b88: Review diverged branches with header confirmation popups and return directly to Changes after integration. Compare either conflict source with the working result in an aligned split diff, with highlighted hunks, expandable context, and clearer file groups and operation status. Reject choosing an indexed version that changed after review. Push remains a separate action.
- 41d4d2d: Fix Git pushes failing when pre-push hooks run Oxlint or other native Node.js tools.
