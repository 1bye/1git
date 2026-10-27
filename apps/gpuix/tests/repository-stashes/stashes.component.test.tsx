/**
 * Covers: compact stash totals, lazy reads, automatic previews, keyboard focus, per-tab state, refresh, retries and cancellation.
 * Real: App, reducers, hooks and native GPUIX layout/events.
 * Doubles: Git readers and native folder picker; no live Git or OS dialogs.
 * Requires: patched GPUIX native renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import type { RepositoryStashes } from "../../src/feature/repository-workspace/lib/repository-stashes";
import type { RepositoryDiff } from "../../src/feature/repository-workspace/lib/repository-diff";
import { repositorySnapshot } from "../_shared/repository-snapshot";
import { committedFiles } from "../_shared/history-page";
import { stashList } from "../_shared/stash-list";
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
	const box = root.renderer.getElementBounds(
		element(
			id === "repository-list" || id === "revision-files"
				? `${id}-viewport`
				: id
		).id
	);

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
			throw new Error("Timed out waiting for Stashes.");

		await settle();
	}
};

const readRepository = async () => ({
	ok: true as const,
	value: repositorySnapshot(),
});

const readStashes: typeof RepositoryStashes.read = async () => ({
	ok: true,
	value: stashList(),
});

const readFiles: typeof RepositoryStashes.readFiles = async (_root, oid) => ({
	ok: true,
	value: committedFiles(oid),
});

const readDiff: typeof RepositoryDiff.read = async (_root, file) => ({
	ok: true,
	value: [
		{
			target: "commit",
			patch: diffPatch(file.path, "const saved = true;"),
			stats: [],
			message: null,
		},
	],
});

const openStashes = async (): Promise<void> => {
	click("open-repository");
	await settle();
	click("view-stashes");
	await settle();
};

it.each(["light", "dark"] as const)(
	"shows a full muted Stashes total without a redundant Saved work row in %s mode",
	async (appearance) => {
		root.render(
			<App
				initialSession={{
					version: 1,
					activeId: "workspace-1",
					appearance,
					tabs: [{ id: "workspace-1", path: null, draft: "" }],
				}}
				readRepository={readRepository}
				readStashes={async () => ({ ok: true, value: stashList(30) })}
				readStashFiles={readFiles}
				readDiff={readDiff}
			/>
		);
		await openStashes();
		await waitFor(() => !!root.renderer.findByTestId("diff-viewport"));
		expect(root.renderer.getAllText()).toContain("(30)");
		expect(root.renderer.findByTestId("repository-heading")).toBeUndefined();
		expect(element("stashes-total").customProps?.["aria-label"]).toBe(
			"30 stashes in repository"
		);
		const totalSize = element("stashes-total").style.fontSize;
		const titleSize = element("repository-view-title").style.fontSize;

		if (typeof totalSize !== "number" || typeof titleSize !== "number")
			throw new Error("Missing numeric Stashes font sizes");

		expect(totalSize).toBeLessThan(titleSize);
		expect(element("stashes-total").style.color).not.toBe(
			element("repository-view-title").style.color
		);
		expect(bounds("repository-list").y).toBe(
			bounds("repository-views").y + bounds("repository-views").height
		);

		if (process.env.GPUIX_STASH_COUNT_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_STASH_COUNT_SCREENSHOT}-${appearance}.png`
			);
	}
);

it("automatically previews fresh and cached stash files without stealing keyboard focus, retaining state per tab", async () => {
	const stashes = stashList(12);

	const list = mock<typeof RepositoryStashes.read>(async () => ({
		ok: true,
		value: stashes,
	}));

	const files = mock(readFiles);
	const diffs = mock(readDiff);

	root.render(
		<App
			initialTabCount={2}
			readRepository={readRepository}
			readStashes={list}
			readStashFiles={files}
			readDiff={diffs}
		/>
	);
	expect(list).not.toHaveBeenCalled();
	await openStashes();
	await waitFor(() =>
		root.renderer.getPaintedText().includes("const saved = true;")
	);
	expect(root.renderer.getAllText()).toContain("(12)");
	expect(element("entry-src/file-0.ts").customProps?.["aria-selected"]).toBe(
		true
	);
	expect(root.renderer.findByTestId("commit-composer")).toBeUndefined();
	expect(root.renderer.getPaintedText()).toContain("const saved = true;");
	expect(
		element(`entry-${stashes[0]?.oid}`).customProps?.["aria-description"]
	).toContain("stash@{0}");
	click(`entry-${stashes[1]?.oid}`);
	await waitFor(() => !!root.renderer.findByTestId("diff-viewport"));
	expect(root.renderer.getFocusedElementId()).toBe(
		element(`entry-${stashes[1]?.oid}`).id
	);
	root.renderer.nativeSimulateKeyDown(
		element(`entry-${stashes[1]?.oid}`).id,
		"up"
	);
	root.renderer.flush();
	await settle();
	expect(element("entry-src/file-0.ts").customProps?.["aria-selected"]).toBe(
		true
	);
	expect(root.renderer.getFocusedElementId()).toBe(
		element(`entry-${stashes[0]?.oid}`).id
	);
	expect(files).toHaveBeenCalledTimes(2);
	click("entry-src/file-1.ts");
	const listBox = bounds("repository-list");
	const fileBox = bounds("revision-files");

	root.renderer.nativeSimulateScrollWheel(
		listBox.x + 30,
		listBox.y + 40,
		0,
		-140
	);
	root.renderer.nativeSimulateScrollWheel(
		fileBox.x + 30,
		fileBox.y + 40,
		0,
		-120
	);
	root.renderer.flush();
	const listScroll = root.renderer.getScrollOffset(
		element("repository-list").id
	)?.[1];

	const fileScroll = root.renderer.getScrollOffset(
		element("revision-files").id
	)?.[1];

	click("workspace-2");
	click("workspace-1");
	await settle();
	expect(element("entry-src/file-1.ts").customProps?.["aria-selected"]).toBe(
		true
	);
	expect(
		root.renderer.getScrollOffset(element("repository-list").id)?.[1]
	).toBe(listScroll);
	expect(root.renderer.getScrollOffset(element("revision-files").id)?.[1]).toBe(
		fileScroll
	);
	expect(list).toHaveBeenCalledTimes(1);
	expect(root.renderer.getAllText()).toContain("(12)");
	expect(files).toHaveBeenCalledTimes(2);
	expect(diffs.mock.calls.at(-1)?.[1]).toEqual(
		committedFiles(stashes[0]?.oid ?? "")[1]?.commitFile
	);
});

it("refreshes stashes even when HEAD is unchanged, preserving immutable cached files through renumbering and clearing removed stashes", async () => {
	const stashes = stashList();
	const list = mock(readStashes);
	const files = mock(readFiles);

	root.render(
		<App
			readRepository={readRepository}
			readStashes={list}
			readStashFiles={files}
			readDiff={readDiff}
		/>
	);
	await openStashes();
	await waitFor(() => !!root.renderer.findByTestId("diff-viewport"));
	expect(root.renderer.getAllText()).toContain("(3)");
	click("entry-src/file-1.ts");
	list.mockResolvedValue({
		ok: true,
		value: stashes.map((stash, index) => ({
			...stash,
			reference: `stash@{${index + 1}}`,
		})),
	});
	click("refresh-repository");
	await waitFor(
		() =>
			root.renderer
				.findByTestId(`entry-${stashes[0]?.oid}`)
				?.customProps?.["aria-description"]?.toString()
				.includes("stash@{1}") === true
	);
	await waitFor(() => !!root.renderer.findByTestId("diff-viewport"));
	expect(
		element(`entry-${stashes[0]?.oid}`).customProps?.["aria-description"]
	).toContain("stash@{1}");
	expect(element("entry-src/file-1.ts").customProps?.["aria-selected"]).toBe(
		true
	);
	expect(files).toHaveBeenCalledTimes(1);
	expect(root.renderer.getAllText()).toContain("(3)");
	list.mockResolvedValue({ ok: true, value: stashes.slice(0, 1) });
	click("refresh-repository");
	await waitFor(() => root.renderer.getAllText().includes("(1)"));
	expect(element("stashes-total").customProps?.["aria-label"]).toBe(
		"1 stash in repository"
	);
	list.mockResolvedValue({ ok: true, value: [] });
	click("refresh-repository");
	await waitFor(() =>
		root.renderer.getAllText().includes("No stashed changes")
	);
	expect(element("comparison-art-empty")).toBeDefined();
	expect(element("empty-list-placeholder")).toBeDefined();
	expect(root.renderer.findByTestId("diff-viewport")).toBeUndefined();
	expect(root.renderer.findByTestId("entry-src/file-1.ts")).toBeUndefined();
	expect(root.renderer.getAllText()).toContain("(0)");
});

it("retries stash and file errors, ignores a late selection result, and handles a stash with no files", async () => {
	const pending =
		Promise.withResolvers<
			Awaited<ReturnType<typeof RepositoryStashes.readFiles>>
		>();

	const list = mock<typeof RepositoryStashes.read>(async () => {
		throw new Error("Stashes unavailable");
	});

	const files = mock<typeof RepositoryStashes.readFiles>(async () => {
		throw new Error("Saved files unavailable");
	});

	root.render(
		<App
			readRepository={readRepository}
			readStashes={list}
			readStashFiles={files}
			readDiff={readDiff}
		/>
	);
	await openStashes();
	await waitFor(() =>
		root.renderer.getAllText().includes("Stashes unavailable")
	);
	expect(root.renderer.getAllText()).toContain("(—)");
	expect(root.renderer.getAllText()).not.toContain("(0)");
	expect(element("stashes-total").customProps?.["aria-description"]).toContain(
		"Refresh to retry"
	);
	list.mockImplementation(readStashes);
	click("load-stashes");
	await waitFor(() =>
		root.renderer.getAllText().includes("Saved files unavailable")
	);
	expect(root.renderer.getAllText()).toContain("(3)");
	files.mockReturnValueOnce(pending.promise);
	click("retry-stashes-files");
	await settle();
	files.mockResolvedValue({ ok: true, value: [] });
	click(`entry-${stashList()[1]?.oid}`);
	await waitFor(() =>
		root.renderer
			.getAllText()
			.some((text) => text.includes("This stash has no file changes"))
	);
	expect(files.mock.calls[1]?.[2].aborted).toBe(true);
	pending.resolve({ ok: true, value: committedFiles("obsolete") });
	await settle();
	expect(root.renderer.findByTestId("entry-src/file-0.ts")).toBeUndefined();
	expect(root.renderer.getAllText()).not.toContain("Saved files unavailable");
});

it("cancels pending reads on tab switches and restarts without accepting obsolete results", async () => {
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryStashes.read>>>();

	const list = mock<typeof RepositoryStashes.read>(() => pending.promise);

	root.render(
		<App
			initialTabCount={2}
			readRepository={readRepository}
			readStashes={list}
			readStashFiles={readFiles}
			readDiff={readDiff}
		/>
	);
	await openStashes();
	expect(root.renderer.getAllText()).toContain("(…)");
	expect(root.renderer.getAllText()).not.toContain("(0)");
	click("workspace-2");
	expect(list.mock.calls[0]?.[1].aborted).toBe(true);
	list.mockResolvedValue({ ok: true, value: [] });
	click("workspace-1");
	await waitFor(() =>
		root.renderer.getAllText().includes("No stashed changes")
	);
	pending.resolve({ ok: true, value: stashList() });
	await settle();
	expect(
		root.renderer.findByTestId(`entry-${stashList()[0]?.oid}`)
	).toBeUndefined();
	expect(root.renderer.getAllText()).toContain("(0)");
});
