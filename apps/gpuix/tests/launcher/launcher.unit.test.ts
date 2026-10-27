/**
 * Covers: local path parsing, single-instance Unix-socket handoff, and safe PATH installation.
 * Real: node's Unix socket and filesystem permissions in disposable temp directories.
 * Doubles: none.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { lstat, mkdir, readlink, writeFile } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	installLauncher,
	uninstallLauncher,
} from "../../src/launcher/launcher-installation";
import { launcherScript } from "../../src/launcher/launcher-script";
import {
	LauncherService,
	sendLauncherRequest,
} from "../../src/launcher/launcher-service";
import {
	parseLauncherArguments,
	parseLauncherRequest,
} from "../../src/launcher/launcher-protocol";

it("normalizes local paths and rejects remote-looking arguments", async () => {
	const directory = await mkdtemp(join(tmpdir(), "1git-launcher-"));
	const nested = join(directory, "repo");

	await mkdir(nested);

	expect(parseLauncherArguments(["repo"], directory).path).toBe(
		await realpath(nested)
	);
	expect(parseLauncherArguments([], directory)).toEqual({ version: 1 });
	expect(() =>
		parseLauncherArguments(["https://example.test"], directory)
	).toThrow("local paths");
	expect(() => parseLauncherArguments(["one", "two"], directory)).toThrow(
		"zero or one"
	);
	expect(() =>
		parseLauncherRequest('{"version":1,"path":"/tmp/a\\u0000b"}')
	).toThrow();
});

it("hands requests to the running process and cleans up its socket", async () => {
	const directory = await mkdtemp(join(tmpdir(), "1git-launcher-socket-"));
	const socketPath = join(directory, "launcher.sock");
	const received: string[] = [];

	const service = new LauncherService(socketPath, (request) => {
		if (request.path) received.push(request.path);
	});

	expect(await service.start()).toBe(true);
	expect(
		await sendLauncherRequest(parseLauncherArguments([directory]), socketPath)
	).toBe(true);
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(received).toEqual([await realpath(directory)]);
	expect(await service.start()).toBe(true);
	await service.stop();
	expect(
		await sendLauncherRequest(parseLauncherArguments([]), socketPath, 20)
	).toBe(false);
});

it("installs and removes only its own launcher link", async () => {
	const directory = await mkdtemp(join(tmpdir(), "1git-launcher-install-"));
	const bundle = join(directory, "1git.app");
	const source = join(bundle, "Contents", "Resources", "1git-launcher");
	const targetDirectory = join(directory, "bin");

	await mkdir(join(bundle, "Contents", "Resources"), { recursive: true });
	await writeFile(source, launcherScript, { mode: 0o755 });

	const target = await installLauncher({ bundlePath: bundle, targetDirectory });

	expect((await lstat(target)).isSymbolicLink()).toBe(true);
	expect(await readlink(target)).toBe(source);
	expect(await installLauncher({ bundlePath: bundle, targetDirectory })).toBe(
		target
	);
	expect(await uninstallLauncher({ bundlePath: bundle, targetDirectory })).toBe(
		true
	);
	expect(await uninstallLauncher({ bundlePath: bundle, targetDirectory })).toBe(
		false
	);
});
