/**
 * Covers: scan persistence, replacement, root/machine isolation, removal and damaged or unavailable cache storage.
 * Real: discovery cache and isolated filesystem storage.
 * Doubles: completed scan snapshots; no Git, native renderer, user folders or network.
 * Requires: writable temporary storage.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import {
	mkdtempSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MachineLocation } from "../../src/feature/machines/machine-location";
import {
	RepositoryDiscoveryCache,
	type RepositoryDiscoverySnapshot,
} from "../../src/feature/repository-discovery/repository-discovery-cache";

let directory: string;

const snapshot: RepositoryDiscoverySnapshot = {
	canonicalPath: "/real/work",
	progress: {
		paths: ["/real/work/repo"],
		scanned: 20,
		skipped: 1,
		limited: true,
	},
};

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "1git-discovery-cache-"));
});

afterEach(() => {
	rmSync(directory, { force: true, recursive: true });
});

it("restores and replaces completed scans across cache instances without mixing roots or machines", () => {
	const path = join(directory, "cache");
	const first = new RepositoryDiscoveryCache(path);

	expect(first.read("/home", "/alias/work")).toBeUndefined();
	first.write("/home", "/alias/work", snapshot);
	const restarted = new RepositoryDiscoveryCache(path);

	expect(restarted.read("/home", "/alias/work")).toEqual(snapshot);
	expect(restarted.read("/other-home", "/alias/work")).toBeUndefined();
	expect(restarted.read("/home", "/other-root")).toBeUndefined();
	const empty = {
		canonicalPath: "/real/work",
		progress: { paths: [], scanned: 1, skipped: 0, limited: false },
	};

	restarted.write("/home", "/alias/work", empty);
	expect(
		new RepositoryDiscoveryCache(path).read("/home", "/alias/work")
	).toEqual(empty);
	const files = readdirSync(path);

	expect(files).toHaveLength(1);
	expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/);

	if (process.platform !== "win32") {
		expect(statSync(path).mode & 0o777).toBe(0o700);
		expect(statSync(join(path, files[0]!)).mode & 0o777).toBe(0o600);
	}

	restarted.remove("/home", "/alias/work");
	expect(
		new RepositoryDiscoveryCache(path).read("/home", "/alias/work")
	).toBeUndefined();
});

it("treats corrupt, unsupported, invalid and oversized entries as cache misses", () => {
	const cache = new RepositoryDiscoveryCache(directory);

	cache.write("/home", "/work", snapshot);
	const filename = readdirSync(directory)[0]!;
	const path = join(directory, filename);

	for (const content of [
		"broken json",
		JSON.stringify({ version: 2, ...snapshot }),
		JSON.stringify({ version: 1, ...snapshot, canonicalPath: "relative" }),
		JSON.stringify({
			version: 1,
			...snapshot,
			progress: { ...snapshot.progress, paths: ["/bad\0"] },
		}),
		JSON.stringify({
			version: 1,
			...snapshot,
			progress: { ...snapshot.progress, scanned: -1 },
		}),
		JSON.stringify({
			version: 1,
			...snapshot,
			progress: { ...snapshot.progress, paths: Array(5_001).fill("/repo") },
		}),
		" ".repeat(2 * 1024 * 1024 + 1),
	]) {
		writeFileSync(path, content);
		expect(cache.read("/home", "/work")).toBeUndefined();
	}

	cache.write("/home", "/work", snapshot);
	expect(cache.read("/home", "/work")).toEqual(snapshot);
});

it("keeps cache failures from interrupting discovery or folder removal", () => {
	const path = join(directory, "blocked");

	writeFileSync(path, "regular file");
	const cache = new RepositoryDiscoveryCache(path);

	expect(() => cache.write("/home", "/work", snapshot)).not.toThrow();
	expect(cache.read("/home", "/work")).toBeUndefined();
	expect(() => cache.remove("/home", "/work")).not.toThrow();
});

it("adds confirmed repositories to every matching cached root without changing scan metadata", () => {
	const cache = new RepositoryDiscoveryCache(directory);

	const parent = {
		...snapshot,
		canonicalPath: "/real",
	};

	cache.write("/home", "/alias/work", snapshot);
	cache.write("/home", "/real", parent);
	cache.write("/home", "/real/workspace", {
		...snapshot,
		canonicalPath: "/real/workspace",
	});
	cache.remember("/real/work/new-project");
	cache.remember("/real/work/new-project");
	const restarted = new RepositoryDiscoveryCache(directory);

	for (const root of ["/alias/work", "/real"])
		expect(restarted.read("/home", root)?.progress).toEqual({
			...snapshot.progress,
			paths: [...snapshot.progress.paths, "/real/work/new-project"],
		});

	expect(restarted.read("/home", "/real/workspace")?.progress).toEqual(
		snapshot.progress
	);
});

it("keeps local and remote machine caches separate when including a confirmed path", () => {
	const cache = new RepositoryDiscoveryCache(directory);

	const first = MachineLocation.encode(
		"00000000-0000-4000-8000-000000000001",
		"/"
	);

	const second = MachineLocation.encode(
		"00000000-0000-4000-8000-000000000002",
		"/"
	);

	const progress = { paths: [], scanned: 1, skipped: 0, limited: false };

	for (const root of ["/", first, second])
		cache.write(root, root, { canonicalPath: root, progress });

	cache.remember(`${first}work/project`);
	expect(cache.read(first, first)?.progress.paths).toEqual([
		`${first}work/project`,
	]);
	expect(cache.read(second, second)?.progress.paths).toEqual([]);
	expect(cache.read("/", "/")?.progress.paths).toEqual([]);
});

it("retains the confirmed repository when a cached root has reached its path limit", () => {
	const cache = new RepositoryDiscoveryCache(directory);

	const paths = Array.from(
		{ length: 5_000 },
		(_, index) => `/real/work/project-${index}`
	);

	cache.write("/home", "/alias/work", {
		...snapshot,
		progress: { ...snapshot.progress, paths, limited: false },
	});
	cache.remember("/real/work/new-project");
	const restored = new RepositoryDiscoveryCache(directory).read(
		"/home",
		"/alias/work"
	);

	expect(restored?.progress.paths).toHaveLength(5_000);
	expect(restored?.progress.paths).toContain("/real/work/new-project");
	expect(restored?.progress.limited).toBe(true);
});
