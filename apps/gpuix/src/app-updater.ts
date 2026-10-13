import { dlopen, JSCallback } from "bun:ffi";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { AppTermination } from "./app-termination";

/** Lifetime owner for the packaged macOS updater; development stays unchanged. */
export class AppUpdater {
	private static runtime: ReturnType<typeof dlopen> | undefined;
	private static quitCallback: JSCallback | undefined;

	static start(): void {
		if (process.platform !== "darwin" || this.runtime) return;

		const bridge = resolve(
			dirname(process.execPath),
			"../Frameworks/1git-updater.dylib"
		);

		if (!existsSync(bridge)) return;

		try {
			this.quitCallback = new JSCallback(
				() => {
					try {
						return AppTermination.canQuit();
					} catch {
						return false;
					}
				},
				{ returns: "bool", args: [] }
			);
			const runtime = dlopen(bridge, {
				onegit_updater_start: { args: ["ptr"], returns: "void" },
			});

			if (!this.quitCallback.ptr)
				throw new Error("Could not create the quit callback.");

			this.runtime = runtime;
			runtime.symbols.onegit_updater_start(this.quitCallback.ptr);
		} catch (error) {
			process.stderr.write(
				`1git: Updater unavailable: ${error instanceof Error ? error.message : "native initialization failed"}\n`
			);
		}
	}
}
