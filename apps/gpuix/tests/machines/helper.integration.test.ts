/**
 * Covers: helper discovery, folder browsing/setup, worktrees, remote reads/diffs/commits, stale-write guards and rejected RPC methods.
 * Real: helper process, JSON protocol, application repository services, Git and isolated working trees.
 * Doubles: SSH channel (requests use the actual helper's stdin/stdout); no saved machines or credentials.
 * Requires: Bun, Git and writable temporary storage.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import {
	spawn,
	execFile,
	type ChildProcessWithoutNullStreams,
} from "node:child_process";
import {
	mkdir,
	mkdtemp,
	writeFile,
	rm,
	realpath,
	symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
	RemoteFrames,
	isRecord,
} from "../../src/feature/machines/remote-protocol";
import { Machines } from "../../src/feature/machines/machines";
import { MachineLocation } from "../../src/feature/machines/machine-location";
import { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import { GitRepository } from "../../src/feature/machines/repository-access";
import { RepositoryFileActions } from "../../src/feature/repository-workspace/lib/repository-file-actions";
import { RepositoryReader } from "../../src/feature/repository-workspace/lib/repository-reader";
import { RepositoryCommit } from "../../src/feature/repository-workspace/lib/repository-commit";
import { RepositoryDiff } from "../../src/feature/repository-workspace/lib/repository-diff";
import { RepositorySetup } from "../../src/feature/repository-workspace/lib/repository-setup";
import { RepositoryWorktrees } from "../../src/feature/workspace-tabs/lib/repository-worktrees";

const execute = promisify(execFile);
let directory: string;
let child: ChildProcessWithoutNullStreams;
let request: (operation: Record<string, unknown>) => Promise<unknown>;
let location: string;

beforeEach(async () => {
	directory = await realpath(
		await mkdtemp(join(tmpdir(), "1git-helper-repo-"))
	);
	const env = {
		...process.env,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
	};

	await execute("git", ["init", "--initial-branch=main", directory], { env });
	await execute("git", ["-C", directory, "config", "user.name", "SSH Test"], {
		env,
	});
	await execute(
		"git",
		["-C", directory, "config", "user.email", "ssh@example.invalid"],
		{ env }
	);
	await execute("git", ["-C", directory, "config", "commit.gpgsign", "false"], {
		env,
	});
	await writeFile(join(directory, "file with spaces.txt"), "base\n");
	await execute("git", ["-C", directory, "add", "."], { env });
	await execute("git", ["-C", directory, "commit", "-m", "Base"], { env });
	await writeFile(
		join(directory, "file with spaces.txt"),
		"updated репозиторій\n"
	);
	await writeFile(join(directory, "leave.txt"), "unrelated\n");
	const helperHome = join(directory, ".git/test-home");

	await mkdir(helperHome);
	child = spawn(
		process.execPath,
		[resolve(import.meta.dir, "../../src/feature/machines/remote-helper.ts")],
		{ env: { ...env, HOME: helperHome }, stdio: "pipe" }
	);
	const ready = Promise.withResolvers<void>();

	const pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void }
	>();

	const frames = new RemoteFrames();
	let nextId = 1;

	child.stdout.on("data", (bytes: Buffer) => {
		for (const frame of frames.push(bytes)) {
			if (!isRecord(frame)) throw new Error("Invalid helper frame");

			if (frame.kind === "hello") ready.resolve();

			if (typeof frame.id !== "number" || frame.kind === "progress") continue;

			const callback = pending.get(frame.id);

			pending.delete(frame.id);

			if (frame.kind === "error")
				callback?.reject(new Error(String(frame.message)));
			else callback?.resolve(frame.value);
		}
	});
	child.on("exit", (code) => {
		if (code) ready.reject(new Error(`Helper exited: ${code}`));

		for (const callback of pending.values())
			callback.reject(new Error("Helper exited"));
	});
	request = async (operation) =>
		await new Promise<unknown>((resolveResult, reject) => {
			const id = nextId++;

			pending.set(id, { resolve: resolveResult, reject });
			child.stdin.write(
				`${JSON.stringify({ ...operation, id, kind: "request" })}\n`
			);
		});
	await ready.promise;
	location = MachineLocation.encode(crypto.randomUUID(), directory);
	spyOn(Machines.shared, "request").mockImplementation(
		async (path, input) =>
			await request({ ...input, path: MachineLocation.display(path) })
	);
});

afterEach(async () => {
	mock.restore();
	child?.stdin.end();
	child?.kill();
	await rm(directory, { recursive: true, force: true });
});

it("opens a remote checkout, renders its diff and commits only the selected files through existing services", async () => {
	const signal = new AbortController().signal;
	const snapshot = await RepositoryReader.read(location, signal);

	expect(snapshot.ok).toBe(true);

	if (!snapshot.ok) throw new Error(snapshot.error.message);

	expect(snapshot.value.repository.root).toBe(location);
	const change = snapshot.value.files.find(
		(file) => file.path === "file with spaces.txt"
	);

	if (!change) throw new Error("Missing changed file");

	const diff = await RepositoryDiff.read(location, change, signal);

	expect(diff.ok).toBe(true);
	expect(JSON.stringify(diff)).toContain("updated репозиторій");
	const committed = await RepositoryCommit.write(location, {
		paths: [change.path],
		message: "Remote commit",
		expectedHead: snapshot.value.head.oid,
		expectedBranch: snapshot.value.head.branch,
	});

	expect(committed.ok).toBe(true);
	const after = await RepositoryReader.read(location, signal);

	expect(after.ok && after.value.files.map((file) => file.path)).toEqual([
		"leave.txt",
	]);
	const last = await execute("git", [
		"-C",
		directory,
		"log",
		"-1",
		"--format=%s",
	]);

	expect(last.stdout.trim()).toBe("Remote commit");

	if (!after.ok || !after.value.head.oid)
		throw new Error("Missing committed snapshot");

	const history = await RepositoryHistory.read(
		location,
		after.value.head.oid,
		0,
		signal
	);

	const footer = await RepositoryCommit.readLast(location, {
		expectedHead: after.value.head.oid,
		expectedBranch: "main",
		signal,
	});

	expect(
		history.ok && history.value.commits.map((commit) => commit.summary)
	).toEqual(["Remote commit", "Base"]);
	expect(footer.ok && footer.value.commit.summary).toBe("Remote commit");
	const opened = await GitRepository.open({ path: location });

	if (!opened.ok) throw new Error(opened.error.message);

	const files = await opened.value.getCommitFiles(after.value.head.oid);

	const comparison = await opened.value.compareBranches("HEAD~1", "HEAD", {
		signal,
	});

	expect(files.ok && files.value.map((file) => file.path)).toEqual([
		"file with spaces.txt",
	]);
	expect(comparison.ok).toBe(true);
});

it("discovers repositories remotely and refuses unlisted methods and stale commit requests", async () => {
	const scan = await request({ operation: "scan", folders: [directory] });

	expect(isRecord(scan) && scan.paths).toEqual([directory]);
	await expect(
		request({
			operation: "call",
			path: directory,
			method: "constructor",
			args: [],
		})
	).rejects.toThrow("Unsupported");
	const result = await RepositoryCommit.write(location, {
		paths: ["file with spaces.txt"],
		message: "Stale",
		expectedHead: "0".repeat(40),
		expectedBranch: "main",
	});

	expect(result.ok).toBe(false);
	const last = await execute("git", [
		"-C",
		directory,
		"log",
		"-1",
		"--format=%s",
	]);

	expect(last.stdout.trim()).toBe("Base");
});

it("clones on the machine, offers existing checkouts, and creates guarded worktrees through application services", async () => {
	const destination = await realpath(
		await mkdtemp(join(tmpdir(), "1git-remote-setup-"))
	);

	const id = MachineLocation.parse(location)!.machineId;
	const remotePath = (path: string) => MachineLocation.encode(id, path);
	const clone = remotePath(join(destination, "clone with spaces"));
	const signal = new AbortController().signal;

	try {
		const result = await RepositorySetup.write(
			{ kind: "clone", path: clone, remoteUrl: directory },
			signal
		);

		expect(result).toEqual({ ok: true, path: clone });
		expect(
			await Bun.file(
				join(destination, "clone with spaces/file with spaces.txt")
			).text()
		).toBe("base\n");
		const repeated = await RepositorySetup.write(
			{ kind: "clone", path: clone, remoteUrl: directory },
			signal
		);

		expect(repeated).toMatchObject({ ok: false, openPath: clone });
		const snapshot = await RepositoryReader.read(clone, signal);

		if (!snapshot.ok) throw new Error(snapshot.error.message);

		const choice = {
			kind: "new" as const,
			branch: "feature/remote",
			expectedHead: snapshot.value.head.oid,
			expectedBranch: snapshot.value.head.branch,
		};

		const path = remotePath(join(destination, "remote worktree"));

		const created = await RepositoryWorktrees.create(clone, {
			...choice,
			path,
		});

		expect(created).toEqual({ ok: true, value: path });
		const worktree = await RepositoryReader.read(path, signal);

		expect(worktree.ok && worktree.value.head.branch).toBe("feature/remote");
		expect(worktree.ok && worktree.value.repository.commonDirectory).toBe(
			snapshot.value.repository.commonDirectory
		);
		expect(await Bun.file(join(directory, "file with spaces.txt")).text()).toBe(
			"updated репозиторій\n"
		);
		const otherMachine = MachineLocation.encode(
			crypto.randomUUID(),
			join(destination, "wrong-machine")
		);

		expect(
			(
				await RepositoryWorktrees.create(clone, {
					...choice,
					path: otherMachine,
				})
			).ok
		).toBe(false);
		const stale = await RepositoryWorktrees.create(clone, {
			...choice,
			branch: "stale",
			path: remotePath(join(destination, "stale")),
			expectedHead: "0".repeat(40),
		});

		expect(stale.ok).toBe(false);
		expect(await Bun.file(join(destination, "stale/.git")).exists()).toBe(
			false
		);
		const occupied = join(destination, "occupied");

		await mkdir(occupied);
		await writeFile(join(occupied, "keep.txt"), "keep\n");
		expect(
			(
				await RepositorySetup.write(
					{ kind: "clone", path: remotePath(occupied), remoteUrl: directory },
					signal
				)
			).ok
		).toBe(false);
		expect(
			(
				await RepositoryWorktrees.create(clone, {
					...choice,
					branch: "occupied",
					path: remotePath(occupied),
				})
			).ok
		).toBe(false);
		expect(await Bun.file(join(occupied, "keep.txt")).text()).toBe("keep\n");
		await expect(
			request({
				operation: "create-worktree",
				path: MachineLocation.display(clone),
				input: { ...choice, path: "relative" },
			})
		).rejects.toThrow("Invalid remote worktree request");
	} finally {
		await rm(destination, { recursive: true, force: true });
	}
});

it("streams large file content without corrupting JSON frames or UTF-8", async () => {
	const content = "текст\n".repeat(150_000);

	await writeFile(join(directory, "large.txt"), content);
	const result = await request({
		operation: "call",
		path: directory,
		method: "getFileContent",
		args: [{ path: "large.txt", source: { kind: "working" } }],
	});

	expect(isRecord(result) && result.ok).toBe(true);
	expect(
		isRecord(result) &&
			isRecord(result.value) &&
			result.value.content === content
	).toBe(true);
});

it("browses remote folders without following child symlinks and initializes the selected destination without overwriting files", async () => {
	const parent = await realpath(
		await mkdtemp(join(tmpdir(), "1git-remote-folders-"))
	);

	const id = MachineLocation.parse(location)!.machineId;
	const at = (path: string) => MachineLocation.encode(id, path);
	const signal = new AbortController().signal;

	try {
		await mkdir(join(parent, "projects"));
		await mkdir(join(parent, ".hidden"));
		await symlink(join(parent, "projects"), join(parent, "alias"));
		await writeFile(join(parent, "file.txt"), "preserved\n");
		const listing = await Machines.shared.listDirectory(
			at(parent),
			false,
			signal
		);

		expect(listing.path).toBe(at(parent));
		expect(listing.entries).toEqual([
			{ name: "projects", path: at(join(parent, "projects")) },
		]);
		expect(
			(
				await Machines.shared.listDirectory(at(parent), true, signal)
			).entries.map((entry) => entry.name)
		).toEqual([".hidden", "projects"]);
		await expect(
			request({ operation: "list-directory", path: "relative", hidden: false })
		).rejects.toThrow("absolute");
		const path = at(join(parent, "new repository"));

		const created = await RepositorySetup.write(
			{ kind: "create", path, branch: "main" },
			signal
		);

		expect(created).toEqual({ ok: true, path });
		const read = await RepositoryReader.read(path, signal);

		expect(read.ok && read.value.head.branch).toBe("main");
		expect(read.ok && read.value.head.unborn).toBe(true);
		expect(
			await RepositorySetup.write(
				{ kind: "create", path, branch: "main" },
				signal
			)
		).toMatchObject({ ok: false, openPath: path });
		expect(await Bun.file(join(parent, "file.txt")).text()).toBe("preserved\n");
		const invalid = await RepositorySetup.write(
			{
				kind: "create",
				path: at(join(parent, "invalid")),
				branch: "bad..branch",
			},
			signal
		);

		expect(invalid.ok).toBe(false);
		expect(await Bun.file(join(parent, "invalid/.git/HEAD")).exists()).toBe(
			false
		);
		await Promise.all(
			Array.from(
				{ length: 505 },
				async (_, index) => await mkdir(join(parent, `folder-${index}`))
			)
		);
		const bounded = await Machines.shared.listDirectory(
			at(parent),
			false,
			signal
		);

		expect(bounded.entries).toHaveLength(500);
		expect(bounded.limited).toBe(true);
	} finally {
		await rm(parent, { recursive: true, force: true });
	}
});

it("stores discard recovery on the remote machine without touching the Mac's recovery directory", async () => {
	const snapshot = await RepositoryReader.read(
		location,
		new AbortController().signal
	);

	if (!snapshot.ok) throw new Error(snapshot.error.message);

	const result = await RepositoryFileActions.discard(location, {
		kind: "discard",
		paths: ["file with spaces.txt"],
		expectedHead: snapshot.value.head.oid,
		expectedBranch: snapshot.value.head.branch,
	});

	expect(result.ok).toBe(true);
	expect(await Bun.file(join(directory, "file with spaces.txt")).text()).toBe(
		"base\n"
	);
	expect(await Bun.file(join(directory, "leave.txt")).text()).toBe(
		"unrelated\n"
	);
	const backup =
		"recoveryDirectory" in result && result.recoveryDirectory
			? MachineLocation.parse(result.recoveryDirectory)
			: null;

	expect(backup?.path.startsWith(join(directory, ".git/test-home"))).toBe(true);
	expect(
		backup && (await Bun.file(join(backup.path, "working.patch")).exists())
	).toBe(true);
});
