/**
 * Covers: automatic helper installation, verified reuse/repair, multiplexed requests, remote clones/worktrees and cancellation over SSH.
 * Real: system ssh/sshd, generated disposable keys, compiled helper and isolated remote HOME/repository.
 * Doubles: none; no existing SSH configuration, credentials or remote host are used.
 * Requires: macOS, sshd, ssh-keygen, Bun, Git and loopback listening permission.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { SshConnection } from "../../src/feature/machines/ssh-connection";
import { isRecord } from "../../src/feature/machines/remote-protocol";

const execute = promisify(execFile);
let directory: string;
let home: string;
let daemon: ChildProcess;
let connection: SshConnection;
let previousHelpers: string | undefined;
let makeConnection: () => SshConnection;
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

beforeEach(async () => {
	directory = await realpath(await mkdtemp(join(tmpdir(), "1git-ssh-test-")));
	home = join(directory, "home");
	await mkdir(home);
	await execute("/usr/bin/ssh-keygen", [
		"-q",
		"-t",
		"ed25519",
		"-N",
		"",
		"-f",
		join(directory, "host"),
	]);
	await execute("/usr/bin/ssh-keygen", [
		"-q",
		"-t",
		"ed25519",
		"-N",
		"",
		"-f",
		join(directory, "identity"),
	]);
	await writeFile(
		join(directory, "authorized_keys"),
		await readFile(join(directory, "identity.pub"))
	);
	const listener = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => new Response(),
	});

	const port = listener.port;

	await listener.stop(true);

	if (!port) throw new Error("No loopback port available");

	await writeFile(
		join(directory, "known_hosts"),
		`[127.0.0.1]:${port} ${await readFile(join(directory, "host.pub"), "utf8")}`
	);
	await writeFile(
		join(directory, "client.conf"),
		`Host *\n  UserKnownHostsFile ${directory}/known_hosts\n  GlobalKnownHostsFile /dev/null\n  IdentitiesOnly yes\n  BatchMode yes\n  LogLevel ERROR\n`
	);
	await writeFile(
		join(directory, "command"),
		`#!/bin/sh\nexport HOME=${quote(home)}\nexport GIT_CONFIG_GLOBAL=/dev/null\nexport GIT_CONFIG_NOSYSTEM=1\nexec /bin/sh -c "$SSH_ORIGINAL_COMMAND"\n`,
		{ mode: 0o700 }
	);
	await writeFile(
		join(directory, "sshd.conf"),
		`Port ${port}\nListenAddress 127.0.0.1\nHostKey ${directory}/host\nPidFile ${directory}/sshd.pid\nAuthorizedKeysFile ${directory}/authorized_keys\nStrictModes no\nUsePAM no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPubkeyAuthentication yes\nAllowUsers ${userInfo().username}\nForceCommand ${directory}/command\nLogLevel ERROR\n`
	);
	let daemonErrors = "";

	daemon = spawn(
		"/usr/sbin/sshd",
		["-D", "-e", "-f", join(directory, "sshd.conf")],
		{ stdio: ["ignore", "ignore", "pipe"] }
	);
	daemon.stderr?.on("data", (bytes: Buffer) => {
		daemonErrors += bytes.toString("utf8");
	});
	const deadline = Date.now() + 5000;

	while (true) {
		try {
			await execute(
				"/usr/bin/ssh",
				[
					"-F",
					join(directory, "client.conf"),
					"-p",
					String(port),
					"-i",
					join(directory, "identity"),
					"127.0.0.1",
					"true",
				],
				{ timeout: 1000 }
			);

			break;
		} catch (cause) {
			if (Date.now() >= deadline || daemon.exitCode !== null)
				throw new Error(`Disposable SSH server unavailable: ${daemonErrors}`, {
					cause,
				});

			await Bun.sleep(50);
		}
	}

	await execute(
		process.execPath,
		[
			"run",
			resolve(import.meta.dir, "../../native/build-remote-helpers.ts"),
			"darwin-arm64",
		],
		{ maxBuffer: 1024 * 1024 }
	);
	previousHelpers = process.env.GPUIX_REMOTE_HELPERS_DIR;
	process.env.GPUIX_REMOTE_HELPERS_DIR = resolve(
		import.meta.dir,
		"../../build/remote-helpers"
	);
	makeConnection = () =>
		new SshConnection(
			{
				id: crypto.randomUUID(),
				name: "Disposable SSH",
				host: "127.0.0.1",
				username: userInfo().username,
				port,
				identityFile: join(directory, "identity"),
				folders: [],
			},
			async () => {
				throw new Error("No stored credentials expected");
			},
			() => undefined,
			join(directory, "client.conf")
		);
	connection = makeConnection();
}, 15_000);

afterEach(async () => {
	await connection?.dispose();
	daemon?.kill();

	if (previousHelpers === undefined)
		delete process.env.GPUIX_REMOTE_HELPERS_DIR;
	else process.env.GPUIX_REMOTE_HELPERS_DIR = previousHelpers;

	if (directory) await rm(directory, { recursive: true, force: true });
});

it("automatically installs the standalone helper and uses it to discover and read a checkout", async () => {
	const repository = join(home, "repo with spaces");

	await execute("git", ["init", "--initial-branch=main", repository]);
	await writeFile(join(repository, "new.txt"), "remote working file\n");
	await connection.connect();
	expect(connection.home).toBe(home);
	let observed = false;

	const scan = await connection.request(
		{ operation: "scan", folders: [home] },
		undefined,
		() => {
			observed = true;

			throw new Error("UI progress observer failed");
		}
	);

	expect(observed).toBe(true);

	expect(isRecord(scan) && scan.paths).toEqual([repository]);
	const results = await Promise.all([
		connection.request({
			operation: "call",
			path: repository,
			method: "getSnapshot",
			args: [],
		}),
		connection.request({
			operation: "call",
			path: repository,
			method: "getFileContent",
			args: [{ path: "new.txt", source: { kind: "working" } }],
		}),
	]);

	expect(results.every((result) => isRecord(result) && result.ok)).toBe(true);
	expect(JSON.stringify(results)).toContain("remote working file");
	const helpers = await readdir(join(home, ".local/share/1git/helpers"));

	expect(helpers).toHaveLength(1);
	const executable = join(
		home,
		".local/share/1git/helpers",
		helpers[0] ?? "",
		"1git-helper"
	);

	expect((await stat(executable)).mode & 0o777).toBe(0o700);
	const installed = await stat(executable);

	await connection.dispose();
	connection = makeConnection();
	await connection.connect();
	expect((await stat(executable)).mtimeMs).toBe(installed.mtimeMs);
	await connection.dispose();
	await writeFile(executable, "damaged helper");
	connection = makeConnection();
	await connection.connect();
	expect((await stat(executable)).size).toBe(installed.size);
	expect(connection.home).toBe(home);
}, 20_000);

it("clones and creates a worktree over SSH using machine-local paths", async () => {
	const source = join(home, "origin");
	const clone = join(home, "clone with spaces");
	const worktree = join(home, "linked checkout");

	await execute("git", ["init", "--initial-branch=main", source]);
	await writeFile(join(source, "tracked.txt"), "tracked\n");
	await execute("git", ["-C", source, "add", "."]);
	await execute("git", [
		"-C",
		source,
		"-c",
		"user.name=SSH Test",
		"-c",
		"user.email=ssh@example.invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"-m",
		"Base",
	]);
	const head = (
		await execute("git", ["-C", source, "rev-parse", "HEAD"])
	).stdout.trim();

	const cloned = await connection.request({
		operation: "clone",
		path: clone,
		remoteUrl: source,
	});

	expect(cloned).toEqual({ ok: true, path: clone });
	const initializedPath = join(home, "new repository");

	const initialized = await connection.request({
		operation: "initialize",
		path: initializedPath,
		branch: "develop",
	});

	expect(initialized).toEqual({ ok: true, path: initializedPath });
	expect(
		(
			await execute("git", ["-C", initializedPath, "branch", "--show-current"])
		).stdout.trim()
	).toBe("develop");
	const folders = await connection.request({
		operation: "list-directory",
		path: home,
		hidden: false,
	});

	expect(isRecord(folders) && folders.entries).toEqual(
		expect.arrayContaining([{ name: "new repository", path: initializedPath }])
	);
	const created = await connection.request({
		operation: "create-worktree",
		path: clone,
		input: {
			kind: "new",
			branch: "topic",
			path: worktree,
			expectedHead: head,
			expectedBranch: "main",
		},
	});

	expect(created).toEqual({ ok: true, value: worktree });
	expect(await Bun.file(join(worktree, "tracked.txt")).text()).toBe(
		"tracked\n"
	);
	expect(
		(
			await execute("git", ["-C", clone, "branch", "--show-current"])
		).stdout.trim()
	).toBe("main");
}, 20_000);

it("waits for the remote Git process to acknowledge clone cancellation and keeps the channel usable", async () => {
	const reached = Promise.withResolvers<void>();

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			reached.resolve();
			await new Promise<void>((resolveRequest) =>
				request.signal.addEventListener("abort", () => resolveRequest(), {
					once: true,
				})
			);

			return new Response("Cancelled", { status: 499 });
		},
	});

	const controller = new AbortController();

	try {
		const result = connection.request(
			{
				operation: "clone",
				path: join(home, "cancelled clone"),
				remoteUrl: `http://127.0.0.1:${server.port}/repo.git`,
			},
			controller.signal
		);

		await Promise.race([
			reached.promise,
			Bun.sleep(5000).then(() => {
				throw new Error("Git did not reach the test remote");
			}),
		]);
		controller.abort();
		const cancelled = await result;

		expect(isRecord(cancelled) && cancelled.ok).toBe(false);
		expect(isRecord(cancelled) && cancelled.message).toContain("cancelled");
		const scan = await connection.request({
			operation: "scan",
			folders: [home],
		});

		expect(isRecord(scan) && Array.isArray(scan.paths)).toBe(true);
	} finally {
		await server.stop(true);
	}
}, 20_000);
