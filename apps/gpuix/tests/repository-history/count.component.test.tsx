/**
 * Covers: full branch totals beside History, pagination/search independence, refresh/cancellation, failures and shallow/empty history.
 * Real: App, workspace state, History hook and native GPUIX layout/input.
 * Doubles: Git readers and folder picker; no live Git or OS dialogs.
 * Requires: patched GPUIX renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import type { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import { commitInfo, historyPage } from "../_shared/history-page";
import { repositorySnapshot } from "../_shared/repository-snapshot";

let root: TestRoot;

beforeEach(() => {
	root = createTestRoot({ width: 980, height: 640 });
	root.renderer.clockPause();
	spyOn(root.renderer, "promptForPaths").mockResolvedValue(["/test/project"]);
});

afterEach(() => {
	root.unmount();
	mock.restore();
});

function element(id: string) {
	const node = root.renderer.findByTestId(id);

	if (!node) throw new Error(`Missing element: ${id}`);

	return node;
}

function click(id: string): void {
	const box = root.renderer.getElementBounds(element(id).id);

	if (!box) throw new Error(`Missing bounds: ${id}`);

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2
	);
	root.renderer.flush();
}

async function settle(): Promise<void> {
	await Bun.sleep(0);
	root.renderer.flush();
}

async function openHistory(): Promise<void> {
	click("open-repository");
	await settle();
	click("view-history");
	await settle();
	await settle();
}

function show(
	counts: typeof RepositoryHistory.readCount,
	snapshot = () => repositorySnapshot(),
	pages: typeof RepositoryHistory.read = async (
		_root,
		_head,
		offset,
		_signal,
		query
	) => ({
		ok: true,
		value: query ? historyPage(99, 1) : historyPage(offset, 12, offset === 0),
	}),
	appearance: "light" | "dark" = "light"
): void {
	root.render(
		<App
			initialSession={{
				version: 1,
				activeId: "workspace-1",
				appearance,
				tabs: [
					{ id: "workspace-1", path: null, draft: "" },
					{ id: "workspace-2", path: null, draft: "" },
				],
			}}
			readRepository={async () => ({ ok: true, value: snapshot() })}
			readHistory={pages}
			readHistoryCount={counts}
			readCommitFiles={async () => ({ ok: true, value: [] })}
			readTags={async () => ({ ok: true, value: [] })}
			readLastCommit={async () => ({
				ok: true,
				value: { commit: commitInfo(), undoUnavailableReason: null },
			})}
		/>
	);
}

it("shows the full total without the Recent commits row, independently of pagination, search and tab switches", async () => {
	const pending =
		Promise.withResolvers<
			Awaited<ReturnType<typeof RepositoryHistory.readCount>>
		>();

	const counts = mock<typeof RepositoryHistory.readCount>(
		async () => await pending.promise
	);

	const pages = mock<typeof RepositoryHistory.read>(
		async (_root, _head, offset, _signal, query) => ({
			ok: true,
			value: query ? historyPage(99, 1) : historyPage(offset, 12, offset === 0),
		})
	);

	show(counts, undefined, pages);
	expect(counts).not.toHaveBeenCalled();
	await openHistory();
	expect(root.renderer.getAllText()).toContain("(…)");
	expect(root.renderer.findByTestId("repository-heading")).toBeUndefined();
	expect(root.renderer.getAllText()).not.toContain("Recent commits");
	expect(root.renderer.findByTestId(`entry-${commitInfo().oid}`)).toBeDefined();
	pending.resolve({ ok: true, value: 1234 });
	await settle();
	expect(element("history-total").customProps?.["aria-label"]).toBe(
		"1234 commits in current branch history"
	);
	expect(root.renderer.getAllText()).toContain("(1,234)");
	const box = root.renderer.getElementBounds(
		element("repository-list-viewport").id
	);

	if (!box) throw new Error("Missing history viewport");

	root.renderer.nativeSimulateScrollWheel(box.x + 50, box.y + 80, 0, -650);
	root.renderer.flush();
	await settle();
	expect(pages).toHaveBeenCalledTimes(2);
	expect(root.renderer.getAllText()).toContain("(1,234)");
	expect(counts).toHaveBeenCalledTimes(1);
	click("filter-history");
	root.renderer.simulateKeystrokes("n e e d l e");
	root.renderer.flush();
	await Bun.sleep(300);
	await settle();
	expect(pages.mock.calls.at(-1)?.[4]).toBe("needle");
	expect(root.renderer.getAllText()).toContain("Search results");
	expect(root.renderer.getAllText()).toContain("(1,234)");
	expect(counts).toHaveBeenCalledTimes(1);
	click("workspace-2");
	click("workspace-1");
	await settle();
	expect(root.renderer.getAllText()).toContain("(1,234)");
	expect(counts).toHaveBeenCalledTimes(1);
	root.renderer.nativeSimulateKeyDown(element("history-filter").id, "escape");
	root.renderer.flush();
	await settle();

	if (process.env.GPUIX_HISTORY_COUNT_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_HISTORY_COUNT_SCREENSHOT);
});

it("ignores an obsolete count after HEAD changes and refreshes the total against the new tip", async () => {
	const pending =
		Promise.withResolvers<
			Awaited<ReturnType<typeof RepositoryHistory.readCount>>
		>();

	let head = "a".repeat(40);

	const counts = mock<typeof RepositoryHistory.readCount>(async (_root, tip) =>
		tip === "a".repeat(40) ? await pending.promise : { ok: true, value: 29 }
	);

	show(counts, () => {
		const snapshot = repositorySnapshot();

		return { ...snapshot, head: { ...snapshot.head, oid: head } };
	});
	await openHistory();
	head = "b".repeat(40);
	click("refresh-repository");
	await settle();
	await settle();
	expect(counts.mock.calls[0]?.[2].aborted).toBe(true);
	expect(counts.mock.calls.at(-1)?.[1]).toBe(head);
	expect(root.renderer.getAllText()).toContain("(29)");
	pending.resolve({ ok: true, value: 28 });
	await settle();
	expect(root.renderer.getAllText()).toContain("(29)");
	expect(root.renderer.getAllText()).not.toContain("(28)");
});

it("keeps history usable after a count failure and retries on refresh without showing zero", async () => {
	const counts = mock<typeof RepositoryHistory.readCount>(async () => {
		throw new Error("Count unavailable");
	});

	show(counts);
	await openHistory();
	expect(root.renderer.getAllText()).toContain("(—)");
	expect(root.renderer.getAllText()).not.toContain("(0)");
	expect(element("history-total").customProps?.["aria-description"]).toContain(
		"Refresh"
	);
	expect(root.renderer.findByTestId(`entry-${commitInfo().oid}`)).toBeDefined();
	counts.mockResolvedValue({ ok: true, value: 77 });
	click("refresh-repository");
	await settle();
	await settle();
	expect(root.renderer.getAllText()).toContain("(77)");
	expect(counts).toHaveBeenCalledTimes(2);
});

it("shows zero without a Git count query for an unborn repository", async () => {
	const counts = mock<typeof RepositoryHistory.readCount>(async () => ({
		ok: true,
		value: 100,
	}));

	show(counts, () => {
		const snapshot = repositorySnapshot();

		return { ...snapshot, head: { ...snapshot.head, oid: null, unborn: true } };
	});
	await openHistory();
	expect(root.renderer.getAllText()).toContain("(0)");
	expect(counts).not.toHaveBeenCalled();
});

it("marks a shallow clone's available count as a lower bound", async () => {
	show(
		async () => ({ ok: true, value: 28 }),
		() => {
			const snapshot = repositorySnapshot();

			return {
				...snapshot,
				repository: { ...snapshot.repository, isShallow: true },
			};
		}
	);
	await openHistory();
	expect(root.renderer.getAllText()).toContain("(≥28)");
	expect(element("history-total").customProps?.["aria-label"]).toContain(
		"At least 28"
	);
});

it("keeps the dark-mode total smaller and quieter than the History title", async () => {
	show(async () => ({ ok: true, value: 28 }), undefined, undefined, "dark");
	await openHistory();
	const totalSize = element("history-total").style.fontSize;
	const titleSize = element("repository-view-title").style.fontSize;

	if (typeof totalSize !== "number" || typeof titleSize !== "number")
		throw new Error("Missing numeric History font sizes");

	expect(totalSize).toBeLessThan(titleSize);
	expect(element("history-total").style.color).not.toBe(
		element("repository-view-title").style.color
	);

	if (process.env.GPUIX_HISTORY_COUNT_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_HISTORY_COUNT_SCREENSHOT}-dark.png`
		);
});
