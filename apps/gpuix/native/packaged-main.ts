import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// libmalloc reads these at process startup; replace the bootstrap before loading the app.
if (
	process.env.MallocLargeCache === undefined ||
	process.env.MallocAggressiveMadvise === undefined
) {
	if (!process.execve) throw new Error("The packaged runtime requires execve.");

	process.execve(
		process.execPath,
		[process.execPath, ...process.execArgv, ...process.argv.slice(2)],
		{
			...process.env,
			MallocLargeCache: process.env.MallocLargeCache ?? "0",
			MallocAggressiveMadvise: process.env.MallocAggressiveMadvise ?? "1",
		}
	);
}

// The executable contains Bun, not the app's filesystem-dependent native modules.
// Resolve both from the bundle so Finder launches never depend on cwd or a checkout.
const contents = resolve(dirname(process.execPath), "..");

process.env.NAPI_RS_NATIVE_LIBRARY_PATH = resolve(
	contents,
	"Frameworks/gpuix-native.node"
);

process.env.GPUIX_REMOTE_HELPERS_DIR = resolve(
	contents,
	"Resources/remote-helpers"
);

await import(pathToFileURL(resolve(contents, "Resources/app.js")).href);
