# Plan: in-app guided tour for tabs and space swipes (apps/gpuix)

> Current behavior: the introductory tour points to **Branches** in the left
> rail, then **New Branch**, with creation optional and safe to
> cancel. The current branch appears in the rail tooltip and branch panel.
> Worktrees remain available in the branch panel but are no longer an introductory lesson. Saved
> completion of the former worktree lesson migrates to the branch-creation lesson.
> Guided tips and first-run setup can be replayed from **Settings → Help**.
> The original worktree-first proposal below is retained as design history.

## Problem

New users miss two interactions that text in onboarding doesn't explain:

1. **Clicking the active tab** opens a menu to switch branch or worktree.
2. **A two-finger horizontal swipe over the rail** switches spaces.

Onboarding step 3 (Set up spaces) currently tries to teach the swipe in a mockup. Users still don't connect it to the real rail, and it never mentions tabs.

## Goal

After onboarding, run a short tour on the **real UI**. It shows coach marks that point at the real tab and the real rail. A step moves on only when the user actually performs the action. The tour is shown once, can be skipped at any step, and can be replayed from Settings.

Out of scope: video and illustrations, and changes to the tab menu or the swipe recognizer themselves.

## UX

### Coach mark
- A small bubble anchored to a target element, with a subtle pulsing ring around the target.
- Contents: a title, one sentence, an optional small animation, and a footer with "Skip tour" on the left and the step counter ("1 of 3") on the right.
- It doesn't steal focus or block the target, so the user can click through to the real control. It's non-modal: Esc dismisses it the same way as "Skip tour".
- It follows the target if the window resizes or the tabs reflow.

### Steps

