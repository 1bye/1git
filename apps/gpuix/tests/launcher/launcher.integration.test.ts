/**
 * Covers: Unix-socket handoff, singleton ownership, frame handling, acknowledgements, and PATH links.
 * Real: node Unix sockets, filesystem permissions, and symlinks in disposable temp directories.
 * Doubles: a local fake socket server for acknowledgement edge cases.
 * Requires: a local filesystem with Unix-domain socket support.
 */
import { afterEach, expect, it } from "bun:test";
import { lstat, mkdir, readlink, rm, stat, writeFile } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import {
	createConnection,
	createServer,
	type Server,
	type Socket,
} from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

const directories = new Set<string>();
const services = new Set<LauncherService>();
const servers = new Set<Server>();
const staleProcesses = new Set<ReturnType<typeof Bun.spawn>>();

const tempDirectory = async (prefix: string): Promise<string> => {
	const directory = await mkdtemp(join(tmpdir(), prefix));

	directories.add(directory);

	return directory;
};

const trackedService = (
	...args: ConstructorParameters<typeof LauncherService>
): LauncherService => {
	const service = new LauncherService(...args);

	services.add(service);

	return service;
};

const trackedServer = (listener: (socket: Socket) => void): Server => {
	const server = createServer(listener);

	servers.add(server);

	return server;
};

const createStaleSocket = async (
	path: string
): Promise<ReturnType<typeof Bun.spawn>> => {
	const code =
		'import { createServer } from "node:net"; const server = createServer(); server.listen(process.argv[1]); setInterval(() => {}, 1000);';

	const child = Bun.spawn([process.execPath, "-e", code, path], {
		stdout: "ignore",
		stderr: "pipe",
	});

	staleProcesses.add(child);

	for (let attempt = 0; attempt < 100; attempt += 1) {
		try {
			if ((await lstat(path)).isSocket()) return child;
		} catch {
			// The helper has not bound its endpoint yet.
		}

		await Bun.sleep(10);
	}

	child.kill("SIGKILL");
	await child.exited;
	staleProcesses.delete(child);

	throw new Error("Could not create a stale launcher socket.");
};

afterEach(async () => {
	for (const service of services) await service.stop();

	services.clear();

	for (const child of staleProcesses) {
		child.kill("SIGKILL");
		await child.exited;
	}

	staleProcesses.clear();

	for (const server of servers) {
		if (server.listening) await close(server);
	}

	servers.clear();

	for (const directory of directories)
		await rm(directory, { recursive: true, force: true });

	directories.clear();
});

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
	const directory = await tempDirectory("1git-launcher-socket-");
	const socketPath = join(directory, "private", "launcher.sock");
	const received: string[] = [];

	const service = trackedService(socketPath, (request) => {
		if (request.path) received.push(request.path);
	});

	expect(await service.start()).toBe(true);
	expect((await stat(dirname(socketPath))).mode & 0o777).toBe(0o700);
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
	const directory = await tempDirectory("1git-launcher-owner-");
	const socketPath = join(directory, "launcher.sock");
	const owner = trackedService(socketPath);
	const contender = trackedService(socketPath);

	expect(await owner.start()).toBe(true);
	expect(await contender.start()).toBe(false);
	await contender.stop();
	expect(
		await sendLauncherRequest(parseLauncherArguments([]), socketPath)
	).toBe(true);
	await owner.stop();
});

it("lets only one concurrent startup claim a missing socket", async () => {
	const directory = await tempDirectory("1git-launcher-race-");
	const socketPath = join(directory, "launcher.sock");
	const first = trackedService(socketPath);
	const second = trackedService(socketPath);
	const results = await Promise.all([first.start(), second.start()]);

	expect(results.filter(Boolean)).toHaveLength(1);
	expect(results.filter((result) => !result)).toHaveLength(1);
	await first.stop();
	await second.stop();
});

it("reclaims a lock only after its recorded owner exits", async () => {
	const directory = await tempDirectory("1git-launcher-lock-");
	const socketPath = join(directory, "launcher.sock");
	const lockPath = `${socketPath}.lock`;

	await writeFile(lockPath, "999999999\n");

	const service = trackedService(socketPath);

	expect(await service.start()).toBe(true);
	await service.stop();
});

it("removes stale sockets and accepts fragmented requests", async () => {
	const directory = await tempDirectory("1git-launcher-fragment-");
	const socketPath = join(directory, "launcher.sock");
	const stale = await createStaleSocket(socketPath);

	expect((await lstat(socketPath)).isSocket()).toBe(true);
	stale.kill("SIGKILL");
	await stale.exited;
	staleProcesses.delete(stale);

	const received: string[] = [];

	const service = trackedService(socketPath, (request) => {
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
	const directory = await tempDirectory("1git-launcher-invalid-");
	const socketPath = join(directory, "launcher.sock");
	let received = 0;

	const service = trackedService(socketPath, () => {
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
	const directory = await tempDirectory("1git-launcher-ack-");
	const socketPath = join(directory, "launcher.sock");

	const fragmented = trackedServer((socket) => {
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
	const negative = trackedServer((socket) => socket.end('{"ok":false}\n'));

	await listen(negative, negativePath);
	expect(
		await sendLauncherRequest(parseLauncherArguments([]), negativePath)
	).toBe(false);
	await new Promise((resolve) => setTimeout(resolve, 20));
	await close(negative);
});

it("installs and removes only its own launcher link", async () => {
	const directory = await tempDirectory("1git-launcher-install-");
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
