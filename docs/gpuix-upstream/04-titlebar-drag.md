# App-owned titlebar dragging

Suggested PR title: **Expose opt-in titlebar gesture ownership and native drag regions**.

Source: [titlebar-drag.patch](../../apps/gpuix/native/titlebar-drag.patch), plus
`windowDrag` forwarding/declarations in the
[published-package bridge patch](../../patches/@gpuix%2Fnative@0.10.0.patch).

## Motivation and behavior

App-rendered tabs and controls need pointer gestures that native titlebar
dragging would otherwise consume. `appOwnsTitlebarDrag` exposes an existing GPUI
window option and defaults to false. Callers mark empty chrome with `windowDrag`
to preserve native movement; double-click invokes native zoom behavior.

The native renderer handles this synchronously on mouse down. Forwarding the
gesture through a later JavaScript callback cannot reliably preserve AppKit's
current event. No GPUI-fork modification is needed for this patch.

## Verification and upstream scope

The patch includes an option-default test. Use
[workspace tab coverage](../../apps/gpuix/tests/workspace-tabs/workspace-tabs.component.test.tsx)
for component interaction references, but physically verify window movement,
double-click zoom, and native tiling on macOS. Simulated component gestures do
not alone prove OS-level dragging.

Test both opt-in and default behavior. Interactive controls and close targets
must remain excluded from draggable regions. Submit the host API and native
behavior, not 1git's curved tab artwork, layout, or tab-management policy.