| # | id | Anchor | Title / body | Completes when |
|---|----|--------|--------------|----------------|
| 1 | `tab-menu` | the active repository tab | **Switch branch or worktree** · "Click the current tab to change its branch or open a worktree." | The tab's branch/worktree menu opens |
| 2 | `worktrees` | the "Worktrees" submenu trigger inside that menu | **Work on two branches at once** · "Worktrees open another branch in its own folder, without stashing." | The worktrees submenu opens, **or** the menu closes (counts as seen; don't nag) |
| 3 | `space-swipe` | the `rail-spaces` button | **Switch spaces** · "Swipe left or right with two fingers over the rail." Shows a looping ⇠⇢ two-finger glyph | A real rail swipe changes the space |

- Step 3 only runs when there are 2 or more spaces. If there's only 1, it's deferred and shown automatically the first time a second space is created, as a standalone tip ("1 of 1").
- After the last step, show a brief confirmation bubble on the rail ("You're set. Replay tips from Settings → Appearance.") that closes itself after about 3 s or on any click.
- "Skip tour" marks every remaining step as dismissed, including the deferred swipe step.

### Starting the tour
Start step 1 when **all** of these hold:
- `onboarding === "complete"`, and the active tab has a loaded repository (`tab.workspace.repository`).
- Nothing else is open: settings, a space editor, the quick switcher, a folder picker, another menu or popover, or a modal.
- At least about 600 ms have passed since the repository loaded, so the bubble doesn't race the first layout.

If one of these stops holding mid-tour (for example, settings opens), hide the bubble and resume the same step afterwards.

### Onboarding step 3
Simplify step 3 back to *setting up* spaces only, since the tour now teaches the gesture.
- Keep the one-line intro, the management-only list, the "+ Work" / "+ Personal" preset chips, and "Custom…".
- Remove the swipe practice: the `onScroll` handler, the `RailSpaceSwipe` usage, the practice hint, and the dots. The preview can stay as a **static** illustration (rail with all space icons and placeholder tabs), or be removed. Prefer keeping it static, with a caption: "You'll learn how to switch after setup."
- File: `src/feature/onboarding/onboarding-spaces.tsx`. Remove the `onSelect` prop if it's no longer used, and update `src/app.tsx` to match.

## Code map (existing pieces to hook into)

- **Active tab click opens the menu:** `src/feature/workspace-tabs/workspace-tabs.tsx`. `onActivate` calls `setMenuId(tab.id)` when the tab is already active and has a repository (around line 445). Tab DOM instances are stored in `frames.current` (a `Map` by tab id, around line 440).
- **Tab component:** `src/feature/workspace-tabs/components/workspace-tab.tsx` (`menuOpen`, `aria-expanded`).
- **Tab menu and submenus:** `src/feature/workspace-tabs/components/workspace-menu.tsx`. The `submenu` state (`"worktrees" | "new"`) is set via `setSubmenu`, and `submenuTriggerId(group)` gives the trigger id.
- **Rail space button and tooltip:** `src/feature/spaces/space-switcher.tsx` (`testId="rail-spaces"`, a `button` ref already exists).
- **Rail swipe recognizer:** `src/feature/repository-workspace/components/workspace-rail.tsx` (`spaceSwipe = useRef(new RailSpaceSwipe())`). It calls `onSpaceSwipe`, which comes from `swipeSpace` in `src/app.tsx` (around line 1509) and is passed only when there are 2 or more spaces.
- **Space creation:** the `space-create` action is dispatched in `src/app.tsx` (from `SpaceManager.onSave` and from onboarding's `onCreatePreset`). Spaces are reduced in `src/feature/spaces/workspace-spaces.ts`.
- **Persistence:** `src/feature/workspace-tabs/lib/workspace-session.ts`:
  - The `WorkspaceSessionDocument` type is around line 73. Look at how `smoothTransitions` and `onboarding` are added.
  - `parse` is around line 257 and validates every field explicitly.
  - `capture(...)` takes positional args, around line 303. App state is in `src/app.tsx` (see how `smoothTransitions` is threaded through, around lines 168–200).
- **Popover primitive:** `packages/gpuix-ui/src/popover.tsx` (anchor ref, open state, floating positioning via `@gpuix/react/floating`). Tooltip is in `packages/gpuix-ui/src/tooltip.tsx`.
- **Animation:** the `motion={{ initial, animate, transition }}` prop on `div`. See `src/feature/repository-discovery/repository-discovery-rail.tsx`, and `workspace-tab.tsx` for easing `[0.22, 1, 0.36, 1]`.
- **Settings:** `src/feature/accounts/accounts-settings.tsx` (`SettingsSection` union, around line 72).
- **Analytics:** `src/feature/analytics/desktop-analytics.ts` (`AnalyticsEvent`). Check `privacy-settings.tsx` for what's allowed. Send only step ids, never repository names or paths.

## Implementation steps

1. **Persisted tip state**
   - Add `tips?: { readonly completed: readonly TourStepId[]; readonly dismissed?: boolean }` to `WorkspaceSessionDocument`.
   - Parse it strictly: drop unknown ids, dedupe, and ignore it entirely if it's malformed. Add it as a `capture` argument.
   - Thread a `tips` state through `src/app.tsx`, the same way as `smoothTransitions`.
   - Product decision: existing users with `onboarding === "complete"` and no `tips` field are backfilled with every step completed. Only new or unfinished onboarding sessions start the tour automatically; everyone can replay it from Settings → Appearance.
   - Unit tests in `tests/workspace-session/`: round-trip, malformed input, unknown ids.

2. **Pure tour model:** a new file, `src/feature/guided-tour/guided-tour.ts`.
   - `type TourStepId = "tab-menu" | "worktrees" | "space-swipe"`.
   - `GuidedTour.current(tips, context): TourStepId | null`, where `context = { onboardingComplete, hasRepositoryTab, spaceCount, blocked }`.
   - `GuidedTour.complete(tips, id)` and `GuidedTour.skip(tips)`.
   - Write it as a static-method class like `WorkspaceSpaces`, with no React.
   - Unit tests in `tests/guided-tour/guided-tour.unit.test.ts`. Cover ordering, deferring step 3 with 1 space, the standalone step 3 after a second space is created, skip, and the blocked state.

3. **Coach mark component:** `src/feature/guided-tour/coach-mark.tsx`.
   - Props: `anchor` (a ref to a `PublicInstance`), `side`, `title`, `body`, `step`, `total`, `illustration?`, `onSkip`.
   - Build it on the floating positioning that `popover.tsx` uses, but **non-modal**: it must not install a modal key handler or trap focus. If `Popover` can't be made non-modal cleanly, use `@gpuix/react/floating` directly.
   - Add a pulsing ring: an absolutely positioned outline over the anchor bounds, animated with `motion` (opacity 0.4 → 1, about 1.2 s loop). Use a static ring when `smoothTransitions` is off.
   - Give the bubble `role="status"`, an `aria-label` with the title, and test ids `tour-coach-mark`, `tour-skip`, and `tour-step-<id>`.

4. **Expose anchors and events.** Add these as optional props and keep existing behavior unchanged.
   - `workspace-tabs.tsx`: `onTourAnchor?(instance | null)` for the active tab's frame, and `onTabMenuOpen?()`, called where `setMenuId(tab.id)` opens the menu.
   - `workspace-menu.tsx`: `worktreesAnchorRef` for the worktrees submenu trigger, and `onSubmenuOpen?(group)`, called when `setSubmenu("worktrees")` runs. Also pass up the menu's close event.
   - `space-switcher.tsx`: expose the existing `button` ref (callback prop), or accept an external ref.
   - Rail swipes: the tour needs to know a switch came from a *swipe*, not from the menu. Wrap `swipeSpace` in `app.tsx` so a successful swipe calls `completeTip("space-swipe")`.

5. **Orchestrate in `app.tsx`.**
   - Add a `GuidedTourLayer` (in `src/feature/guided-tour/`) that receives `tips`, the context, and the anchors, and renders the current `CoachMark`.
   - Compute `blocked` from existing state: `settingsOpen`, `spaceEditor`, `quickSwitcherOpen`, `folderPickerRoot`, `onboardingBusy`, any open popover, and the tab menu being open (except during step 2, where the menu is the expected state).
   - Wait about 600 ms before step 1 first appears. Use the renderer clock so tests can use `clockFastForward`.
   - When `space-create` happens while `space-swipe` is pending and the user hasn't dismissed tips, let the layer show the standalone step 3.

6. **Replay from Settings**
   - Add a "Show tips again" button under the General or Appearance settings section (pick whichever holds app-wide behavior). It clears `tips` and closes settings, so the tour starts right away if the conditions hold.

7. **Simplify onboarding step 3**, as described in UX above. Update `tests/onboarding/setup.component.test.tsx`:
   - Remove the swipe-practice test.
   - Remove dot-click assertions, and switch spaces via presets or edits instead.
   - Keep the minimum-window-size layout test.

8. **Analytics (optional, behind the existing consent):** add `tour_step_completed { step }` and `tour_skipped { step }`.

## Tests (component, mirroring `tests/onboarding/setup.component.test.tsx`)

New file: `tests/guided-tour/tour.component.test.tsx`. Use the same `createTestRoot`, `fixture()`, `click`, `settle`, `node` helpers. Copy what you need from the onboarding test, or extract them to `tests/_shared` if that's already the pattern there.

- After onboarding completes with a repository tab open, `tour-step-tab-menu` appears after fast-forwarding the clock. It's anchored inside the active tab's bounds horizontally.
- Clicking the active tab opens the menu and advances to `tour-step-worktrees`. Opening the worktrees submenu advances to `tour-step-space-swipe` (with 2 spaces).
- A rail swipe completes the tour. Use the swipe simulation from the existing "practices swipes…" test (`handleGpuixEvent` with `touchPhase` and `nativeSimulateScrollWheel` over the `rail-spaces` area). After that, `tips.completed` holds all three ids in the saved session.
- With 1 space, the tour ends after step 2. Creating a space later shows `tour-step-space-swipe` with the "1 of 1" counter.
- "Skip tour" hides the mark and persists `dismissed: true`. Remounting the app doesn't show it again.
- The mark hides while settings is open and comes back on the same step when it closes.
- "Show tips again" restarts the tour.
- Light and dark screenshots via `GPUIX_ONBOARDING_SCREENSHOT`, following the existing pattern.

## Verification

```bash
bun test apps/gpuix/tests/guided-tour apps/gpuix/tests/onboarding apps/gpuix/tests/workspace-session
```
```bash
bun run check
```
```bash
bun run check-types
```

Verified baseline failures, reproduced against an isolated copy of HEAD:
- `keeps an unavailable repository and editable draft…` expects "Repository unavailable", while the UI renders "Could not read repository".
- `flushes the last typed draft on process exit…` crashes in native GPUI teardown (and can exceed the test timeout).

The onboarding discovery layout test, the touched tour files’ lint/format checks, and workspace type checks pass with the current installed native build. The full `bun run check` is currently blocked by unrelated spacing edits in `apps/web/src/layouts/Layout.astro`.

## Acceptance criteria

- A fresh user finishes onboarding, opens a repository, and is walked through the tab menu, worktrees, and (with 2 or more spaces) the rail swipe, each completed by doing the real action.
- The tour never shows over settings, dialogs, or the onboarding view, and never repeats after it's completed or skipped.
- Onboarding step 3 no longer contains gesture practice.
- Keyboard users can finish or skip every step. Step 1 completes when the tab menu opens via Enter or Space on the focused tab.
- All new and updated tests pass, and lint, format, and types are clean for the touched files.

## Context for the implementer

- The current branch already has uncommitted step 3 changes (preview, preset chips, management-only list) in `onboarding-spaces.tsx`, `app.tsx`, and the onboarding tests. Build on them; don't revert them.
- Follow `AGENTS.md`: Oxlint/Oxfmt, `for…of`, explicit names, and no nested ternaries. Lint requires a blank line before multi-line statements.
- In gpuix, child elements inside a `Button` that aren't text need `pointerEvents: "none"`, or clicks on them won't reach the button (this was found while building the step 3 dots).
