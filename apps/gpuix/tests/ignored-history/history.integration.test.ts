/**
 * Covers: opt-in, recursive ignored selections, encrypted chunk reuse, persistent baselines, safe restore, retention and failure preservation.
 * Real: isolated Git repositories, filesystem operations, AES-GCM encryption and the snapshot service.
 * Doubles: in-memory OS credential vault; never reads a user's keys, repositories or preferences.
 * Requires: local Git; all files are temporary and removed after each test.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	mkdtemp,
	mkdir,
	writeFile,
	readFile,
	rm,
	readdir,
	symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	IgnoredHistory,
	defaultIgnoredPreferences,
	type IgnoredRepository,
} from "../../src/feature/ignored-history/ignored-history";
import {
	HistoryStorage,
	historyChunkBytes,
} from "../../src/feature/ignored-history/history-storage";

const exec = promisify(execFile);
let directory: string;
let repository: IgnoredRepository;
let history: IgnoredHistory;
let keys: Map<string, string>;
let reads: number;

const vault = {
	async read(key: string) {
		reads++;

		return keys.get(key) ?? null;
	},
	async write(key: string, value: string) {
		keys.set(key, value);
	},
	async delete(key: string) {
		keys.delete(key);
	},
};

const configure = async (paths = [".env", "private"]) =>
	await history.configure(repository, {
		...defaultIgnoredPreferences,
		enabled: true,
		paths,
	});

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "1git-ignored-history-"));
	const root = join(directory, "repository");

	await mkdir(join(root, "private"), { recursive: true });
	await exec("git", ["init", "--quiet", root]);
	await writeFile(join(root, ".gitignore"), ".env\nprivate/\n");
	await writeFile(join(root, ".env"), "TOKEN=original-secret\nURL=original\n");
	await writeFile(join(root, "private", "first.txt"), "first\n");
	repository = {
		root,
		commonDirectory: join(root, ".git"),
		gitDirectory: join(root, ".git"),
	};
	keys = new Map();
	reads = 0;
	history = new IgnoredHistory(vault, join(directory, "history"));
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

it("stays off without touching the OS vault and captures folders without tracking them in Git", async () => {
	expect((await history.refresh(repository)).preferences.enabled).toBe(false);
	expect(reads).toBe(0);
	const initial = await configure();

	expect(initial.files.map((file) => file.path).toSorted()).toEqual([
		".env",
		"private/first.txt",
	]);
	expect(initial.files.every((file) => !file.changed)).toBe(true);
	expect(keys.size).toBe(1);
	const tracked = await exec("git", ["-C", repository.root, "ls-files"]);

	expect(tracked.stdout).toBe("");

	for (const entry of await readdir(join(directory, "history"), {
		recursive: true,
	})) {
		const path = join(directory, "history", entry);

		if (entry.endsWith(".enc") || /chunks\/[a-f0-9]{64}$/u.test(entry))
			expect(
				(await readFile(path)).includes(Buffer.from("original-secret"))
			).toBe(false);
	}
});

it("keeps pending changes across restart and discovers new and deleted files in a selected folder", async () => {
	await configure();
	await writeFile(
		join(repository.root, ".env"),
		"TOKEN=agent-change\nURL=changed\n"
	);
	await writeFile(join(repository.root, "private", "new.txt"), "new\n");
	await rm(join(repository.root, "private", "first.txt"));
	const current = await new IgnoredHistory(vault, history.directory).refresh(
		repository
	);

	expect(current.files.filter((file) => file.changed)).toHaveLength(3);
	const env = current.files.find((file) => file.path === ".env");

	if (!env?.versions[0]) throw new Error("Missing file history");

	const diff = await history.diff(
		repository,
		".env",
		env.baseline,
		env.versions[0].id
	);

	expect(diff.patch).toContain("-TOKEN=original-secret");
	expect(diff.patch).toContain("+TOKEN=agent-change");
	expect(
		current.files.find((file) => file.path === "private/new.txt")?.baseline
	).toBeNull();
	expect(
		current.files.find((file) => file.path === "private/first.txt")?.versions[0]
			?.deleted
	).toBe(true);
});

it("restores a reviewed version, preserves the replaced contents and supports undo through history", async () => {
	await configure();
	await writeFile(join(repository.root, ".env"), "TOKEN=modified-secret\n");
	const file = (await history.refresh(repository)).files.find(
		(item) => item.path === ".env"
	);

	if (!file?.versions[0] || !file.baseline) throw new Error("Missing baseline");

	const modified = file.versions[0].id;

	const restored = await history.restore(
		repository,
		".env",
		file.baseline,
		modified
	);

	expect(await readFile(join(repository.root, ".env"), "utf8")).toContain(
		"original-secret"
	);
	const after = restored.files.find((item) => item.path === ".env");

	if (!after?.versions[0]) throw new Error("Missing restored version");

	expect(after.changed).toBe(false);
	expect(after.versions.some((item) => item.id === modified)).toBe(true);
	await history.restore(repository, ".env", modified, after.versions[0].id);
	expect(await readFile(join(repository.root, ".env"), "utf8")).toBe(
		"TOKEN=modified-secret\n"
	);
	expect(
		(await readdir(repository.gitDirectory)).filter((name) =>
			name.startsWith(".1git-restore-")
		)
	).toEqual([]);
});

it("restores deleted files and reverses the addition of a newly monitored folder child", async () => {
	await configure();
	await rm(join(repository.root, "private"), { recursive: true });
	const deleted = (await history.refresh(repository)).files.find(
		(item) => item.path === "private/first.txt"
	);

	if (!deleted?.versions[0]) throw new Error("Missing deletion");

	await history.restore(
		repository,
		deleted.path,
		deleted.baseline,
		deleted.versions[0].id
	);
	expect(await readFile(join(repository.root, deleted.path), "utf8")).toBe(
		"first\n"
	);
	await writeFile(join(repository.root, "private", "new.txt"), "added\n");
	const added = (await history.refresh(repository)).files.find(
		(item) => item.path === "private/new.txt"
	);

	if (!added?.versions[0]) throw new Error("Missing new file");

	await history.restore(repository, added.path, null, added.versions[0].id);
	expect(
		await readFile(join(repository.root, added.path)).catch(() => null)
	).toBeNull();
});

it("accepts a reviewed baseline without losing older versions and refuses stale accept or restore", async () => {
	await configure();
	await writeFile(join(repository.root, ".env"), "second\n");
	const file = (await history.refresh(repository)).files.find(
		(item) => item.path === ".env"
	);

	if (!file?.versions[0]) throw new Error("Missing current version");

	await writeFile(join(repository.root, ".env"), "third\n");
	await expect(
		history.accept(repository, file.path, file.versions[0].id)
	).rejects.toThrow("changed");
	await expect(
		history.restore(repository, file.path, file.baseline, file.versions[0].id)
	).rejects.toThrow("changed");
	expect(await readFile(join(repository.root, ".env"), "utf8")).toBe("third\n");
	const current = (await history.refresh(repository)).files.find(
		(item) => item.path === ".env"
	);

	if (!current?.versions[0]) throw new Error("Missing latest");

	await history.accept(repository, current.path, current.versions[0].id);
	const accepted = (await history.refresh(repository)).files.find(
		(item) => item.path === ".env"
	);

	expect(accepted?.changed).toBe(false);
	expect(accepted?.versions.length).toBeGreaterThan(1);
});

it("streams large files and reuses unchanged encrypted chunks", async () => {
	const bytes = Buffer.alloc(historyChunkBytes * 3, 65);

	await writeFile(join(repository.root, "private", "large.bin"), bytes);
	const initial = await configure(["private"]);

	bytes[historyChunkBytes + 1] = 66;
	await writeFile(join(repository.root, "private", "large.bin"), bytes);
	const after = await history.refresh(repository);

	expect(after.bytes - initial.bytes).toBeLessThan(historyChunkBytes + 1024);
	const file = after.files.find((item) => item.path === "private/large.bin");

	if (!file?.versions[0]) throw new Error("Missing binary history");

	expect(
		(
			await history.diff(
				repository,
				file.path,
				file.baseline,
				file.versions[0].id
			)
		).message
	).toContain("Large file");
	await history.restore(
		repository,
		file.path,
		file.baseline,
		file.versions[0].id
	);
	expect(
		(await readFile(join(repository.root, file.path)))[historyChunkBytes + 1]
	).toBe(65);
});

it("retains the baseline while pruning automatic versions", async () => {
	await history.configure(repository, {
		...defaultIgnoredPreferences,
		enabled: true,
		paths: [".env"],
		maxVersions: 2,
	});

	for (let index = 0; index < 5; index++) {
		await writeFile(join(repository.root, ".env"), `revision=${index}\n`);
		await history.refresh(repository);
	}

	const file = (await history.refresh(repository)).files[0];

	expect(file?.versions).toHaveLength(3);
	expect(file?.versions.some((item) => item.id === file.baseline)).toBe(true);
});

it("rejects traversal, tracked paths, links, Git metadata and history inside the checkout", async () => {
	for (const path of [
		"../outside",
		"/absolute",
		".git/config",
		"private/../.env",
		":(glob)*",
		".gitignore",
	])
		await expect(configure([path])).rejects.toThrow();

	await symlink(
		join(directory, "outside"),
		join(repository.root, "private", "link")
	);
	const captured = await configure(["private"]);

	expect(captured.skipped).toContain("private/link");
	await exec("git", ["-C", repository.root, "add", "-f", ".env"]);
	await expect(configure([".env"])).rejects.toThrow("not tracked");
	await expect(
		new IgnoredHistory(
			vault,
			join(repository.root, "private", "history")
		).configure(repository, {
			...defaultIgnoredPreferences,
			enabled: true,
			paths: ["private"],
		})
	).rejects.toThrow("outside");
});

it("refuses restore after a file becomes tracked or its parent becomes a symlink", async () => {
	await configure();
	await writeFile(join(repository.root, "private", "first.txt"), "changed\n");
	const file = (await history.refresh(repository)).files.find(
		(item) => item.path === "private/first.txt"
	);

	if (!file?.versions[0]) throw new Error("Missing version");

	await rm(join(repository.root, "private"), { recursive: true });
	await mkdir(join(directory, "outside"));
	await writeFile(join(directory, "outside", "first.txt"), "outside\n");
	await symlink(join(directory, "outside"), join(repository.root, "private"));
	await expect(
		history.restore(repository, file.path, file.baseline, file.versions[0].id)
	).rejects.toThrow();
	expect(await readFile(join(directory, "outside", "first.txt"), "utf8")).toBe(
		"outside\n"
	);
});

it("preserves existing versions when quota or encryption-key access fails", async () => {
	await history.configure(repository, {
		...defaultIgnoredPreferences,
		enabled: true,
		paths: ["private"],
		budgetBytes: historyChunkBytes,
	});
	await writeFile(
		join(repository.root, "private", "large.bin"),
		Buffer.alloc(historyChunkBytes, 66)
	);
	await expect(history.refresh(repository)).rejects.toThrow("budget");
	await rm(join(repository.root, "private", "large.bin"));
	expect(
		(await history.refresh(repository)).files.some(
			(file) => file.path === "private/first.txt"
		)
	).toBe(true);
	keys.clear();
	await expect(history.refresh(repository)).rejects.toThrow(
		"key is unavailable"
	);
	await expect(configure()).rejects.toThrow("key is unavailable");
	expect(keys.size).toBe(0);
});

it("detects modified encrypted chunks and leaves the working file intact", async () => {
	await configure([".env"]);
	await writeFile(join(repository.root, ".env"), "changed\n");
	const file = (await history.refresh(repository)).files[0];
	const original = file?.versions.find((item) => item.id === file.baseline);

	if (!file?.versions[0] || !original?.chunks[0])
		throw new Error("Missing version");

	const chunkPath = join(
		history.directory,
		HistoryStorage.identity(repository.commonDirectory),
		HistoryStorage.identity(repository.root),
		"chunks",
		original.chunks[0]
	);

	const data = await readFile(chunkPath);

	data[data.length - 1] = (data[data.length - 1] ?? 0) ^ 1;
	await writeFile(chunkPath, data);
	await expect(
		history.restore(repository, file.path, file.baseline, file.versions[0].id)
	).rejects.toThrow("decrypt");
	expect(await readFile(join(repository.root, ".env"), "utf8")).toBe(
		"changed\n"
	);
});

it("shares preferences across worktrees while establishing independent initial baselines", async () => {
	await configure();
	const root = join(directory, "second-worktree");

	await mkdir(root);
	await exec("git", ["init", "--quiet", root]);
	await writeFile(join(root, ".gitignore"), ".env\nprivate/\n");
	await writeFile(join(root, ".env"), "other-worktree\n");
	const second = {
		root,
		commonDirectory: repository.commonDirectory,
		gitDirectory: join(root, ".git"),
	};

	const initial = await history.refresh(second);

	expect(initial.preferences.enabled).toBe(true);
	expect(initial.files[0]?.changed).toBe(false);
	expect(
		(await history.refresh(repository)).files.find(
			(file) => file.path === ".env"
		)?.versions[0]?.id
	).not.toBe(initial.files[0]?.versions[0]?.id);
});

it("disables capture without deleting history and re-enables against the original baseline", async () => {
	await configure();
	await history.configure(repository, {
		...defaultIgnoredPreferences,
		paths: [".env", "private"],
	});
	await writeFile(join(repository.root, ".env"), "changed while disabled\n");
	expect((await history.refresh(repository)).files).toEqual([]);
	const result = await configure();

	expect(result.files.find((file) => file.path === ".env")?.changed).toBe(true);
});

it("indexes a folder of 1,000 files and leaves unchanged snapshots untouched", async () => {
	for (let start = 0; start < 1000; start += 50) {
		await Promise.all(
			Array.from({ length: 50 }, (_, offset) =>
				writeFile(
					join(repository.root, "private", `config-${start + offset}.txt`),
					`value=${start + offset}\n`
				)
			)
		);
	}

	const captured = await configure(["private"]);

	expect(captured.files).toHaveLength(1001);
	const path = join(
		history.directory,
		HistoryStorage.identity(repository.commonDirectory),
		HistoryStorage.identity(repository.root),
		"history.enc"
	);

	const encryptedBefore = await readFile(path);

	await history.refresh(repository);
	expect(await readFile(path)).toEqual(encryptedBefore);
	await writeFile(
		join(repository.root, "private", "config-500.txt"),
		"updated\n"
	);
	const refreshed = await history.refresh(repository);

	expect(
		refreshed.files.filter((file) => file.changed).map((file) => file.path)
	).toEqual(["private/config-500.txt"]);
});

it("keeps protected names such as __proto__ as ordinary files", async () => {
	await writeFile(join(repository.root, "private", "__proto__"), "original\n");
	await configure(["private"]);
	await writeFile(join(repository.root, "private", "__proto__"), "changed\n");
	expect(
		(await history.refresh(repository)).files.find(
			(file) => file.path === "private/__proto__"
		)?.changed
	).toBe(true);
});

it("serializes concurrent capture and diff requests without dropping monitoring", async () => {
	await configure();
	const states = await Promise.all([
		history.refresh(repository),
		history.refresh(repository),
	]);

	expect(states.every((state) => state.files.length === 2)).toBe(true);
});

it("does not replace a lost repository key when enabling history from another worktree", async () => {
	await configure();
	keys.clear();
	const root = join(directory, "unseen-worktree");

	await mkdir(root);
	await exec("git", ["init", "--quiet", root]);
	await writeFile(join(root, ".gitignore"), ".env\n");
	await writeFile(join(root, ".env"), "different\n");
	await expect(
		history.configure(
			{
				root,
				commonDirectory: repository.commonDirectory,
				gitDirectory: join(root, ".git"),
			},
			{ ...defaultIgnoredPreferences, enabled: true, paths: [".env"] }
		)
	).rejects.toThrow("key is unavailable");
	expect(keys.size).toBe(0);
});

it("cancels initial capture without enabling monitoring", async () => {
	const controller = new AbortController();

	controller.abort();
	await expect(
		history.configure(
			repository,
			{ ...defaultIgnoredPreferences, enabled: true, paths: ["private"] },
			controller.signal
		)
	).rejects.toThrow();
	expect((await history.preferences(repository)).enabled).toBe(false);
});

it("shows binary and empty-file changes without misleading text previews", async () => {
	await writeFile(
		join(repository.root, "private", "bytes.bin"),
		Buffer.from([255, 254])
	);
	await configure(["private"]);
	await writeFile(
		join(repository.root, "private", "bytes.bin"),
		Buffer.from([254, 255])
	);
	await writeFile(join(repository.root, "private", "empty.txt"), "");
	const result = await history.refresh(repository);
	const binary = result.files.find((file) => file.path === "private/bytes.bin");
	const empty = result.files.find((file) => file.path === "private/empty.txt");

	if (!binary?.versions[0] || !empty?.versions[0])
		throw new Error("Missing file history");

	expect(
		(
			await history.diff(
				repository,
				binary.path,
				binary.baseline,
				binary.versions[0].id
			)
		).message
	).toContain("Binary file");
	expect(
		(
			await history.diff(
				repository,
				empty.path,
				empty.baseline,
				empty.versions[0].id
			)
		).message
	).toContain("presence changed");
});
