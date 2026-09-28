# Window activation event bridge

Suggested PR title: **Forward native window activation to the host event bridge**.

Source: [window-activation.patch](../../apps/gpuix/native/window-activation.patch).

## Motivation and change

An embedded app needs to know when its native window becomes active so it can
refresh external state without polling. The renderer retains a GPUI window
activation subscription and forwards a `windowActivated` event through the
existing renderer-scoped bridge, using element ID zero.

This is an event API addition, not the Git auto-refresh implementation. Upstream
should define/document the event name, payload, subscription lifetime, and whether
it represents activation only or both activation/deactivation transitions.

## Verification to port

See [auto-refresh tests](../../apps/gpuix/tests/repository-connection/auto-refresh.component.test.tsx)
for application consumer examples. Native tests should establish that subscription
installation is not duplicated on render, that events route to the correct
renderer, and that moving focus between controls is not a window activation.

Physically switch between applications/windows on macOS. Keep Git refresh timing,
request coalescing, and cancellation policy in 1git rather than the event bridge.
