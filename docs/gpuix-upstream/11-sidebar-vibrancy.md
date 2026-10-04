# Sidebar vibrancy

## Classification

App-specific appearance policy, not a general-purpose rendering fix. An upstream
proposal would need an opt-in material/appearance configuration; this local patch
does not expose that API.

## Symptom and cause

1git's titlebar and rail looked nearly white over light windows behind them.
The application painted a 78%-opaque white overlay on top of the native blur.
The pinned GPUI fork also used the Selection material and an `updateLayer`
override that hid `CAChameleonLayer` and removed saturation filters recursively.
That is deliberately different from Electron's normal Sidebar vibrancy.

## Local change

- [Platform patch](../../apps/gpuix/native/sidebar-vibrancy-platform.patch) uses
  Sidebar, BehindWindow blending and Active state, with explicit Aqua appearance
  to match 1git's light Electron theme and keep its dark labels readable.
- It removes the `updateLayer` override and private-layer manipulation, allowing
  AppKit to own its normal material tint and saturation.
- [AppShell](../../apps/gpuix/src/fixture/app-shell.tsx) paints transparent chrome;
  the inner workspace retains its opaque white surface. No shared color token
  or Electron window configuration changes.
- The build applies this patch inside the pinned `zed` submodule and includes it
  in the native addon fingerprint. Restart the app after rebuilding; a native
  addon cannot be hot-reloaded.

## Regression coverage

[Real-window test](../../apps/gpuix/tests/window-chrome/vibrancy.integration.test.ts)
launches isolated processes with light and dark application appearances. The
[probe](../../apps/gpuix/tests/_shared/vibrancy-native.tsx) inspects the actual
NSVisualEffectView through public AppKit/Objective-C APIs, checking material,
blending mode, active state, light effective appearance and inherited layer updates.
It uses no account, credentials or repository.

[Shell tests](../../apps/gpuix/tests/workspace-tabs/workspace-tabs.component.test.tsx)
and [rail tests](../../apps/gpuix/tests/repository-workspace/workspace-rail.component.test.tsx)
check transparent chrome and opaque white workspace styles. Native TestRenderer
screenshots cannot validate behind-window vibrancy; visual review still requires
a real window over light and dark desktop content. macOS accessibility settings,
including Reduce Transparency, can change the system material's appearance.

## Before proposing upstream

Check the latest fork first. Preserve existing defaults for other applications;
offer explicit material, blending, state and appearance options instead of forcing
Sidebar/Aqua globally. Validate system appearance and accessibility behavior on
supported macOS versions. Keep the removal of private-layer manipulation separate
from 1git's light-theme policy where possible. There is no Linux or Windows coverage
for this AppKit-only patch.
