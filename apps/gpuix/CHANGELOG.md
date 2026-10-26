# @1git/gpuix

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
