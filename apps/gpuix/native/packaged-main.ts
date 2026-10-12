import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The executable contains Bun, not the app's filesystem-dependent native modules.
// Resolve both from the bundle so Finder launches never depend on cwd or a checkout.
const contents = resolve(dirname(process.execPath), "..");

process.env.NAPI_RS_NATIVE_LIBRARY_PATH = resolve(
	contents,
	"Frameworks/gpuix-native.node"
);

await import(pathToFileURL(resolve(contents, "Resources/app.js")).href);
