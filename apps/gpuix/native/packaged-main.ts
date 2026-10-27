import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sendLauncherRequest } from "../src/launcher/launcher-service";
import {
	launcherValidationFallbackExitCode,
	launcherPathOutputMarker,
	parseLauncherArguments,
} from "../src/launcher/launcher-protocol";

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

if (process.env.ONEGIT_LAUNCHER_MODE === "1") {
	const validationOnly = process.env.ONEGIT_LAUNCHER_VALIDATE === "1";
	let request: ReturnType<typeof parseLauncherArguments>;

	try {
		request = parseLauncherArguments(process.argv.slice(2));
	} catch (error: unknown) {
		process.stderr.write(
			`1git launcher: ${error instanceof Error ? error.message : String(error)}\n`
		);
		process.exit(2);
	}

	if (await sendLauncherRequest(request)) process.exit(0);

	if (validationOnly) {
		if (process.env.ONEGIT_LAUNCHER_PRINT_PATH === "1" && request.path)
			process.stdout.write(`${request.path}${launcherPathOutputMarker}`);

		process.exit(launcherValidationFallbackExitCode);
	}
}

await import(pathToFileURL(resolve(contents, "Resources/app.js")).href);
