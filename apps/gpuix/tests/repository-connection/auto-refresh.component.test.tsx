/**
 * Covers: automatic/focus refresh, shared root subscriptions, preserved UI state and commit isolation.
 * Real: App, refresh queue, reducers, native event dispatch, diff layout and scrolling.
 * Doubles: filesystem notifications, Git readers/writer, native picker and window activation event.
 * Requires: patched GPUIX renderer and macOS graphics access; no physical window activation.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { handleGpuixEvent } from "@gpuix/react";
import { App } from "../../src/app";
import type { RepositoryReader } from "../../src/feature/repository-workspace/lib/repository-reader";
import type { RepositoryWatcher } from "../../src/feature/repository-workspace/lib/repository-watcher";
import type { RepositoryDiff } from "../../src/feature/repository-workspace/lib/repository-diff";
import type { RepositoryCommit } from "../../src/feature/repository-workspace/lib/repository-commit";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";
import { diffSection } from "../_shared/diff-patch";
import { windowOptions } from "../../src/window-options";
import { committedFiles, historyPage } from "../_shared/history-page";

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
	root.unmount();
	mock.restore();
});

const element = (id: string) => {
	const node = root.renderer.findByTestId(id);

	if (!node) throw new Error(`Missing ${id}`);

	return node;
};

const click = (id: string): void => {
	const bounds = root.renderer.getElementBounds(element(id).id);

	if (!bounds) throw new Error(`Missing bounds for ${id}`);

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	root.renderer.flush();
};

const settle = async (ms = 0): Promise<void> => {
	await Bun.sleep(ms);
	root.renderer.flush();
	await Bun.sleep(0);
	root.renderer.flush();
};

const watched = () => {
	let notify = () => {};
	let reportError = (_message: string) => {};
	const stop = mock();

	const subscribe = mock<typeof RepositoryWatcher.watch>(
		(_repository, onChange, onError) => {
			notify = onChange;
			reportError = onError;

			return stop;
		}
	);

	return {
		subscribe,
		stop,
		notify: () => notify(),
		fail: (message: string) => reportError(message),
	};
};

it("reloads visible History on new HEAD and Stashes on a same-HEAD filesystem update", async () => {
	const watcher = watched();
	const snapshot = repositorySnapshot();

	const reader = mock<typeof RepositoryReader.read>(async () => ({
		ok: true,
		value: snapshot,
	}));

	const history = mock(async () => ({
		ok: true as const,
		value: historyPage(),
	}));

	const stashes = mock(async () => ({ ok: true as const, value: [] }));

	root.render(
		<App
			readRepository={reader}
			readHistory={history}
			readStashes={stashes}
			readCommitFiles={async (_root, commit) => ({
				ok: true,
				value: committedFiles(commit),
			})}
			readDiff={async () => ({ ok: true, value: [] })}
			watchRepository={watcher.subscribe}
		/>
	);
	click("open-repository");
	await settle(350);
	click("view-history");
	await settle();
	expect(history).toHaveBeenCalledTimes(1);
	const head = "b".repeat(40);

	reader.mockResolvedValue({
		ok: true,
		value: { ...snapshot, head: { ...snapshot.head, oid: head } },
	});
	watcher.notify();
	await settle(350);
	expect(history).toHaveBeenCalledTimes(2);
	expect(root.renderer.getAllText()).toContain("file-0.ts");
	click("view-stashes");
	await settle();
	expect(stashes).toHaveBeenCalledTimes(1);
	watcher.notify();
	await settle(350);
	expect(stashes).toHaveBeenCalledTimes(2);
});

it("updates unchanged-status file contents without remounting the scrolled diff or losing draft/choices", async () => {
	const watcher = watched();

	const snapshot = repositorySnapshot([
		changedFile("a.ts"),
		changedFile("b.ts"),
	]);

	const reader = mock<typeof RepositoryReader.read>(async () => ({
		ok: true,
		value: structuredClone(snapshot),
	}));

	const lines = Array.from(
		{ length: 200 },
		(_, index) => `+line ${index}`
	).join("\n");

	const patch = `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1,200 @@\n${lines}\n`;

	const diff = mock<typeof RepositoryDiff.read>(async () => ({
		ok: true,
		value: [diffSection("working", patch)],
	}));

	root.render(
		<App
			readRepository={reader}
			readDiff={diff}
			watchRepository={watcher.subscribe}
		/>
	);
	click("open-repository");
	await settle(350);
	click("entry-a.ts");
	await settle();
	click("include-a.ts");
	click("commit-message");
	root.renderer.simulateKeystrokes("d r a f t");
	root.renderer.flush();
	root.renderer.nativeSimulateKeyDown(element("diff-viewport").id, "pagedown");
	root.renderer.flush();
	const id = element("diff-viewport-content").id;
	const scroll = root.renderer.getScrollOffset(id);

	expect(scroll?.[1]).toBeLessThan(0);
	diff.mockResolvedValue({
		ok: true,
		value: [diffSection("working", patch.replace("line 50", "updated 50"))],
	});
	watcher.notify();
	watcher.notify();
	await settle(350);
	expect(element("diff-viewport-content").id).toBe(id);
	expect(root.renderer.getScrollOffset(id)?.[1]).toBeCloseTo(
		scroll?.[1] ?? 0,
		0
	);
	expect(element("commit-message").customProps?.value).toBe("draft");
	expect(element("include-b.ts").customProps?.["aria-checked"]).toBe(false);
	expect(element("entry-a.ts").customProps?.["aria-selected"]).toBe(true);
	expect(root.renderer.findByTestId("repository-notice")).toBeUndefined();
	// Neighbour preloading may also read b.ts; the selected path still refreshes exactly once.
	expect(
		diff.mock.calls.filter((call) => call[1].path === "a.ts")
	).toHaveLength(2);
	expect(reader).toHaveBeenCalledTimes(3);

	reader.mockResolvedValue({
		ok: true,
		value: repositorySnapshot([changedFile("new.ts")]),
	});
	handleGpuixEvent(
		{
			elementId: 0,
			eventType: "windowActivated",
		},
		root.renderer
	);
	await settle(350);
	expect(root.renderer.findByTestId("entry-a.ts")).toBeUndefined();
	expect(element("entry-new.ts")).toBeDefined();
	expect(element("commit-message").customProps?.value).toBe("draft");
});

it("shares watchers and updates background-tab badges without extra reads, removing subscriptions after the last close", async () => {
	const watcher = watched();

	const reader = mock<typeof RepositoryReader.read>(async () => ({
		ok: true,
		value: repositorySnapshot(),
	}));

	root.render(
		<App
			initialTabCount={2}
			readRepository={reader}
			watchRepository={watcher.subscribe}
		/>
	);
	click("open-repository");
	await settle(350);
	click("workspace-2");
	click("open-repository");
	await settle();
	expect(watcher.subscribe).toHaveBeenCalledTimes(1);
	reader.mockResolvedValue({
		ok: true,
		value: repositorySnapshot([changedFile("a.ts"), changedFile("b.ts")]),
	});
	watcher.notify();
	await settle(350);
	expect(reader).toHaveBeenCalledTimes(4);

	for (const id of ["workspace-1", "workspace-2"]) {
		expect(element(`changed-files-${id}`)).toBeDefined();
		expect(element(id).customProps?.["aria-description"]).toStartWith(
			"2 changed files."
		);
	}

	reader.mockResolvedValue({ ok: true, value: repositorySnapshot() });
	watcher.notify();
	await settle(350);
	expect(reader).toHaveBeenCalledTimes(5);
	expect(
		root.renderer.findByTestId("changed-files-workspace-1")
	).toBeUndefined();
	expect(
		root.renderer.findByTestId("changed-files-workspace-2")
	).toBeUndefined();
	click("close-workspace-1");
	expect(watcher.stop).not.toHaveBeenCalled();
	click("close-workspace-2");
	await settle();
	expect(watcher.stop).toHaveBeenCalledTimes(1);
	watcher.notify();
	handleGpuixEvent(
		{
			elementId: 0,
			eventType: "windowActivated",
		},
		root.renderer
	);
	await settle(350);
	expect(reader).toHaveBeenCalledTimes(5);
});

it("cancels background reads during commits and does not clear uncertain-outcome safeguards", async () => {
	const watcher = watched();
	const snapshot = repositorySnapshot([changedFile("a.ts")]);

	const reader = mock<typeof RepositoryReader.read>(async () => ({
		ok: true,
		value: snapshot,
	}));

	const commit =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryCommit.write>>>();

	const writer = mock<typeof RepositoryCommit.write>(
		async () => await commit.promise
	);

	root.render(
		<App
			readRepository={reader}
			writeCommit={writer}
			watchRepository={watcher.subscribe}
		/>
	);
	click("open-repository");
	await settle(350);
	click("include-a.ts");
	click("commit-message");
	root.renderer.simulateKeystrokes("s a v e");
	root.renderer.flush();
	const background =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryReader.read>>>();

	reader.mockImplementation(async () => await background.promise);
	watcher.notify();
	await settle(350);
	const signal = reader.mock.calls.at(-1)?.[1];

	click("commit-submit");
	expect(signal?.aborted).toBe(true);
	watcher.notify();
	await settle(350);
	expect(reader).toHaveBeenCalledTimes(3);
	background.resolve({
		ok: true,
		value: repositorySnapshot([changedFile("stale.ts")]),
	});
	await settle();
	expect(root.renderer.findByTestId("entry-stale.ts")).toBeUndefined();
	reader.mockResolvedValue({ ok: true, value: snapshot });
	commit.reject(new Error("Outcome unknown"));
	await settle(350);
	expect(reader).toHaveBeenCalledTimes(4);
	expect(element("commit-submit").customProps?.tabIndex).toBeUndefined();
	expect(element("commit-message").customProps?.value).toBe("save");
	expect(root.renderer.getAllText().join(" ")).toContain("Could not confirm");
	watcher.fail("File watching is unavailable. Use Refresh.");
	await settle();
	expect(root.renderer.getAllText().join(" ")).toContain(
		"File watching is unavailable"
	);
});
