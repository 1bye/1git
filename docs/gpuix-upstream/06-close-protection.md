# Native close and quit protection

Suggested PR title: **Allow embedded hosts to veto window close and application quit**.

Sources: [close-protection.patch](../../apps/gpuix/native/close-protection.patch)
and [close-platform.patch](../../apps/gpuix/native/close-platform.patch).

## Motivation and API

An application may need to remain open during a write operation. A JavaScript
notification delivered after native shutdown begins is too late to protect it.

The addon exposes `setCloseBlocked` and `takeCloseRequested`. Native handlers
synchronously check protection state; callers consume a blocked-close request
through the host API. The GPUI macOS fork adds a pre-termination veto callback
before normal application shutdown.

Protect the red close button, Close Window action, and AppKit termination routes
such as Quit/Cmd-Q. Releasing protection must not replay an old close request;
the next explicit close should work normally.

## Verification and upstream scope

- [Native integration test](../../apps/gpuix/tests/close-protection/native.integration.test.ts)
- [Isolated native app fixture](../../apps/gpuix/tests/_shared/close-native.tsx)

The fixture activates its window before menu actions to avoid testing an inactive
menu target. It verifies vetoes, consumed notifications, release, and successful
explicit exit. Also manually verify physical Dock/menu interaction as appropriate.

The lifecycle-fix verification reran this integration successfully on macOS.
Other platforms and upstream multi-window policy still need review. Do not
upstream Git-operation state or cancellation policy; only the native host safety
mechanism belongs here. Never imply that forced process termination is prevented.
