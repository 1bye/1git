# Centered floating layers

## Problem

In GPUIX 0.10, `anchored` layers using `align="center"` shift by half their
content size twice: the flex wrapper centers the measured layer, then GPUI's
center anchor subtracts half its size again. Right/left tooltips appear too high;
top/bottom layers shift horizontally. A 34px-tall tooltip was 17px too high.

## Local fix

[anchored-center.patch](../../apps/gpuix/native/anchored-center.patch) makes the
centered flex child a zero-size point containing the deferred layer. Flex centers
that point; GPUI positions the surface around it exactly once. No timers, JS
measurement loop, rail-specific offset, or new positioning API is needed.
Start/end placement and explicit window-coordinate positioning are unchanged.

## Validation

- [Shared Tooltip component tests](../../packages/gpuix-ui/tests/tooltip/tooltip.component.test.tsx)
  check center alignment and side gaps on all four sides, plus composition,
  focus, hover delay, and dismissal.
- [Workspace rail tests](../../apps/gpuix/tests/repository-workspace/workspace-rail.component.test.tsx)
  check actual native hover positions for top and bottom rail controls.
- Use the local patched addon/preload and macOS graphics access. Other platforms
  and newer upstream revisions still need verification before submitting a PR.
