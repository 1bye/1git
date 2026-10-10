/**
 * Covers: file-menu scopes, saved revisions, rename diffs, paging/search/back, tab isolation, empty states and stale reads.
 * Real: App, reducers, hooks and native GPUIX input/layout.
 * Doubles: Git readers and AppKit menu selection; no Git, network or OS writes.
 * Requires: patched GPUIX/macOS graphics.
 */
import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import type { ComponentProps } from "react";
import type { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import { App } from "../../src/app";
import { windowOptions } from "../../src/window-options";
import {
	repositorySnapshot,
	changedFile,
} from "../_shared/repository-snapshot";
import {
	commitInfo,
	committedFiles,
	historyPage,
} from "../_shared/history-page";
import { stashList } from "../_shared/stash-list";
import { diffPatch } from "../_shared/diff-patch";

let root: TestRoot;
let labels: string[];

beforeEach(() => {
	root = createTestRoot({
		width: 1100,
		height: 760,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	labels = [];
	Object.assign(root.renderer, {
		showContextMenuItems(items: string[]) {
			labels = items;

			return items.indexOf("View File History");
		},
	});
});
afterEach(() => {
	root.unmount();
	mock.restore();
});

const element = (id: string) => {
	const node = root.renderer.findByTestId(id);

	if (!node) throw new Error(`Missing ${id}`);

	return node;
};

const click = (id: string, button = 0) => {
	const box = root.renderer.getElementBounds(element(id).id);

	if (!box) throw new Error(`Missing bounds ${id}`);

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2,
		button
	);
	root.renderer.flush();
};

const settle = async () => {
	for (let index = 0; index < 5; index += 1) {
		await Bun.sleep(10);
		root.renderer.flush();
	}

	root.renderer.clockFastForward(250);
	root.renderer.flush();
	root.renderer.advanceTime(1);
	root.renderer.flush();
};

const waitFor = async (ready: () => boolean) => {
	const deadline = performance.now() + 2500;

	while (!ready()) {
		if (performance.now() > deadline)
			throw new Error("Timed out waiting for file history");

		await settle();
	}
};

function renderApp(props: ComponentProps<typeof App> = {}) {
	root.render(
		<App
			initialSession={{
				version: 1,
				activeId: "workspace-1",
				tabs: [
					{ id: "workspace-1", path: "/test/project", draft: "Keep draft" },
					{ id: "workspace-2", path: "/test/other", draft: "Other draft" },
				],
			}}
			readRepository={async (path) => ({
				ok: true,
				value: {
					...repositorySnapshot([changedFile("current.ts")]),
					repository: { ...repositorySnapshot().repository, root: path },
				},
			})}
			readHistory={async () => ({ ok: true, value: historyPage(0, 2) })}
			readCommitFiles={async (_path, oid) => ({
				ok: true,
				value: committedFiles(oid, 2),
			})}
			readTags={async () => ({ ok: true, value: [] })}
			readStashes={async () => ({ ok: true, value: stashList(1) })}
			readStashFiles={async (_path, oid) => ({
				ok: true,
				value: committedFiles(oid, 2),
			})}
			readDiff={async (_path, file) => ({
				ok: true,
				value: [
					{
						target: "commit",
						patch: diffPatch(file.path, "const saved = true;"),
						stats: [],
						message: null,
					},
				],
			})}
			readLastCommit={async () => ({
				ok: true,
				value: { commit: commitInfo(), undoUnavailableReason: null },
			})}
			{...props}
		/>
	);
}

it("opens file history from Changes, preloads historical paths, pages/searches within scope and goes back without losing drafts", async () => {
	const pages = mock<typeof RepositoryHistory.read>(
		async (_root, _head, offset, _signal, query, file) => ({
			ok: true,
			value: file
				? {
						commits: Array.from({ length: query ? 1 : 12 }, (_, index) => ({
							...commitInfo(query ? 99 : offset + index),
							historyFile: {
								path: "old-name.ts",
								status: "M",
								beforeOid: "b".repeat(40),
								afterOid: "c".repeat(40),
							},
						})),
						hasMore: !query && offset === 0,
						nextOffset: !query && offset === 0 ? 12 : null,
					}
				: historyPage(0, 2),
		})
	);

	const files = mock<typeof RepositoryHistory.readFiles>(
		async (_path, oid) => ({ ok: true, value: committedFiles(oid, 2) })
	);

	renderApp({ readHistory: pages, readCommitFiles: files });
	await settle();
	click("view-history");
	await settle();
	click(`entry-${commitInfo(1).oid}`);
	await settle();
	const fileReads = files.mock.calls.length;

	click("view-changes");
	click("entry-current.ts", 2);
	await settle();
	expect(labels).toContain("View File History");
	expect(pages.mock.calls.at(-1)?.[5]).toEqual({
		path: "current.ts",
		revision: undefined,
	});
	expect(root.renderer.getAllText()).toContain("File history");
	expect(element("file-history-path")).toBeDefined();
	expect(element("entry-old-name.ts").customProps?.["aria-selected"]).toBe(
		true
	);
	expect(files.mock.calls.length).toBe(fileReads);
	expect(root.renderer.getPaintedText()).toContain("const saved = true;");

	if (process.env.GPUIX_FILE_HISTORY_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_FILE_HISTORY_SCREENSHOT);

	const viewport = root.renderer.getElementBounds(
		element("repository-list-viewport").id
	);

	if (!viewport) throw new Error("Missing history viewport");

	root.renderer.nativeSimulateScrollWheel(
		viewport.x + 50,
		viewport.y + 50,
		0,
		-700
	);
	root.renderer.flush();
	await settle();
	expect(pages.mock.calls.at(-1)?.[2]).toBe(12);
	expect(pages.mock.calls.at(-1)?.[5]?.path).toBe("current.ts");
	click("filter-history");
	root.renderer.simulateKeystrokes("n e e d l e");
	root.renderer.flush();
	await waitFor(
		() => !!root.renderer.findByTestId(`entry-${commitInfo(99).oid}`)
	);
	expect(pages.mock.calls.at(-1)?.[4]).toBe("needle");
	expect(pages.mock.calls.at(-1)?.[5]?.path).toBe("current.ts");
	root.renderer.nativeSimulateKeyDown(element("history-filter").id, "escape");
	root.renderer.flush();
	await settle();
	expect(element("file-history-back")).toBeDefined();
	click("workspace-2");
	await settle();
	expect(root.renderer.findByTestId("file-history-back")).toBeUndefined();
	click("workspace-1");
	await settle();
	click("file-history-back");
	await settle();
	expect(root.renderer.findByTestId("file-history-back")).toBeUndefined();
	expect(
		element(`entry-${commitInfo(1).oid}`).customProps?.["aria-selected"]
	).toBe(true);
	click("view-changes");
	expect(element("commit-message").customProps?.value).toBe("Keep draft");
});

it.each(["history", "stashes"] as const)(
	"starts file history at the saved revision from %s",
	async (view) => {
		const pages = mock<typeof RepositoryHistory.read>(
			async (_root, _head, _offset, _signal, _query, file) => ({
				ok: true,
				value: file ? historyPage(0, 0) : historyPage(0, 1),
			})
		);

		renderApp({ readHistory: pages });
		await settle();
		click(`view-${view}`);
		await settle();
		const row = element("entry-src/file-0.ts");

		root.renderer.nativeSimulateKeyDown(row.id, "shift-f10");
		await settle();
		const revision =
			view === "history" ? commitInfo().oid : stashList(1)[0]?.oid;

		expect(pages.mock.calls.at(-1)?.[5]).toEqual({
			path: "src/file-0.ts",
			revision,
		});
		expect(root.renderer.getAllText()).toContain("No commits for this file");
		expect(element("file-history-back")).toBeDefined();
	}
);

it("cancels file history when going Back and never accepts late scoped results", async () => {
	const late =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryHistory.read>>>();

	const pages = mock<typeof RepositoryHistory.read>(
		async (_root, _head, _offset, _signal, _query, file) =>
			file ? await late.promise : { ok: true, value: historyPage(0, 1) }
	);

	renderApp({ readHistory: pages });
	await settle();
	click("entry-current.ts", 2);
	await settle();
	const pending = pages.mock.calls.at(-1)?.[3];

	expect(pending?.aborted).toBe(false);
	click("file-history-back");
	await settle();
	expect(pending?.aborted).toBe(true);
	late.resolve({ ok: true, value: historyPage(88, 1) });
	await settle();
	expect(
		root.renderer.findByTestId(`entry-${commitInfo(88).oid}`)
	).toBeUndefined();
	expect(element(`entry-${commitInfo().oid}`)).toBeDefined();
});

it("retries a failed file read with the same scope and uses the old path for an uncommitted rename", async () => {
	let fail = true;

	const pages = mock<typeof RepositoryHistory.read>(
		async (_root, _head, _offset, _signal, _query, file) => {
			if (file && fail) throw new Error("File history unavailable");

			return { ok: true, value: historyPage(0, 0) };
		}
	);

	renderApp({
		readHistory: pages,
		readRepository: async (path) => ({
			ok: true,
			value: {
				...repositorySnapshot([
					changedFile("current.ts", {
						originalPath: "previous.ts",
						recordType: "renamed",
						indexStatus: "renamed",
					}),
				]),
				repository: { ...repositorySnapshot().repository, root: path },
			},
		}),
	});
	await settle();
	click("entry-current.ts", 2);
	await settle();
	expect(root.renderer.getAllText()).toContain("File history unavailable");
	expect(pages.mock.calls.at(-1)?.[5]).toEqual({
		path: "previous.ts",
		revision: undefined,
	});
	fail = false;
	click("load-history");
	await settle();
	expect(pages.mock.calls.at(-1)?.[5]?.path).toBe("previous.ts");
	expect(root.renderer.getAllText()).toContain("No commits for this file");
});

it("shows untracked files in an unborn repository as empty without requesting history", async () => {
	const pages = mock<typeof RepositoryHistory.read>(async () => ({
		ok: true,
		value: historyPage(0, 0),
	}));

	renderApp({
		readHistory: pages,
		readRepository: async (path) => ({
			ok: true,
			value: {
				...repositorySnapshot([
					changedFile("current.ts", {
						recordType: "untracked",
						worktreeStatus: "untracked",
					}),
				]),
				head: { ...repositorySnapshot().head, oid: null, unborn: true },
				repository: { ...repositorySnapshot().repository, root: path },
			},
		}),
	});
	await settle();
	click("entry-current.ts", 2);
	await settle();
	expect(pages).not.toHaveBeenCalled();
	expect(root.renderer.getAllText()).toContain("No commits for this file");
});
