# @1git/gpuix

## 0.1.2

### Minor Changes

- 7a1675c: Make branches easier to find with a left-rail branch panel, the current branch highlighted in the rail panel, branch search, and direct New Worktree and New Branch actions. Focus branch search immediately on opening the panel, with a visible keyboard highlight and arrow-key navigation through matching branches and Enter to select. Keep publishing and sync first in the rail, followed by Branches. Teach finding and creating branches in the introductory tour before advanced workflows.

  Remove the duplicate sidebar divider while preserving its drag target and keyboard focus indicator.

  Show a centered, illustrated empty state with a helpful hint when branch search has no matches.
- b180696: Resize graph commit details and changed-file panels, and create local branches at selected commits without switching branches or changing working files.

  Use the existing History confirmations to cherry-pick, revert, reset, and create or push tags directly from graph commits, with the same operation guards and conflict recovery.
- b58c269: Add a dedicated Help settings tab for guided tips, first-run setup, and GitHub issue and project links. Keep Appearance focused on visual preferences.
- a450ccc: Resize repository file lists and the graph's branch and tag sidebar by dragging their edges or using the keyboard. Sidebar widths are remembered across tabs and app restarts.

  Choose Fine, Classic or Coarse chrome grain and adjust its strength in Appearance settings. All choices share smaller textures, reducing decoded grain texture memory by 75% while retaining the Classic appearance and fast resizing.

### Patch Changes

- e4b4eba: Prevent conflict resolution from following replaced symlinks and reuse SSH connections during concurrent reconnects. Support dotted Codex MCP names and filenames containing tabs when generating AI commit messages.
- 53d6a39: Fix Graph tag creation and cherry-picking for commits from other branches, remote refs, and tags while preserving repository and destination checks.
- 8d3468c: Darken dialog and branch-menu backdrops to make foreground controls stand out more clearly.
- 5b7f333: Protect reviewed merges from concurrent checkouts and preserve SSH passwords if removing a machine fails. Improve remote file cancellation, batch AI context collection, limit and share restored repository reads, and disable graph branch creation during unfinished Git operations.
- d87006f: - Target exact filenames when resolving conflicts, staging, unstaging, restoring, or stashing selected files.
  - Delete only the reviewed stash during concurrent Git updates, including branch backup cleanup. Safely refuse deletion for unsupported reference formats.
  - Prevent background SSH requests from racing machine settings, removal, or disconnection.
  - Update the source branch when refreshing a pull-request preview after switching branches.
  - Avoid collisions with configured Codex MCP servers when reading large selections.
- 7b9b708: Keep repository setup bound to the selected folder during concurrent filesystem changes, support connected accounts for mixed-case HTTPS remotes, and treat history path filters as literal filenames.
- f12a0a4: Prevent custom API headers from being reused with another server, correctly continue and abort git am conflicts, and count changed file paths once on Home.
- Updated dependencies [e4b4eba]
- Updated dependencies [53d6a39]
- Updated dependencies [8d3468c]
- Updated dependencies [5b7f333]
- Updated dependencies [d87006f]
- Updated dependencies [7b9b708]
- Updated dependencies [f12a0a4]
  - @1git/git@0.0.2
  - @1git/gpuix-ui@0.0.2

## 0.1.1

### Patch Changes

- ede17a1: Add a single-instance 1git command launcher for local paths, keeping failed requests from opening tabs in a different space after navigation.
- d085376: Fetch the active repository before refreshing with Command-R.
- 70d9173: Add Welcome and Settings workspace tabs with session migration, preserving Settings drafts and pending saves when switching tabs or spaces. Fix the Settings gear and Welcome scan icons.
- cb08b45: Keep clone repository browsing responsive for accounts with thousands of repositories and include a scrollbar for browsing the full list.
- 7e7d1aa: Add an action-first command palette with Settings commands first in Settings and after repositories in repository tabs, matching action icons, compact repository rows, cached status summaries, keyboard navigation across all results, and scrolling that keeps selected commands visible. Remove the command palette shortcut footer.
- e4a046f: Allow CLI AI agents to generate commit messages for large selections.

## 0.1.0

### Minor Changes

- db0607b: Redesign Settings with grouped lists, text-only headings and side-panel editors. Add full repository color and pattern controls beside a faithful live workspace preview, with a prominent action to customize on the repository. Simplify theme choices and display real macOS editor icons with caching and safe fallbacks.
- 2df6513: Add an off-by-default Git setting to automatically include changed files in commits. Preserve manual selections and leave newly discovered changes unchecked unless automatic inclusion is enabled.
- a2080ab: Add Claude Code and Codex CLI accounts, provider-specific model and effort choices, and custom OpenAI or Claude compatible APIs with private auth headers. Prevent cancellation errors when switching providers.
- 6243465: Add consistent List and Tree file navigation across Changes, History, Stashes, Graph, and comparisons, with folder inclusion and a remembered layout preference. Use a compact icon toggle beside Search and Refresh in Changes and in each saved-file pane header. Reveal truncated file and folder labels on hover or keyboard focus with the same sliding text as workspace tabs, without text tooltips.
- cfd3d1b: Add searchable Keybinds settings with clearly grouped sections, customizable app shortcuts, previous/next Space shortcuts, conflict checks, and controls to restore defaults.
- 37e9b88: Review diverged branches with header confirmation popups and return directly to Changes after integration. Compare either conflict source with the working result in an aligned split diff, with highlighted hunks, expandable context, and clearer file groups and operation status. Reject choosing an indexed version that changed after review. Push remains a separate action.
- 0f705e2: Add a Grain texture toggle in Appearance settings. Keep grain on by default and remember the choice across sessions.

### Patch Changes

- 535dddf: Preserve History and Stashes file-list scroll positions when switching tabs, and keep file and folder label animations off React's scrolling path.
- 8cf56d3: Add Changesets to collect release notes, manage workspace versions, and guide agents through desktop release preparation.
- b0dc484: Show scrollbars in Settings pages, editor panels and navigation when Pane scrollbars is enabled. Keep headers and form actions fixed while scrolling.
- 299b8b3: Fix repository search flickering by preserving grid columns while filtering and returning results to the top.
- ce9953f: Make commit errors and hook output copyable from an accessible icon button with copied feedback, including text outside the visible log, and allow selecting log text.
- 3525f45: Skip missing editor applications during discovery so opening External editor settings does not attempt to inspect uninstalled bundles. Keep removed saved editors visible as unavailable until another default is chosen.
- b25eab2: Add a confirmed Delete action for custom Spaces, preserving their repositories, open tabs, and drafts in Default.
- 41d4d2d: Fix Git pushes failing when pre-push hooks run Oxlint or other native Node.js tools.
- 5576978: Polish the Publish branch dialog with clearer remote selection and automatically select the destination when only one remote is configured.
- 8db1987: Reduce grain texture memory while preserving its appearance and resize performance.
- c958548: Keep blocked-close notices compact by aligning the message and actions, leaving more room for file review.
- Updated dependencies [37e9b88]
- Updated dependencies [41d4d2d]
  - @1git/git@0.0.1
