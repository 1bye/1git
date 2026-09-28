# Native context menus and confirmation dialogs

Sources: [context-menu.patch](../../apps/gpuix/native/context-menu.patch) and
[context-menu-platform.patch](../../apps/gpuix/native/context-menu-platform.patch).

Classification: **macOS feature prototype; not ready to submit unchanged**.

## Current behavior

The addon exposes a synchronous menu accepting labels, enabled flags, and
view-local top-left coordinates. The AppKit layer converts coordinates for the
native view, displays `NSMenu`, and returns the selected index or `-1` on dismissal.
It validates item counts/data and requires the main thread and an active window.

The patch also exposes a native file-discard warning. Cancel is the default;
dismissal does not authorize a write. These dialogs only return user decisions:
they do not implement Git writes or recovery backups.

## Required upstream cleanup

- Replace `OneGitContextMenuTarget`/selector naming with upstream-owned names.
- Replace `confirmFileDiscard(path)` and its hard-coded 1git text with a generic
  confirmation API, or leave that feature out of the menu PR entirely.
- Do not ship the text promising a recovery backup as generic library behavior;
  1git owns that backup implementation.
- Review ownership of the target window. Current code uses AppKit's key window,
  which requires careful treatment in a multi-window host.
- Agree on public item types, dismissal semantics, accessibility, localization,
  nested native-loop/reentrancy behavior, and other-platform support.
- Preserve input validation and native object release paths.

## Verification to port

Use [file-action menu component tests](../../apps/gpuix/tests/repository-file-actions/menu.component.test.tsx)
as application-level references, not proof of all physical NSMenu interactions.
Manually check pointer placement, keyboard selection, disabled entries, dismissal,
focus changes, and correct target-window behavior. Test rejected inputs and
confirm that cancellation never becomes a destructive action.
