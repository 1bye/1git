/**
 * Covers: history pagination, committed diffs, request cancellation/retries and per-tab navigation state.
 * Real: App, reducers, hooks and native GPUIX layout/events.
 * Doubles: Git readers and folder picker; no live Git or OS dialogs.
 * Requires: patched GPUIX native renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import type { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import type { RepositoryDiff } from "../../src/feature/repository-workspace/lib/repository-diff";
import { repositorySnapshot } from "../_shared/repository-snapshot";
import {
	commitInfo,
	committedFiles,
	historyPage,
} from "../_shared/history-page";
import { diffPatch } from "../_shared/diff-patch";
import { windowOptions } from "../../src/window-options";

let root: TestRoot;

beforeEach(() => {
	root = createTestRoot({
		width: 980,
		height: 640,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	spyOn(root.renderer, "promptForPaths").mockResolvedValue(["/test/project"]);
});
afterEach(() => {
	mock.restore();
	root.unmount();
});
const element = (id: string) => {
	const node = root.renderer.findByTestId(id);

	if (!node) throw new Error(`Missing element: ${id}`);

	return node;
};

const bounds = (id: string) => {
	const box = root.renderer.getElementBounds(element(id).id);

	if (!box) throw new Error(`Missing bounds: ${id}`);

	return box;
};

const click = (id: string): void => {
	const box = bounds(id);

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2
	);
	root.renderer.flush();
};

const settle = async (): Promise<void> => {
	await Bun.sleep(0);
	root.renderer.flush();
};

const waitFor = async (ready: () => boolean): Promise<void> => {
	const deadline = performance.now() + 2000;

	while (!ready()) {
		if (performance.now() > deadline)
			throw new Error("Timed out waiting for History.");

		await settle();
	}
};

const readRepository = async () => ({
	ok: true as const,
	value: repositorySnapshot(),
});

const readFiles: typeof RepositoryHistory.readFiles = async (
	_root,
	commit
) => ({ ok: true, value: committedFiles(commit) });

const readDiff: typeof RepositoryDiff.read = async (_root, file) => ({
	ok: true,
	value: [
		{
			target: "commit",
			patch: diffPatch(file.path, "const committed = true;"),
			stats: [],
			message: null,
		},
	],
});

const openHistory = async (): Promise<void> => {
	click("open-repository");
	await settle();
	click("view-history");
	await settle();
	await settle();
};

it("searches through the native field, ignores late results, and restores history on Escape", async () => {
	const late =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryHistory.read>>>();

	const pages = mock<typeof RepositoryHistory.read>(
		async (_root, _head, _offset, _signal, query) =>
			query === "old"
				? await late.promise
				: { ok: true, value: query ? historyPage(99, 1) : historyPage() }
	);

	root.render(
		<App
			readRepository={readRepository}
			readHistory={pages}
			readCommitFiles={readFiles}
			readDiff={readDiff}
		/>
	);
	await openHistory();
	click(`entry-${commitInfo(2).oid}`);
	root.renderer.nativeSimulateKeyDown(element("view-history").id, "cmd-f");
	root.renderer.flush();
	expect(element("history-filter")).toBeDefined();
	root.renderer.simulateKeystrokes("o l d");
	root.renderer.flush();
	await waitFor(() => pages.mock.calls.some((call) => call[4] === "old"));
	root.renderer.simulateKeystrokes("cmd-a n e w");
	root.renderer.flush();
	await waitFor(
		() => !!root.renderer.findByTestId(`entry-${commitInfo(99).oid}`)
	);
	expect(pages.mock.calls.find((call) => call[4] === "old")?.[3].aborted).toBe(
		true
	);
	late.resolve({ ok: true, value: historyPage(88, 1) });
	await settle();
	expect(
		root.renderer.findByTestId(`entry-${commitInfo(88).oid}`)
	).toBeUndefined();
	root.renderer.nativeSimulateKeyDown(element("history-filter").id, "escape");
	root.renderer.flush();
	await settle();
	expect(root.renderer.findByTestId("history-filter")).toBeUndefined();
	expect(
		element(`entry-${commitInfo(2).oid}`).customProps?.["aria-selected"]
	).toBe(true);
});

it("loads commits lazily, pages near the scroll end, and preserves selection and both scroll offsets per tab", async () => {
	const pages = mock<typeof RepositoryHistory.read>(
		async (_root, _head, offset) => ({
			ok: true,
			value: historyPage(offset, 12, offset === 0),
		})
	);

	const files = mock(readFiles);
	const diffs = mock(readDiff);

	root.render(
		<App
			initialTabCount={2}
			readRepository={readRepository}
			readHistory={pages}
			readCommitFiles={files}
			readDiff={diffs}
		/>
	);
	expect(pages).not.toHaveBeenCalled();
	await openHistory();
	expect(pages).toHaveBeenCalledTimes(1);
	expect(files.mock.calls[0]?.[1]).toBe(commitInfo().oid);
	expect(
		element(`entry-${commitInfo().oid}`).customProps?.["aria-description"]
	).toContain("Test Author");
	click(`entry-${commitInfo(1).oid}`);
	await waitFor(() => !!root.renderer.findByTestId("diff-viewport"));
	expect(element("entry-src/file-0.ts").customProps?.["aria-selected"]).toBe(
		true
	);
	expect(diffs.mock.calls.at(-1)?.[1]).toEqual(
		committedFiles(commitInfo(1).oid)[0]?.commitFile
	);
	expect(root.renderer.getPaintedText()).toContain("const committed = true;");
	expect(element("diff-viewport").customProps?.["aria-label"]).toBe(
		"Committed file diff"
	);
	expect(root.renderer.findByTestId("commit-composer")).toBeUndefined();
	const box = bounds("repository-list");

	root.renderer.nativeSimulateScrollWheel(box.x + 50, box.y + 80, 0, -650);
	root.renderer.flush();
	await settle();
	expect(pages).toHaveBeenCalledTimes(2);
	expect(pages.mock.calls[1]?.[2]).toBe(12);
	expect(pages.mock.calls[1]?.[1]).toBe(pages.mock.calls[0]?.[1]);
	const listScroll = root.renderer.getScrollOffset(
		element("repository-list").id
	)?.[1];

	const fileBox = bounds("revision-files");

	root.renderer.nativeSimulateScrollWheel(
		fileBox.x + 50,
		fileBox.y + 80,
		0,
		-160
	);
	root.renderer.flush();
	const fileScroll = root.renderer.getScrollOffset(
		element("revision-files").id
	)?.[1];

	click("workspace-2");
	click("workspace-1");
	await settle();
	expect(
		root.renderer.getScrollOffset(element("repository-list").id)?.[1]
	).toBe(listScroll);
	expect(root.renderer.getScrollOffset(element("revision-files").id)?.[1]).toBe(
		fileScroll
	);
	expect(
		element(`entry-${commitInfo(1).oid}`).customProps?.["aria-selected"]
	).toBe(true);
	expect(element("entry-src/file-0.ts").customProps?.["aria-selected"]).toBe(
		true
	);
	expect(pages).toHaveBeenCalledTimes(2);
	expect(files).toHaveBeenCalledTimes(2);
});

it("retries failed pages/files without dropping loaded commits and ignores late file results", async () => {
	const pending =
		Promise.withResolvers<
			Awaited<ReturnType<typeof RepositoryHistory.readFiles>>
		>();

	const pages = mock<typeof RepositoryHistory.read>(async () => {
		throw new Error("History unavailable");
	});

	const files = mock<typeof RepositoryHistory.readFiles>(async () => {
		throw new Error("Files unavailable");
	});

	root.render(
		<App
			readRepository={readRepository}
			readHistory={pages}
			readCommitFiles={files}
			readDiff={readDiff}
		/>
	);
	await openHistory();
	expect(root.renderer.getAllText()).toContain("History unavailable");
	pages.mockResolvedValue({ ok: true, value: historyPage() });
	click("load-history");
	await settle();
	await settle();
	expect(root.renderer.getAllText()).toContain("Files unavailable");
	files.mockReturnValueOnce(pending.promise);
	click("retry-history-files");
	await settle();
	files.mockImplementation(readFiles);
	click(`entry-${commitInfo(1).oid}`);
	await settle();
	expect(files.mock.calls[1]?.[2].aborted).toBe(true);
	pending.resolve({
		ok: true,
		value: [{ id: "late", title: "late", status: "M" }],
	});
	await settle();
	expect(root.renderer.findByTestId("entry-late")).toBeUndefined();
	expect(root.renderer.findByTestId("entry-src/file-0.ts")).toBeDefined();
	expect(root.renderer.getAllText()).not.toContain("Files unavailable");
});

it("cancels pending pages when leaving History and restarts cleanly without accepting obsolete data", async () => {
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryHistory.read>>>();

	const pages = mock<typeof RepositoryHistory.read>(() => pending.promise);

	root.render(
		<App
			initialTabCount={2}
			readRepository={readRepository}
			readHistory={pages}
			readCommitFiles={readFiles}
			readDiff={readDiff}
		/>
	);
	await openHistory();
	click("workspace-2");
	expect(pages.mock.calls[0]?.[3].aborted).toBe(true);
	pages.mockResolvedValue({ ok: true, value: historyPage(10) });
	click("workspace-1");
	await settle();
	await settle();
	pending.resolve({ ok: true, value: historyPage() });
	await settle();
	expect(
		root.renderer.findByTestId(`entry-${commitInfo().oid}`)
	).toBeUndefined();
	expect(element(`entry-${commitInfo(10).oid}`)).toBeDefined();
	expect(root.renderer.findByTestId("load-history")).toBeUndefined();
});

it("does not request history for unborn HEAD and refreshes an updated HEAD from page zero", async () => {
	const snapshot = repositorySnapshot();

	const status = mock(async () => ({
		ok: true as const,
		value: {
			...snapshot,
			head: { ...snapshot.head, oid: null as string | null, unborn: true },
		},
	}));

	const pages = mock<typeof RepositoryHistory.read>(async () => ({
		ok: true,
		value: historyPage(),
	}));

	root.render(
		<App
			readRepository={status}
			readHistory={pages}
			readCommitFiles={readFiles}
			readDiff={readDiff}
		/>
	);
	await openHistory();
	expect(pages).not.toHaveBeenCalled();
	expect(root.renderer.getAllText()).toContain("No commits yet");
	expect(element("comparison-art-empty")).toBeDefined();
	expect(element("empty-list-placeholder")).toBeDefined();
	status.mockResolvedValue({ ok: true, value: snapshot });
	click("refresh-repository");
	await settle();
	await settle();
	await waitFor(() => !!root.renderer.findByTestId("entry-src/file-0.ts"));
	expect(pages.mock.calls[0]?.slice(1, 3)).toEqual([
		snapshot.head.oid ?? "",
		0,
	]);
	click("entry-src/file-0.ts");
	await settle();
	status.mockResolvedValue({
		ok: true,
		value: { ...snapshot, head: { ...snapshot.head, oid: "f".repeat(40) } },
	});
	click("refresh-repository");
	await settle();
	await settle();
	expect(pages.mock.calls[1]?.slice(1, 3)).toEqual(["f".repeat(40), 0]);
	await waitFor(() => !!root.renderer.findByTestId("diff-viewport"));
	expect(element("entry-src/file-0.ts").customProps?.["aria-selected"]).toBe(
		true
	);
});

it("previews the first file for pointer, keyboard and cached commit selections without stealing focus", async () => {
	const pages = mock<typeof RepositoryHistory.read>(async () => ({
		ok: true,
		value: historyPage(0, 3),
	}));

	const files = mock<typeof RepositoryHistory.readFiles>(
		async (_root, commit) => ({
			ok: true,
			value: commit === commitInfo(2).oid ? [] : committedFiles(commit),
		})
	);

	const diffs = mock(readDiff);

	root.render(
		<App
			readRepository={readRepository}
			readHistory={pages}
			readCommitFiles={files}
			readDiff={diffs}
		/>
	);
	await openHistory();
	await waitFor(() => !!root.renderer.findByTestId("diff-viewport"));
	click("entry-src/file-1.ts");
	await settle();
	click(`entry-${commitInfo(1).oid}`);
	await waitFor(() => !!root.renderer.findByTestId("diff-viewport"));
	expect(element("entry-src/file-0.ts").customProps?.["aria-selected"]).toBe(
		true
	);
	expect(root.renderer.getFocusedElementId()).toBe(
		element(`entry-${commitInfo(1).oid}`).id
	);

	root.renderer.nativeSimulateKeyDown(
		element(`entry-${commitInfo(1).oid}`).id,
		"up"
	);
	root.renderer.flush();
	await settle();
	expect(element("entry-src/file-0.ts").customProps?.["aria-selected"]).toBe(
		true
	);
	expect(root.renderer.getFocusedElementId()).toBe(
		element(`entry-${commitInfo().oid}`).id
	);
	expect(files).toHaveBeenCalledTimes(2);
	expect(diffs.mock.calls.at(-1)?.[1]).toEqual(
		committedFiles(commitInfo().oid)[0]?.commitFile
	);
	expect(root.renderer.getPaintedText()).toContain("const committed = true;");

	click(`entry-${commitInfo(2).oid}`);
	await waitFor(() =>
		root.renderer.getAllText().includes("No file changes in this revision.")
	);
	expect(root.renderer.findByTestId("diff-viewport")).toBeUndefined();
	expect(root.renderer.findByTestId("entry-src/file-0.ts")).toBeUndefined();
});
