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
/** Changing the patch, revision, or host invalidates the local binary. */
export const accountsPatchPath = resolve(import.meta.dir, "accounts.patch");
export const accountsPlatformPatchPath = resolve(
	import.meta.dir,
	"accounts-platform.patch"
);
export const nativeBuildId = createHash("sha256")
	.update(nativeRevision)
	.update(readFileSync(patchPath))
	.update(readFileSync(checkboxPatchPath))
	.update(readFileSync(diffPatchPath))
	.update(readFileSync(diffContextPatchPath))
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
	.update(readFileSync(elementBoundsPatchPath))
	.update(readFileSync(anchoredCenterPatchPath))
	.update(readFileSync(sidebarVibrancyPlatformPatchPath))
	.update(readFileSync(accountsPatchPath))
	.update(readFileSync(accountsPlatformPatchPath))
	.update(readFileSync(contextMenuIconsPatchPath))
	.update(readFileSync(contextMenuIconsPlatformPatchPath))
	.update(`${process.platform}-${process.arch}-release-v1`)
	.digest("hex");
