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
export const nativeLibrary = resolve(nativeDirectory, "gpuix-native.node");
export const buildIdPath = resolve(nativeDirectory, "build-id");
/** Changing the patch, revision, or host invalidates the local binary. */
export const nativeBuildId = createHash("sha256")
	.update(nativeRevision)
	.update(readFileSync(patchPath))
	.update(readFileSync(checkboxPatchPath))
	.update(readFileSync(diffPatchPath))
	.update(`${process.platform}-${process.arch}-release-v1`)
	.digest("hex");
