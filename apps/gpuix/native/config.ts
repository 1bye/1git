import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Exact GPUIX 0.10.0 sources; its gitlink also pins the GPUI fork. */
export const nativeRevision = "9fcd628863e354e9c58019fc3bf38981a1e64158";
export const appDirectory = resolve(import.meta.dir, "..");
export const nativeDirectory = resolve(appDirectory, ".cache/native");
export const patchPath = resolve(import.meta.dir, "titlebar-drag.patch");
export const checkboxPatchPath = resolve(
	import.meta.dir,
	"checkbox-a11y.patch"
);
export const diffPatchPath = resolve(import.meta.dir, "diff-scroll.patch");
export const diffContextPatchPath = resolve(
	import.meta.dir,
	"diff-context.patch"
);
export const diffSplitPatchPath = resolve(import.meta.dir, "diff-split.patch");
export const diffSplitLayoutPatchPath = resolve(
	import.meta.dir,
	"diff-split-layout.patch"
);
export const diffInclusionPatchPath = resolve(
	import.meta.dir,
	"diff-inclusion.patch"
);
export const diffSyntaxPatchPath = resolve(
	import.meta.dir,
	"diff-syntax.patch"
);
export const diffInclusionThemePatchPath = resolve(
	import.meta.dir,
	"diff-inclusion-theme.patch"
);
export const diffRailsPatchPath = resolve(import.meta.dir, "diff-rails.patch");
export const textareaViewportPatchPath = resolve(
	import.meta.dir,
	"textarea-viewport.patch"
);
export const textareaDecorationsPatchPath = resolve(
	import.meta.dir,
	"textarea-decorations.patch"
);
export const activationPatchPath = resolve(
	import.meta.dir,
	"window-activation.patch"
);
export const nativeLibrary = resolve(nativeDirectory, "gpuix-native.node");
export const closePatchPath = resolve(
	import.meta.dir,
	"close-protection.patch"
);
export const closePlatformPatchPath = resolve(
	import.meta.dir,
	"close-platform.patch"
);
export const buildIdPath = resolve(nativeDirectory, "build-id");
export const contextMenuPatchPath = resolve(
	import.meta.dir,
	"context-menu.patch"
);
export const contextMenuPlatformPatchPath = resolve(
	import.meta.dir,
	"context-menu-platform.patch"
);
export const contextMenuItemsPatchPath = resolve(
	import.meta.dir,
	"context-menu-items.patch"
);
export const contextMenuItemsPlatformPatchPath = resolve(
	import.meta.dir,
	"context-menu-items-platform.patch"
);
export const contextMenuOwnerPatchPath = resolve(
	import.meta.dir,
	"context-menu-owner.patch"
);
export const contextMenuOwnerPlatformPatchPath = resolve(
	import.meta.dir,
	"context-menu-owner-platform.patch"
);
export const contextMenuIconsPatchPath = resolve(
	import.meta.dir,
	"context-menu-icons.patch"
);
export const contextMenuIconsPlatformPatchPath = resolve(
	import.meta.dir,
	"context-menu-icons-platform.patch"
);
export const testSessionPatchPath = resolve(
	import.meta.dir,
	"test-session.patch"
);
export const testSessionPlatformPatchPath = resolve(
	import.meta.dir,
	"test-session-platform.patch"
);
export const liveFramePlatformPatchPath = resolve(
	import.meta.dir,
	"live-frame-platform.patch"
);
export const elementBoundsPatchPath = resolve(
	import.meta.dir,
	"element-bounds.patch"
);
export const anchoredCenterPatchPath = resolve(
	import.meta.dir,
	"anchored-center.patch"
);
export const sidebarVibrancyPlatformPatchPath = resolve(
	import.meta.dir,
	"sidebar-vibrancy-platform.patch"
);
export const roundedOverflowPlatformPatchPath = resolve(
	import.meta.dir,
	"rounded-overflow-platform.patch"
);
export const windowAppearancePatchPath = resolve(
	import.meta.dir,
	"window-appearance.patch"
);
export const windowAppearancePlatformPatchPath = resolve(
	import.meta.dir,
	"window-appearance-platform.patch"
);
/** Changing the patch, revision, or host invalidates the local binary. */
export const accountsPatchPath = resolve(import.meta.dir, "accounts.patch");
export const accountsPlatformPatchPath = resolve(
	import.meta.dir,
	"accounts-platform.patch"
);
export const workspaceShortcutsPatchPath = resolve(
	import.meta.dir,
	"workspace-shortcuts.patch"
);
export const systemAppearancePlatformPatchPath = resolve(
	import.meta.dir,
	"system-appearance-platform.patch"
);
export const systemAppearancePatchPath = resolve(
	import.meta.dir,
	"system-appearance.patch"
);
export const menuPlacementPlatformPatchPath = resolve(
	import.meta.dir,
	"menu-placement-platform.patch"
);
export const scrollMetricsPatchPath = resolve(
	import.meta.dir,
	"scroll-metrics.patch"
);
export const textScalePatchPath = resolve(import.meta.dir, "text-scale.patch");
export const frameScrollbarPatchPath = resolve(
	import.meta.dir,
	"frame-scrollbar.patch"
);
export const diffTrailingContextPatchPath = resolve(
	import.meta.dir,
	"diff-trailing-context.patch"
);
export const nativeBuildId = createHash("sha256")
	.update(nativeRevision)
	.update(readFileSync(patchPath))
	.update(readFileSync(checkboxPatchPath))
	.update(readFileSync(diffPatchPath))
	.update(readFileSync(diffContextPatchPath))
	.update(readFileSync(diffSplitPatchPath))
	.update(readFileSync(diffSplitLayoutPatchPath))
	.update(readFileSync(diffInclusionPatchPath))
	.update(readFileSync(diffSyntaxPatchPath))
	.update(readFileSync(diffInclusionThemePatchPath))
	.update(readFileSync(diffRailsPatchPath))
	.update(readFileSync(textareaViewportPatchPath))
	.update(readFileSync(textareaDecorationsPatchPath))
	.update(readFileSync(activationPatchPath))
	.update(readFileSync(closePatchPath))
	.update(readFileSync(closePlatformPatchPath))
	.update(readFileSync(contextMenuPatchPath))
	.update(readFileSync(contextMenuPlatformPatchPath))
	.update(readFileSync(contextMenuItemsPatchPath))
	.update(readFileSync(contextMenuItemsPlatformPatchPath))
	.update(readFileSync(contextMenuOwnerPatchPath))
	.update(readFileSync(contextMenuOwnerPlatformPatchPath))
	.update(readFileSync(testSessionPatchPath))
	.update(readFileSync(testSessionPlatformPatchPath))
	.update(readFileSync(liveFramePlatformPatchPath))
	.update(readFileSync(elementBoundsPatchPath))
	.update(readFileSync(anchoredCenterPatchPath))
	.update(readFileSync(sidebarVibrancyPlatformPatchPath))
	.update(readFileSync(roundedOverflowPlatformPatchPath))
	.update(readFileSync(windowAppearancePatchPath))
	.update(readFileSync(windowAppearancePlatformPatchPath))
	.update(readFileSync(accountsPatchPath))
	.update(readFileSync(accountsPlatformPatchPath))
	.update(readFileSync(contextMenuIconsPatchPath))
	.update(readFileSync(contextMenuIconsPlatformPatchPath))
	.update(readFileSync(workspaceShortcutsPatchPath))
	.update(readFileSync(systemAppearancePlatformPatchPath))
	.update(readFileSync(systemAppearancePatchPath))
	.update(readFileSync(menuPlacementPlatformPatchPath))
	.update(readFileSync(scrollMetricsPatchPath))
	.update(readFileSync(textScalePatchPath))
	.update(readFileSync(frameScrollbarPatchPath))
	.update(readFileSync(diffTrailingContextPatchPath))
	.update(`${process.platform}-${process.arch}-release-v1`)
	.digest("hex");
