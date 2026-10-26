# Padded element bounds

## Symptom and cause

A popover's raised copy of a full-width button shifts right/down and shrinks.
Native div bounds were recorded by an absolutely positioned, full-size canvas
child. Padding and borders offset that child; its box is not the div's box.

## Fix

[element-bounds.patch](../../apps/gpuix/native/element-bounds.patch) records the
div's own painted bounds through the existing `on_painted` hook. Text selection
start-region registration uses that same box and is preserved.

The native test renderer also accepts `getElementBounds(id, false)` to read the
last paint without drawing another frame, matching the live renderer's bounds
queries. The default still refreshes first. Input-frame benchmarks use this
mode so their measurements include the requested draw rather than additional
draws caused by test instrumentation.

Performance benchmarks use GPUI's actual input paint and flush again only after
framework mutations. Their bounds and scroll-metric queries read the last paint,
matching live getters. Ordinary end-to-end test helpers keep their refreshing
defaults. A regression checks both the input paint and a subsequent style change.

## Regression

[Popover component tests](../../packages/gpuix-ui/tests/popover/popover.component.test.tsx)
compare the original button's bounds against its raised copy, including reopening.
Before the fix, the copy moved 15px right, 1px down and lost 2px of width with the
default button tokens. Validation targets the pinned macOS native renderer;
other platforms and newer upstream revisions still need verification.

[Bounds query regression](../../apps/gpuix/tests/native-session/bounds.component.test.tsx)
checks that repeated last-paint queries preserve both geometry and the frame
counter, while the default query still draws.
