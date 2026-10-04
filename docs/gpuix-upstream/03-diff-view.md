# Native diff scrolling, sizing, and customization

Source: [diff-scroll.patch](../../apps/gpuix/native/diff-scroll.patch), plus the
related host/theme declarations in the
[published-package bridge patch](../../patches/@gpuix%2Fnative@0.10.0.patch).

This patch mixes bug fixes with API additions. Prefer separate upstream PRs:

## 1. Connect native diff scroll state

Expose the custom diff element's `gpui::ListState` through its registry and reuse
it from the existing renderer scroll APIs. The live and test renderer paths need
the same behavior. Preserve virtualized rendering and release stale scroll state
when the element becomes empty or unmounts.

## 2. Correct width and horizontal overflow

Measure visible content with GPUI's text shaper, caching by relevant diff/font/
metric inputs. Account for gutters, markers, and padding. Hidden metadata must
not widen code content. Short diffs fill their viewport; long lines can scroll.
Avoid redundant X-overflow wrappers for explicitly non-shrinking children.

The renderer wrapper change is broader than diff-only code. Upstream tests should
include ordinary horizontal containers and nested overflow, not just diff views.

## 3. Expose presentation controls

- `showFileHeader` defaults to true so callers can opt out of duplicate chrome.
- Zero `diffFileHeaderHeight` omits built-in file chrome.
- Independent row/word colors: `diffAddBg`, `diffDelBg`, `diffAddWordBg`,
  `diffDelWordBg`, including alpha.
- Honor diff text sizing and horizontal row padding consistently.

These are customization APIs, not universally correct app styling. Preserve
existing defaults and regenerate public host/theme contracts upstream.

## 4. Opt-in omitted-context events

[diff-context.patch](../../apps/gpuix/native/diff-context.patch) adds
`onExpandContext` / `expandContext` and click behavior on hunk headers
that have omitted lines above them. The event includes the file path in `value`
and hunk starts in `oldLine`/`newLine`. Headers without a gap stay inert. All headers
keep the original presentation whether a callback is provided or not. The
published-package bridge patch registers the event and declares its TypeScript API.

This is an optional API addition, not a parser bug fix. The native diff must stay
repository-agnostic: context reads, snapshot validation, expansion amount, limits
and keyboard equivalents belong to the caller. 1git reveals at most 20 lines per
click, joins fully revealed gaps, and rejects context from changed working files.
Its pure model and disposable-Git tests are app-specific and should not be copied
into the upstream renderer.

## Verification to port

- [Viewer component tests](../../apps/gpuix/tests/repository-diff/viewer.component.test.tsx)
- [Layout tests](../../apps/gpuix/tests/repository-diff/layout.component.test.tsx)

Cover keyboard and wheel scrolling, long and short lines, hidden headers, text
selection without gutters, resize/font invalidation, empty content, and unmount.
Also cover native gap clicks with correct coordinates, absent callbacks, leading
context, unequal old/new line numbers, and scroll preservation after patch updates.
Do not include 1git's Git reader, image preview pipeline, or application header
layout in a native diff PR. Re-measure performance upstream before making new
optimization claims.
