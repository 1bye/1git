/**
 * Covers: Unix-socket handoff, singleton ownership, frame handling, acknowledgements, and PATH links.
 * Real: node Unix sockets, filesystem permissions, and symlinks in disposable temp directories.
 * Doubles: a local fake socket server for acknowledgement edge cases.
 * Requires: a local filesystem with Unix-domain socket support.
 */
import { afterEach, expect, it } from "bun:test";
import {
	lstat,
	mkdir,
	readFile,
	readlink,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
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
import { getLauncherRuntime } from "../../src/launcher/launcher-runtime";
import {
	launcherPathOutputMarker,
	parseLauncherArguments,
} from "../../src/launcher/launcher-protocol";

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

it("reuses one launcher runtime across module re-evaluation", async () => {
	const directory = await tempDirectory("1git-launcher-runtime-");
	const socketPath = join(directory, "launcher.sock");
	const received: string[] = [];
	const first = getLauncherRuntime(socketPath);

	const unsubscribe = first.requests.subscribe((request) => {
		if (request.path) received.push(request.path);
	});

	expect(await first.service.start()).toBe(true);

	const second = getLauncherRuntime(socketPath);

	expect(second.service).toBe(first.service);
	expect(second.requests).toBe(first.requests);
	expect(await second.service.start()).toBe(true);
	expect(
		await sendLauncherRequest(parseLauncherArguments([directory]), socketPath)
	).toBe(true);
	await Bun.sleep(10);
	expect(received).toEqual([await realpath(directory)]);

	unsubscribe();
	await first.service.stop();
});

it("shares in-flight startup across hot re-evaluation", async () => {
	const directory = await tempDirectory("1git-launcher-start-race-");
	const service = trackedService(join(directory, "launcher.sock"));

	expect(await Promise.all([service.start(), service.start()])).toEqual([
		true,
		true,
	]);
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

it("uses LaunchServices and waits for a delayed socket without respawning", async () => {
	const directory = await tempDirectory("1git-launcher-cold-start-");
	const bundle = join(directory, "1git.app");
	const contents = join(bundle, "Contents");
	const executable = join(contents, "MacOS", "1git");
	const launcher = join(contents, "Resources", "1git-launcher");
	const openStub = join(directory, "open");
	const binder = join(directory, "bind-socket.mjs");
	const recorder = join(directory, "record-open.mjs");
	const socketPath = join(directory, "launcher.sock");
	const openArguments = join(directory, "open-arguments.txt");
	const validationArguments = join(directory, "validation-arguments.txt");
	const inputPath = join(directory, "repo\n");

	await mkdir(join(contents, "MacOS"), { recursive: true });
	await mkdir(join(contents, "Resources"), { recursive: true });
	await mkdir(inputPath);
	await writeFile(
		executable,
		`#!/bin/sh
printf '%s\\n' "$*" >> "$LAUNCHER_VALIDATION_ARGUMENTS"
if [ "\${ONEGIT_LAUNCHER_VALIDATE:-0}" = 1 ]; then
  if [ "\${ONEGIT_LAUNCHER_PRINT_PATH:-0}" = 1 ]; then
    printf '%s${launcherPathOutputMarker}' "$LAUNCHER_CANONICAL_PATH"
  fi
  exit 10
fi
exit 0
`,
		{ mode: 0o755 }
	);
	await writeFile(
		binder,
		`import { createServer } from "node:net";
const server = createServer();
setTimeout(() => {
  server.listen(process.argv[2], () => setTimeout(() => server.close(), 500));
}, 3000);
`
	);
	await writeFile(
		recorder,
		`import { writeFile } from "node:fs/promises";
await writeFile(process.argv[2], JSON.stringify(process.argv.slice(3)));
`
	);
	await writeFile(
		openStub,
		`#!/bin/sh
"$LAUNCHER_RUNTIME" "$LAUNCHER_RECORDER" "$LAUNCHER_OPEN_ARGUMENTS" "$@"
"$LAUNCHER_RUNTIME" "$LAUNCHER_BINDER" "$LAUNCHER_SOCKET" >/dev/null 2>&1 &
`,
		{ mode: 0o755 }
	);
	await writeFile(
		launcher,
		launcherScript.replace(
			'openCommand="/usr/bin/open"',
			`openCommand="${openStub}"`
		),
		{ mode: 0o755 }
	);

	const child = Bun.spawn(["/bin/sh", launcher, "repo"], {
		cwd: directory,
		env: {
			...Bun.env,
			GPUIX_LAUNCHER_SOCKET: socketPath,
			LAUNCHER_BINDER: binder,
			LAUNCHER_CANONICAL_PATH: inputPath,
			LAUNCHER_RECORDER: recorder,
			LAUNCHER_OPEN_ARGUMENTS: openArguments,
			LAUNCHER_RUNTIME: process.execPath,
			LAUNCHER_SOCKET: socketPath,
			LAUNCHER_VALIDATION_ARGUMENTS: validationArguments,
		},
		stdout: "pipe",
		stderr: "pipe",
	});

	expect(await child.exited).toBe(0);
	expect(JSON.parse(await readFile(openArguments, "utf8"))).toEqual([
		"-a",
		bundle,
		"--args",
		inputPath,
	]);
	expect((await readFile(validationArguments, "utf8")).trim()).toBe("repo");
	await Bun.sleep(700);
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
