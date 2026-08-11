# 1git Product Plan

## Goal

Complete the everyday Git workflow without turning 1git into an IDE or a Git
administration dashboard.

The result should remain:

- Simple: one obvious next action for the current repository state.
- Calm: no permanent controls, badges, or details unless they help with the
  current task.
- Familiar: GitHub Desktop users should recognize the workflow without copying
  its visual density.
- Safe: destructive and history-changing actions must be explicit and
  recoverable where Git permits.
- Fast: large repositories, long file lists, and many workspace tabs must remain
  smooth.

## Product and engineering contract

Every phase must follow [RULES-GENERIC.md](RULES-GENERIC.md). In particular:

- Inspect the nearest owner, callers, tests, and existing vocabulary before
  adding an abstraction.
- Extend the current Git, workspace, Liquid UI, and SDF paths instead of creating
  parallel implementations.
- Keep domain rules with the Git/workspace owner and presentation state with the
  narrowest practical UI owner.
- Prefer existing browser, Electron, Git, and component-library behavior over
  new dependencies.
- Add an abstraction only for a real owner, lifecycle, invariant, or second
  consumer.
- Test observable behavior and failure states rather than class names or private
  hook sequencing.
- Preserve IPC contracts, persisted formats, accessibility, keyboard behavior,
  focus management, reduced motion, and current visual language unless a phase
  explicitly changes them.

### UI/UX rules

- Keep the existing rail-and-canvas layout.
- Use one primary action per state. Its label should describe the outcome, such
  as `Pull`, `Push`, or `Publish branch`.
- Put secondary actions in the nearest existing Liquid menu.
- Reveal advanced and destructive actions progressively.
- Reuse existing type, spacing, color, motion, SDF, mask, and Liquid UI tokens.
- Prefer short state text over new icons, badges, panels, or explanatory copy.
- Do not add a permanent status bar, activity center, dashboard, or toolbar.
- Show progress where the action started. Show errors with a clear next action.
- Keep clean, empty, loading, disabled, error, and interrupted states intentional.
- Open workflows that do not benefit from living in 1git in the configured editor
  or browser.

### Ownership guardrails

- Main-process Git owners execute and validate Git operations.
- Shared contracts describe serializable IPC inputs and results.
- Workspace feature code owns repository/session state and operation policy.
- Repository workspace fixtures render that state and coordinate local
  interaction.
- Liquid UI remains repository-agnostic. Do not add Git-, tab-, or file-specific
  assumptions to the shared surface system.
- Avoid duplicate state between Git results, workspace state, and presentation
  components.

## Phase 0 — Establish the workflow baseline

No new product UI in this phase.

### Work

- Inventory the existing Git IPC operations and their renderer consumers.
- Record which operations already exist but are not exposed in the UI.
- Define one discriminated repository-operation state model covering:
  - No upstream
  - Up to date
  - Ahead
  - Behind
  - Diverged
  - Fetching, pulling, pushing, or publishing
  - Merge, rebase, cherry-pick, or revert in progress
  - Conflicts
  - Recoverable and terminal failures
- Create or reuse small local fixture repositories for those states.
- Record baseline typecheck, tests, production build, and large-repository
  interaction performance.

### Exit criteria

- Every planned UI state maps to an existing operation or a clearly identified
  missing backend contract.
- No renderer component independently guesses Git state that the workspace owner
  can provide.
- Baseline checks are green before feature work begins.

## Phase 1 — Complete the sync loop

This is the highest-value missing daily workflow.

Status: completed on 2026-08-11.

### User experience

Use the existing repository quick-action area and clean-state canvas. Present a
single state-aware action:

| Repository state | Primary action |
| --- | --- |
| No upstream | Publish branch |
| Behind only | Pull |
| Ahead only | Push |
| Ahead and behind | Sync |
| Up to date | Fetch |

Keep remote details, upstream selection, and less common choices in the attached
Liquid menu.

### Work

- Wire the existing fetch, pull, push, and upstream contracts into one workspace
  operation flow.
- Make operation progress non-blocking and scoped to the repository session.
- Refresh repository state once after completion instead of creating competing
  refresh loops.
- Preserve credentials and authentication behavior supplied by Git and the
  operating system.
- Convert common failures into concise actions such as `Retry`, `Set upstream`,
  or `Resolve conflicts`.

### Exit criteria

- The primary action always matches the current branch state.
- Repeated clicks cannot start duplicate operations.
- Switching workspaces does not move progress or errors to another repository.
- Cancellation, failure, and retry do not leave stale busy state.

## Phase 2 — Make interrupted operations recoverable

Status: completed on 2026-08-11.

### User experience

Show recovery controls only while an operation is interrupted. Reuse the file
groups and current Liquid menus rather than adding a recovery screen.

- Group conflicted files clearly within the existing file rail.
- Keep the diff canvas as the place to inspect the conflict.
- Offer only valid actions: `Continue`, `Abort`, and, where Git supports it,
  `Skip`.
- Provide `Open in editor` for manual resolution.
- Keep operation details behind a secondary action.

### Work

- Surface merge, rebase, cherry-pick, and revert state from the Git owner.
- Derive allowed recovery actions from that state.
- Refresh the file list and diff coherently after each recovery operation.
- Preserve uncommitted work and active-file selection whenever the target still
  exists.
- Make errors actionable without exposing raw command output by default.

### Exit criteria

- A conflicted repository can be understood and recovered without opening a
  terminal.
- Invalid recovery actions are never rendered.
- Restarting the app restores the correct interrupted-operation state.
- No built-in merge editor is introduced.

## Phase 3 — Add a small stash shelf

### User experience

Place stash actions in the existing repository/branch Liquid menu.

