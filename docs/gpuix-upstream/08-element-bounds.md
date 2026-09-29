# Padded element bounds

## Symptom and cause

A popover's raised copy of a full-width button shifts right/down and shrinks.
Native div bounds were recorded by an absolutely positioned, full-size canvas
child. Padding and borders offset that child; its box is not the div's box.

## Fix

[element-bounds.patch](../../apps/gpuix/native/element-bounds.patch) records the
div's own painted bounds through the existing `on_painted` hook. Text selection
start-region registration uses that same box and is preserved. No JS API changes.

## Regression

[Popover component tests](../../packages/gpuix-ui/tests/popover/popover.component.test.tsx)
compare the original button's bounds against its raised copy, including reopening.
Before the fix, the copy moved 15px right, 1px down and lost 2px of width with the
default button tokens. Validation targets the pinned macOS native renderer;
other platforms and newer upstream revisions still need verification.
