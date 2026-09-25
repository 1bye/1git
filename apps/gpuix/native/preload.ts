import { existsSync, readFileSync } from "node:fs";

import { buildIdPath, nativeBuildId, nativeLibrary } from "./config";

if (
	!existsSync(nativeLibrary) ||
	!existsSync(buildIdPath) ||
	readFileSync(buildIdPath, "utf8") !== nativeBuildId
) {
	throw new Error(
		"Missing or stale GPUIX native patch. Run: bun run --cwd apps/gpuix build:native"
	);
}

// Must run before any @gpuix imports; loaded native addons cannot be replaced by HMR.
process.env.NAPI_RS_NATIVE_LIBRARY_PATH = nativeLibrary;
