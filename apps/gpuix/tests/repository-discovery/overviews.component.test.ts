/**
 * Covers: bounded visible reads, cache freshness, cancellation, open-tab reuse and unavailable repositories.
 * Real: Home overview queue and workspace/snapshot projections.
 * Doubles: repository reader and clock; no filesystem, SSH or hosting requests.
 * Requires: none.
 */
import { expect, it, mock } from "bun:test";
import type { GitResult, RepositorySnapshot } from "@1git/git";
import { RepositoryOverviews } from "../../src/feature/repository-discovery/repository-overviews";
import { RepositoryWorkspaceModel } from "../../src/feature/repository-workspace/lib/repository-workspace-model";
import type { RepositoryReader } from "../../src/feature/repository-workspace/lib/repository-reader";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";

const settle = async () => {
	for (let step = 0; step < 5; step++) await Bun.sleep(0);
};

it("projects changed paths once, distinguishes missing upstreams and names detached/unborn HEADs", () => {
	const snapshot = repositorySnapshot([
		changedFile("a", { indexStatus: "modified" }),
		changedFile("b", { recordType: "untracked" }),
		changedFile("b", { indexStatus: "deleted" }),
		changedFile("ignored", { recordType: "ignored" }),
	]);

	expect(RepositoryOverviews.fromSnapshot(snapshot)).toEqual({
		branch: "main",
		changes: 2,
		ahead: null,
		behind: null,
	});
	expect(
		RepositoryOverviews.fromSnapshot({
			...snapshot,
			head: { ...snapshot.head, upstream: "origin/main", ahead: 4, behind: 2 },
		})
	).toEqual({ branch: "main", changes: 2, ahead: 4, behind: 2 });
	expect(
		RepositoryOverviews.fromSnapshot({
			...snapshot,
			head: { ...snapshot.head, detached: true, branch: null },
		}).branch
	).toBe("detached 1234567");
	expect(
		RepositoryOverviews.fromSnapshot({
			...snapshot,
			head: { ...snapshot.head, unborn: true, oid: null, branch: "new" },
		}).branch
	).toBe("new");
});

it("keeps the count stable when a repository with a recreated staged deletion is opened", async () => {
	const snapshot = repositorySnapshot([
		changedFile("recreated.txt", { indexStatus: "deleted" }),
		changedFile("recreated.txt", { recordType: "untracked" }),
	]);

	const service = new RepositoryOverviews(
		async () => ({ ok: true, value: snapshot }),
		() => true
	);

	service.setVisible([snapshot.repository.root]);
	await settle();
	expect(service.read(snapshot.repository.root)).toMatchObject({
		status: "ready",
		value: { changes: 1 },
	});
	service.setOpen([
		RepositoryWorkspaceModel.reduce(RepositoryWorkspaceModel.create(), {
			type: "loaded",
			snapshot,
		}),
	]);
	expect(service.read(snapshot.repository.root)).toMatchObject({
		status: "ready",
		value: { changes: 1 },
	});
	service.dispose();
});

it("limits concurrent reads, cancels offscreen work and ignores late completions after leaving Home", async () => {
	const pending = new Map<
		string,
		(value: GitResult<RepositorySnapshot>) => void
	>();

	const reader = mock<typeof RepositoryReader.read>(
		(path) =>
			new Promise((resolve) => {
				pending.set(path, resolve);
			})
	);

	const service = new RepositoryOverviews(reader, () => true);

	service.setVisible(["/a", "/b", "/c"]);
	service.refresh();
	expect(reader.mock.calls.map(([path]) => path)).toEqual(["/a", "/b"]);
	pending.get("/a")?.({ ok: true, value: repositorySnapshot() });
	await settle();
	expect(reader.mock.calls.map(([path]) => path)).toEqual(["/a", "/b", "/c"]);
	service.setVisible(["/d"]);
	expect(reader.mock.calls[1]?.[1].aborted).toBe(true);
	expect(reader.mock.calls[2]?.[1].aborted).toBe(true);
	pending.get("/b")?.({ ok: true, value: repositorySnapshot() });
	pending.get("/c")?.({ ok: true, value: repositorySnapshot() });
	await settle();
	expect(reader.mock.calls.at(-1)?.[0]).toBe("/d");
	expect(service.read("/b").status).toBe("loading");
	service.dispose();
	expect(reader.mock.calls.at(-1)?.[1].aborted).toBe(true);
	pending.get("/d")?.({ ok: true, value: repositorySnapshot() });
	await settle();
	expect(service.read("/d").status).toBe("loading");
});

it("reuses open workspaces, refreshes closed repositories after expiry and keeps failed reads out of clean state", async () => {
	let now = 0;

	const reader = mock<typeof RepositoryReader.read>(async () => ({
		ok: true,
		value: repositorySnapshot(),
	}));

	const service = new RepositoryOverviews(
		reader,
		() => true,
		() => now
	);

	const snapshot = repositorySnapshot([changedFile("a")]);

	const workspace = RepositoryWorkspaceModel.reduce(
		RepositoryWorkspaceModel.create(),
		{ type: "loaded", snapshot }
	);

	service.setOpen([workspace]);
	service.setVisible([snapshot.repository.root, "/closed"]);
	await settle();
	expect(reader.mock.calls.map(([path]) => path)).toEqual(["/closed"]);
	expect(service.read(snapshot.repository.root)).toMatchObject({
		status: "ready",
		value: { changes: 1 },
	});
	service.setOpen([
		RepositoryWorkspaceModel.reduce(workspace, {
			type: "loaded",
			snapshot: repositorySnapshot(),
		}),
	]);
	expect(service.read(snapshot.repository.root)).toMatchObject({
		status: "ready",
		value: { changes: 0 },
	});
	service.refresh();
	expect(reader).toHaveBeenCalledTimes(1);
	now = 15001;
	reader.mockImplementation(async () => {
		throw new Error("Folder was removed");
	});
	service.refresh();
	await settle();
	expect(reader).toHaveBeenCalledTimes(2);
	expect(service.read("/closed")).toEqual({
		status: "unavailable",
		message: "Folder was removed",
	});
	service.dispose();
});

it("does not connect a disconnected machine and retries visible status after reconnection", async () => {
	let connected = false;

	const reader = mock<typeof RepositoryReader.read>(async () => ({
		ok: true,
		value: repositorySnapshot(),
	}));

	const service = new RepositoryOverviews(reader, () => connected);

	service.setVisible(["/remote"]);
	expect(reader).not.toHaveBeenCalled();
	expect(service.read("/remote")).toEqual({
		status: "unavailable",
		message: "Machine disconnected",
	});
	connected = true;
	service.refresh();
	await settle();
	expect(reader).toHaveBeenCalledTimes(1);
	expect(service.read("/remote").status).toBe("ready");
	service.dispose();
});
