import {
	defaultLauncherSocketPath,
	LauncherRequestQueue,
	LauncherService,
	type LauncherRequestHandler,
} from "./launcher-service";

const runtimeKey = Symbol.for("1git.launcher.runtime");

interface LauncherRuntime {
	readonly requests: LauncherRequestQueue;
	readonly service: LauncherService;
}

const globals = globalThis as Record<PropertyKey, unknown>;

const isRuntime = (value: unknown): value is LauncherRuntime => {
	if (typeof value !== "object" || value === null) return false;

	const runtime = value as Partial<LauncherRuntime>;

	return (
		typeof runtime.requests?.enqueue === "function" &&
		typeof runtime.requests?.subscribe === "function" &&
		typeof runtime.service?.start === "function" &&
		typeof runtime.service?.setRequestHandler === "function"
	);
};

/** Reuses the launcher transport across Bun hot re-evaluation within one process. */
export const getLauncherRuntime = (
	socketPath = defaultLauncherSocketPath()
): LauncherRuntime => {
	const existing = globals[runtimeKey];

	if (isRuntime(existing)) {
		existing.service.setRequestHandler((request) =>
			existing.requests.enqueue(request)
		);

		return existing;
	}

	const requests = new LauncherRequestQueue();

	const onRequest: LauncherRequestHandler = (request) =>
		requests.enqueue(request);

	const runtime: LauncherRuntime = {
		requests,
		service: new LauncherService(socketPath, onRequest),
	};

	globals[runtimeKey] = runtime;

	return runtime;
};
