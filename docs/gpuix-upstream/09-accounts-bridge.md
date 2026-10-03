# Credentials, password inputs and Settings

## Local feature and ownership

[accounts.patch](../../apps/gpuix/native/accounts.patch) exposes GPUI's existing
credential store through asynchronous N-API methods, adds the macOS Settings
menu/shortcut, and supports `type="password"` in the native text editor.
[accounts-platform.patch](../../apps/gpuix/native/accounts-platform.patch) makes
Keychain cancellation an error for 1git entries rather than reporting a missing
credential. The account feature uses this to avoid replacing inaccessible tokens.

The vault API deliberately accepts only hashed `1git-hosting-v1:` keys, stores
the account namespace in the key rather than relying on the platform's username
lookup, limits credentials to 16 KiB (including OAuth pairs), and returns generic safe failures. This
is **application policy**, not an upstream-ready public credential API. A generic
API needs caller-defined namespaces, platform limits, and typed cancellation.

Password input masks painted text and platform text queries, sets the password
accessibility role, suppresses clipboard copy and undo/pending-value snapshots,
and maps caret/hit-test indices between UTF-8 source and masked display. Cleartext
remains in edit events by design. 1git uses an uncontrolled field so the token never
appears in retained React props; applications must not log those events. Upstream
password semantics should separately consider OS secure-event-input support.

Split the password editor, credential bridge and Settings action into independent
PRs rather than submitting this combined local patch. Keep generated declarations
in their normal upstream build; 1git augments the published input type locally.

## Regression evidence

- [Account tests](../../apps/gpuix/tests/accounts/accounts.component.test.ts):
  real hosting transport with HTTP/vault doubles, private metadata files,
  namespacing, validation, persistence rollback and safe error handling.
- [Native form tests](../../apps/gpuix/tests/accounts/settings.component.test.tsx):
  full-window Settings geometry, scoped keyboard traversal and restored focus, masked painting and
  accessibility, Unicode caret editing and token clearing.
- [OS-vault integration](../../apps/gpuix/tests/accounts/native.integration.test.ts):
  production native renderer, random synthetic Keychain entry with replacement
  and deletion, plus the native Settings shortcut and consumed notification.
- [Callback tests](../../apps/gpuix/tests/accounts/authorization.integration.test.ts):
  real Bun loopback listener, state/PKCE binding and cleanup with synthetic provider
  responses. Live provider consent and packaged-app behavior remain unverified.

Validated on the pinned macOS/Bun release addon with runtime shaders. Windows,
Linux, Node.js, and packaged signing/Keychain prompt behavior remain unverified.
