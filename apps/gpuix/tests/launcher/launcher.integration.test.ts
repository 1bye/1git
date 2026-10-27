/**
 * Covers: Unix-socket handoff, singleton ownership, frame handling, acknowledgements, and PATH links.
 * Real: node Unix sockets, filesystem permissions, and symlinks in disposable temp directories.
 * Doubles: a local fake socket server for acknowledgement edge cases.
 * Requires: a local filesystem with Unix-domain socket support.
 */
import { expect, it } from "bun:test";
import { lstat, mkdir, readlink, writeFile } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { createConnection, createServer, type Server } from "node:net";
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
import { parseLauncherArguments } from "../../src/launcher/launcher-protocol";

const listen = (server: Server, path: string): Promise<void> =>
	new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(path, resolve);
	});

const close = (server: Server): Promise<void> => {
	(
		server as Server & { closeAllConnections?: () => void }
	).closeAllConnections?.();

	return new Promise((resolve) => {
		let settled = false;

		const finish = () => {
			if (settled) return;

			settled = true;
			resolve();
		};

		server.close(finish);
		setTimeout(finish, 100);
	});
};

const writeFragments = (
	path: string,
	fragments: readonly string[]
): Promise<string> =>
	new Promise((resolve, reject) => {
		const socket = createConnection({ path });
		let output = "";

		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => {
			output += chunk;
		});
		socket.once("end", () => resolve(output));
		socket.once("error", reject);
		socket.once("connect", () => {
			for (const [index, fragment] of fragments.entries())
				setTimeout(() => socket.write(fragment), index * 5);

			setTimeout(() => socket.end(), fragments.length * 5 + 5);
		});
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

it("preserves the owner when a competing service stops", async () => {
	const directory = await mkdtemp(join(tmpdir(), "1git-launcher-owner-"));
	const socketPath = join(directory, "launcher.sock");
	const owner = new LauncherService(socketPath);
	const contender = new LauncherService(socketPath);

	expect(await owner.start()).toBe(true);
	expect(await contender.start()).toBe(false);
	await contender.stop();
	expect(
		await sendLauncherRequest(parseLauncherArguments([]), socketPath)
	).toBe(true);
	await owner.stop();
});

it("lets only one concurrent startup claim a missing socket", async () => {
	const directory = await mkdtemp(join(tmpdir(), "1git-launcher-race-"));
	const socketPath = join(directory, "launcher.sock");
	const first = new LauncherService(socketPath);
	const second = new LauncherService(socketPath);
	const results = await Promise.all([first.start(), second.start()]);

	expect(results.filter(Boolean)).toHaveLength(1);
	expect(results.filter((result) => !result)).toHaveLength(1);
	await first.stop();
	await second.stop();
});

it("removes stale sockets and accepts fragmented requests", async () => {
	const directory = await mkdtemp(join(tmpdir(), "1git-launcher-fragment-"));
	const socketPath = join(directory, "launcher.sock");
	const stale = createServer();

	await listen(stale, socketPath);
	await close(stale);

	const received: string[] = [];

	const service = new LauncherService(socketPath, (request) => {
		if (request.path) received.push(request.path);
	});

	expect(await service.start()).toBe(true);

	const payload = JSON.stringify(parseLauncherArguments([directory]));

	expect(
		await writeFragments(socketPath, [
			`${payload.slice(0, 8)}`,
			`${payload.slice(8)}\n`,
		])
	).toBe('{"ok":true}\n');
	expect(received).toEqual([await realpath(directory)]);
	await service.stop();
});

it("rejects malformed and oversized frames without dispatching them", async () => {
	const directory = await mkdtemp(join(tmpdir(), "1git-launcher-invalid-"));
	const socketPath = join(directory, "launcher.sock");
	let received = 0;

	const service = new LauncherService(socketPath, () => {
		received += 1;
	});

	expect(await service.start()).toBe(true);

	const malformed = await writeFragments(socketPath, [
		'{"version":1,"extra":true}\n',
	]);

	const oversized = await writeFragments(socketPath, [
		`{"version":1,"path":"/${"a".repeat(4096 + 32)}"}\n`,
	]);

	expect(malformed).toBe("");
	expect(oversized).toBe("");
	expect(received).toBe(0);
	await service.stop();
});

it("waits for complete acknowledgements and rejects negative ones", async () => {
	const directory = await mkdtemp(join(tmpdir(), "1git-launcher-ack-"));
	const socketPath = join(directory, "launcher.sock");

	const fragmented = createServer((socket) => {
		socket.write('{"ok":');
		setTimeout(() => socket.end("true}\n"), 5);
	});

	await listen(fragmented, socketPath);
	expect(
		await sendLauncherRequest(parseLauncherArguments([]), socketPath)
	).toBe(true);
	await new Promise((resolve) => setTimeout(resolve, 20));
	await close(fragmented);

	const negativePath = join(directory, "negative.sock");
	const negative = createServer((socket) => socket.end('{"ok":false}\n'));

	await listen(negative, negativePath);
	expect(
		await sendLauncherRequest(parseLauncherArguments([]), negativePath)
	).toBe(false);
	await new Promise((resolve) => setTimeout(resolve, 20));
	await close(negative);
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