- `Stash changes`
- A compact list of existing stashes
- `Apply`, `Pop`, and `Drop`
- A branch-switch guard that offers `Stash and switch` when local changes prevent
  switching

Do not create a separate stash page.

### Work

- Reuse the existing stash IPC operations.
- Keep stash identity and timestamps in the workspace domain, not component-local
  state.
- Confirm `Drop` and explain when `Pop` keeps a stash after conflicts.
- Refresh changes and branch state atomically after applying or popping.

### Exit criteria

- Users can temporarily clear, restore, and remove work.
- A failed apply/pop preserves both working-tree changes and the stash.
- Stash actions remain available without adding permanent rail controls.

## Phase 4 — Complete the branch lifecycle

### User experience

Extend the existing branch/worktree quick action instead of adding a branch
screen.

- Create and switch
- Publish or set upstream
- Rename
- Delete
- Create from a selected commit
- Show concise upstream and ahead/behind state

History-rewriting or destructive actions stay in nested Liquid menu sections with
confirmation.

### Work

- Reuse existing branch IPC contracts before adding new ones.
- Centralize branch-action eligibility with the workspace/Git owner.
- Handle checked-out worktrees and protected/current branches safely.
- Keep remote branch naming and tracking rules explicit.

### Exit criteria

- The full ordinary branch lifecycle is possible without a terminal.
- Actions are hidden or disabled when Git cannot perform them.
- Branch changes preserve the selected repository, file filter, and relevant
  workspace context.
- Force push remains out of the primary flow.

## Phase 5 — Make the clean state useful

### User experience

The clean canvas should answer “what next?” without becoming a dashboard.

Depending on state, show one primary action:

- `Push`
- `Pull`
- `Publish branch`
- `Preview pull request`
- `Open pull request`
- `Fetch`

Keep branch comparison details inside the diff canvas and open hosting-provider
workflows in the browser.

### Work

- Compare the current branch with its configured base using existing diff
  rendering.
- Parse supported remote URLs at the integration boundary.
- Open the relevant remote repository or pull-request URL securely.
- Fall back to `Open remote` for unsupported providers instead of building a
  provider framework.

### Exit criteria

- A clean repository never feels like a dead end.
- The app remains useful with non-GitHub remotes.
- No account system, issue tracker, CI dashboard, or full pull-request client is
  introduced.

## Phase 6 — Finish essential diff modes

Only add modes that materially improve review or staging.

### Work

- Add an `Ignore whitespace` option to the existing diff menu.
- Add unified/side-by-side selection only if it remains clear at the current
  canvas width.
- Render added text files as complete additions.
- Give binary, large, and unsupported files an intentional state with useful
  actions.
- Add image before/after preview without turning the canvas into an asset editor.
- Consider line staging only if the existing hunk transport can support it without
  a second patch engine.
- Preserve incremental rendering, scroll position, active-file SDF motion, and
  large-repository responsiveness.

### Exit criteria

- Common text, image, binary, added, deleted, and renamed files have useful
  previews.
- Diff settings live in one contextual menu and persist only when that behavior is
  intentional.
- No new measurement, polling, or animation loop is added without profiling
  evidence.

## Phase 7 — Product hardening

This phase closes cross-workflow gaps; it is not a visual redesign.

### Work

- Validate commit identity before the first commit and provide a concise fix path.
- Standardize progress, cancel, retry, confirmation, and undo behavior.
- Preserve the existing custom Sonner-based toast appearance and ten-second undo
  window where undo is safe.
- Make destructive actions name their exact target.
- Verify keyboard-only operation, focus restoration, screen-reader names, reduced
  motion, and high-contrast state cues.
- Test small and large windows, many tabs, long paths, large file groups, and
  slow Git operations.
- Profile before optimizing; fix shared root causes rather than adding local
  memoization or workers.
- Remove any superseded paths after each migration.

### Exit criteria

- Failures do not silently clear selection, progress, or recoverable work.
- Every primary workflow works with keyboard and pointer input.
- Large repositories remain responsive during Git operations and Liquid UI motion.
- The app still looks like the same product, with fewer dead ends.

## Explicit non-goals

Do not add these until real usage proves they are necessary:

- Built-in terminal
- Built-in code, image, or merge editor
- Issue tracker
- Full pull-request review or CI client
- Interactive rebase timeline
- Submodule or Git LFS administration UI
- Repository analytics or contribution dashboards
- Provider account system or custom credential store
- Plugin framework for Git operations
- More permanent navigation, badges, or status chrome

## Definition of done for every phase

- The phase solves one complete user workflow, including loading, empty, success,
  failure, disabled, cancellation, and restart behavior where relevant.
- The implementation follows [RULES-GENERIC.md](RULES-GENERIC.md) and the nearest
  existing production pattern.
- No speculative abstraction, duplicate Git policy, or parallel UI path remains.
- IPC and persisted-data changes are backward compatible or explicitly migrated.
- Destructive actions have focused safety tests.
- Observable UI behavior, keyboard behavior, and regression cases have focused
  tests.
- Existing Liquid UI, SDF geometry, scrolling, DnD, selection, and accessibility
  tests remain green.
- Visual verification covers the beginning, middle, and end of long scroll ranges
  and both small and large repositories.
- Validation passes:

```bash
bun x ultracite check
bun run --cwd apps/desktop check-types
bun run --cwd apps/desktop test
bun run --cwd apps/desktop build
git diff --check
```

## Recommended delivery order

1. Phase 0 establishes evidence and prevents duplicate state models.
2. Phases 1 and 2 complete the essential remote and recovery loop.
3. Phases 3 and 4 complete safe day-to-day branch work.
4. Phase 5 removes the clean-state dead end.
5. Phase 6 improves review only after the core workflow is complete.
6. Phase 7 hardens the product without adding visible complexity.
