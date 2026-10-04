# GPUIX upstream patch notes

Local implementation notes for preparing future upstream PRs. These are not
submitted PRs, and upstream acceptance or compatibility with newer revisions has
not been verified. Updated 2026-10-04.

## Baseline

- GPUIX packages: **0.10.0**.
- GPUIX source: `9fcd628863e354e9c58019fc3bf38981a1e64158`.
- Pinned GPUI fork (`zed` submodule): `81c99f816b4a5f69d3c014774068034c24d1d7af`.
- Local validation: Apple Silicon macOS, Bun 1.4.2; not Node.js, Windows, or Linux.
- Patch files are the source of truth. These notes explain them rather than
  duplicating diffs that could become stale.

## Candidates

| Note | Classification | Upstream owner |
| --- | --- | --- |
| [Native test-session lifecycle](01-native-test-session.md) | Retention and shutdown fixes | GPUIX native addon + GPUI fork |
| [Checkbox accessibility](02-checkbox-accessibility.md) | Missing accessibility mapping | GPUIX native + JS host contract |
| [Diff scrolling and layout](03-diff-view.md) | Mixed fixes and customization APIs | GPUIX native + JS host contract |
| [Titlebar dragging](04-titlebar-drag.md) | Opt-in API exposure | GPUIX native + JS host contract |
| [Window activation](05-window-activation.md) | Event bridge addition | GPUIX native |
| [Close and quit protection](06-close-protection.md) | Safety API addition | GPUIX native + GPUI fork |
| [Native context menus](07-native-context-menu.md) | Platform feature; needs generalization | GPUIX native + GPUI fork |
| [Padded element bounds](08-element-bounds.md) | Floating anchor positioning fix | GPUIX native |
| [Credentials, password input and Settings](09-accounts-bridge.md) | Platform exposure and secure-input support; includes app policy | GPUIX native + GPUI fork |
| [Centered floating layers](10-centered-floating-layers.md) | Center-anchor positioning fix | GPUIX native |
| [Sidebar vibrancy](11-sidebar-vibrancy.md) | App-specific appearance policy; needs opt-in API | GPUI fork |

Start with the lifecycle and accessibility fixes. Keep independent features in
separate PRs. The diff patch should likely be split further. The context-menu
patch contains explicit 1git policy and is not ready to submit unchanged.
The sidebar vibrancy patch also changes platform defaults for this app and should
not be submitted unchanged as a general-purpose fix.

## Source and preparation

- [Local native patches](../../apps/gpuix/native/)
- [Build and patch order](../../apps/gpuix/native/build.ts)
- [Version pin and patch fingerprint](../../apps/gpuix/native/config.ts)
- [Published-package bridge patch](../../patches/@gpuix%2Fnative@0.10.0.patch)
- [Application setup](../../apps/gpuix/README.md)

Before opening a PR:

1. Check whether the issue still exists on the target upstream revision.
2. Extract only the relevant hunks. Platform patches apply inside `zed`; addon
   patches apply at the GPUIX root. Do not submit the entire 1git patch stack.
3. Move any changes to generated `dist` files into their upstream JS/TypeScript
   sources and regenerate declarations normally.
4. Port the linked 1git regressions into upstream's own test framework. Do not
   introduce dependencies on 1git components, private repositories, or fixtures.
5. Test supported hosts/platforms and document missing coverage. Update the GPUI
   submodule reference only after the corresponding fork changes are available.
6. Include a focused reproduction, before/after result, API compatibility notes,
   and the upstream project's required changeset.

The `--runtime-shaders` option in 1git's build script is a local build convenience
for machines lacking Xcode's offline Metal component, not itself a GPUIX bug fix.
