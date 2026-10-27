import { lstat, mkdir, readlink, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { launcherScript } from "./launcher-script";

export const launcherName = "1git";
export const launcherFileName = "1git-launcher";
export const userLauncherDirectory = (): string =>
	join(homedir(), ".local", "bin");
export const systemLauncherDirectory = "/usr/local/bin";

export const applicationBundlePath = (
	executablePath = process.execPath
): string | undefined => {
	const macOsDirectory = dirname(executablePath);
	const contentsDirectory = dirname(macOsDirectory);

	if (
		macOsDirectory.endsWith("/MacOS") &&
		contentsDirectory.endsWith("/Contents")
	)
		return dirname(contentsDirectory);

	return undefined;
};

export const bundleLauncherPath = (bundlePath: string): string =>
	join(bundlePath, "Contents", "Resources", launcherFileName);

export interface LauncherInstallOptions {
	readonly bundlePath: string;
	readonly targetDirectory: string;
}

export type LauncherLinkStatus = "missing" | "installed" | "different";

export const launcherLinkStatus = async ({
	bundlePath,
	targetDirectory,
}: LauncherInstallOptions): Promise<LauncherLinkStatus> => {
	const source = bundleLauncherPath(resolve(bundlePath));
	const target = join(resolve(targetDirectory), launcherName);

	try {
		const info = await lstat(target);

		if (!info.isSymbolicLink()) return "different";

		return (await readlink(target)) === source ? "installed" : "different";
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			return "missing";

		throw error;
	}
};

/** AppleScript source used only after the user explicitly accepts macOS authorization. */
export const administratorInstallScript = `on run argv
set sourcePath to item 1 of argv
set targetPath to item 2 of argv
set targetDirectory to item 3 of argv
set command to "/bin/mkdir -p " & quoted form of targetDirectory & " && /bin/ln -s " & quoted form of sourcePath & " " & quoted form of targetPath
do shell script command with administrator privileges
return targetPath
end run`;

/** Verifies the symlink target as root before removing it. */
export const administratorUninstallScript = `on run argv
set sourcePath to item 1 of argv
set targetPath to item 2 of argv
set targetArg to quoted form of targetPath
set sourceArg to quoted form of sourcePath
set command to "/usr/bin/test " & quote & "$(/usr/bin/readlink " & targetArg & ")" & quote & " = " & sourceArg & " && /bin/rm " & targetArg
do shell script command with administrator privileges
return "removed"
end run`;

/** Install only a symlink to our own bundle script; never replace an unrelated executable. */
export const installLauncher = async ({
	bundlePath,
	targetDirectory,
}: LauncherInstallOptions): Promise<string> => {
	const source = bundleLauncherPath(resolve(bundlePath));
	const target = join(resolve(targetDirectory), launcherName);

	await mkdir(dirname(target), { recursive: true, mode: 0o755 });

	try {
		const info = await lstat(target);

		if (!info.isSymbolicLink())
			throw new Error(
				`${target} already exists and is not a 1git launcher link.`
			);

		if ((await readlink(target)) === source) return target;

		throw new Error(`${target} already points to another launcher.`);
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
			throw error;
	}

	await symlink(source, target);

	return target;
};

export const uninstallLauncher = async ({
	bundlePath,
	targetDirectory,
}: LauncherInstallOptions): Promise<boolean> => {
	const source = bundleLauncherPath(resolve(bundlePath));
	const target = join(resolve(targetDirectory), launcherName);

	try {
		const info = await lstat(target);

		if (!info.isSymbolicLink() || (await readlink(target)) !== source)
			throw new Error(`${target} is not a 1git launcher link.`);

		await rm(target);

		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			return false;

		throw error;
	}
};

/** macOS-only helper for the Application settings action; paths are passed as argv, never shell-interpolated. */
export const installLauncherWithPrivilegePrompt = async (
	options: LauncherInstallOptions
): Promise<string> => {
	try {
		return await installLauncher(options);
	} catch (error) {
		if (
			process.platform !== "darwin" ||
			options.targetDirectory !== systemLauncherDirectory ||
			!(
				error instanceof Error &&
				"code" in error &&
				(error.code === "EACCES" || error.code === "EPERM")
			)
		)
			throw error;

		const source = bundleLauncherPath(resolve(options.bundlePath));
		const target = join(resolve(options.targetDirectory), launcherName);

		const child = Bun.spawn(
			[
				"/usr/bin/osascript",
				"-e",
				administratorInstallScript,
				source,
				target,
				resolve(options.targetDirectory),
			],
			{
				stdout: "pipe",
				stderr: "pipe",
			}
		);

		const errors = await new Response(child.stderr).text();

		if ((await child.exited) !== 0)
			throw new Error(errors.trim() || "Could not install the 1git command.");

		return target;
	}
};

/** Remove a system link through the same administrator prompt, after checking its target. */
export const uninstallLauncherWithPrivilegePrompt = async (
	options: LauncherInstallOptions
): Promise<boolean> => {
	try {
		return await uninstallLauncher(options);
	} catch (error) {
		if (
			process.platform !== "darwin" ||
			options.targetDirectory !== systemLauncherDirectory ||
			!(
				error instanceof Error &&
				"code" in error &&
				(error.code === "EACCES" || error.code === "EPERM")
			)
		)
			throw error;

		const source = bundleLauncherPath(resolve(options.bundlePath));
		const target = join(resolve(options.targetDirectory), launcherName);

		const child = Bun.spawn(
			[
				"/usr/bin/osascript",
				"-e",
				administratorUninstallScript,
				source,
				target,
			],
			{
				stdout: "pipe",
				stderr: "pipe",
			}
		);

		const errors = await new Response(child.stderr).text();

		if ((await child.exited) !== 0) {
			if (errors.includes("No such file")) return false;

			throw new Error(errors.trim() || "Could not remove the 1git command.");
		}

		return true;
	}
};

export { launcherScript };
