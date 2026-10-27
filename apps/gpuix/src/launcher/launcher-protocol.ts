import { realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/** The launcher protocol is deliberately tiny so a shell launcher can hand off to a running app. */
export const launcherProtocolVersion = 1 as const;
export const launcherMaxPathBytes = 4096;
/** Shell launchers use this status to distinguish validation from first startup. */
export const launcherValidationFallbackExitCode = 10;
/** Internal stdout framing for canonical paths returned by packaged validation. */
export const launcherPathOutputMarker = "__1git_launcher_path_end__";

export interface LauncherRequest {
	readonly version: typeof launcherProtocolVersion;
	readonly path?: string;
}

const asLocalPath = (value: string, cwd: string): string => {
	if (!value || value.includes("\0"))
		throw new Error("The 1git path must be a non-empty local filesystem path.");

	if (value.includes("://"))
		throw new Error("The 1git launcher accepts local paths only.");

	const path = resolve(cwd, value);

	if (Buffer.byteLength(path, "utf8") > launcherMaxPathBytes)
		throw new Error("The 1git path is too long.");

	return isAbsolute(path) ? path : resolve(path);
};

/** Resolve one CLI path without requiring it to exist; Git handles missing paths in the app flow. */
export const resolveLauncherPath = (
	value: string | undefined,
	cwd = process.cwd()
): string | undefined => {
	if (value === undefined) return undefined;

	const path = asLocalPath(value, cwd);

	try {
		return realpathSync.native(path);
	} catch {
		return path;
	}
};

export const parseLauncherArguments = (
	args: readonly string[],
	cwd = process.cwd()
): LauncherRequest => {
	// Older Launch Services versions append this process marker when opening an app from Finder.
	const positional = args.filter((argument) => !argument.startsWith("-psn_"));

	if (positional.length > 1)
		throw new Error("The 1git launcher accepts zero or one path argument.");

	const path = resolveLauncherPath(positional[0], cwd);

	return path === undefined
		? { version: launcherProtocolVersion }
		: { version: launcherProtocolVersion, path };
};

export const encodeLauncherRequest = (request: LauncherRequest): string =>
	`${JSON.stringify(request)}\n`;

export const parseLauncherRequest = (value: string): LauncherRequest => {
	if (Buffer.byteLength(value, "utf8") > launcherMaxPathBytes + 128)
		throw new Error("The 1git launcher request is too large.");

	let parsed: unknown;

	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error("The 1git launcher request is not valid JSON.");
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
		throw new Error("The 1git launcher request is unsupported.");

	const record = parsed as Record<string, unknown>;
	const keys = Object.keys(record);

	if (
		keys.some((key) => key !== "version" && key !== "path") ||
		record.version !== launcherProtocolVersion ||
		(record.path !== undefined && typeof record.path !== "string")
	)
		throw new Error("The 1git launcher request is unsupported.");

	const path = record.path;

	if (path !== undefined && !isAbsolute(path))
		throw new Error("The 1git launcher request path must be absolute.");

	return {
		version: launcherProtocolVersion,
		...(path === undefined ? {} : { path: resolveLauncherPath(path) }),
	};
};
