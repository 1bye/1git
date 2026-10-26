/**
 * Covers: picking, loading/errors, refresh, tab lifetimes, keyboard focus and preview-only commits.
 * Real: App, reducers, request lifecycle and native GPUIX layout/events.
 * Doubles: native picker responses, discovery cache and repository reader; no live Git or OS dialog.
 * Requires: patched GPUIX native renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";

import { App } from "../../src/app";
import { RepositoryDiscoveryCache } from "../../src/feature/repository-discovery/repository-discovery-cache";
import type { RepositoryReader } from "../../src/feature/repository-workspace/lib/repository-reader";
import type { RepositoryDiff } from "../../src/feature/repository-workspace/lib/repository-diff";
import { windowOptions } from "../../src/window-options";
import { emptyHistory } from "../_shared/history-page";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";

let root: TestRoot;

const readDiff: typeof RepositoryDiff.read = async () => ({
	ok: true,
	value: [],
});

beforeEach(() => {
	root = createTestRoot({
		width: 980,
		height: 640,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
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

const click = (id: string): void => {
	const box = root.renderer.getElementBounds(element(id).id);

	if (!box) throw new Error(`Missing bounds: ${id}`);

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

it("opens real-status rows and refreshes without staging, clearing drafts or replacing checkbox choices", async () => {
	const snapshot = repositorySnapshot([
		changedFile("src/a.ts"),
		changedFile("src/b.ts"),
	]);

	const reader = mock<typeof RepositoryReader.read>(async () => ({
		ok: true,
		value: snapshot,
	}));

	const picker = spyOn(root.renderer, "promptForPaths").mockResolvedValue([
		"/test/project",
	]);

	root.render(
		<App
			readDiff={readDiff}
			readRepository={reader}
			readHistory={emptyHistory}
			readHistoryCount={async () => ({ ok: true, value: 0 })}
			readTags={async () => ({ ok: true, value: [] })}
			readStashes={async () => ({ ok: true, value: [] })}
		/>
	);
	expect(root.renderer.findByTestId("commit-composer")).toBeUndefined();
	click("open-repository");
	await settle();
	expect(picker).toHaveBeenCalledWith({
		directories: true,
		files: false,
		multiple: false,
		prompt: "Open repository",
	});
	expect(reader.mock.calls[0]?.[0]).toBe("/test/project");
	expect(root.renderer.getAllText()).toContain("project");
	expect(root.renderer.getAllText()).toContain(" / main");
	expect(element("entry-src/a.ts").customProps?.tabIndex).toBe(0);
	click("entry-src/a.ts");
	click("include-src/a.ts");
	click("commit-message");
	root.renderer.simulateKeystrokes("h i");
	root.renderer.flush();
	expect(root.renderer.findByTestId("commit-submit")).toBeDefined();
	reader.mockResolvedValue({
		ok: true,
		value: repositorySnapshot([
			changedFile("src/a.ts"),
			changedFile("src/new.ts"),
		]),
	});
	click("refresh-repository");
	await settle();
	expect(element("include-src/a.ts").customProps?.["aria-checked"]).toBe(true);
	expect(element("include-src/new.ts").customProps?.["aria-checked"]).toBe(
		false
	);
	expect(element("entry-src/a.ts").customProps?.["aria-selected"]).toBe(true);
	expect(element("commit-message").customProps?.value).toBe("hi");
	expect(reader).toHaveBeenCalledTimes(2);
	click("view-history");
	await settle();
	expect(
		element("repository-list-viewport").customProps?.["aria-description"]
	).toBe("No commits yet");
	expect(element("empty-list-placeholder")).toBeDefined();
	expect(root.renderer.getAllText()).not.toContain("Sample data");
	click("view-stashes");
	await settle();
	expect(root.renderer.getAllText()).toContain("No stashed changes");
});

it("handles cancellation, picker failures and invalid repositories with a retry", async () => {
	const cache = new RepositoryDiscoveryCache("/unused/discovery-cache");
	const remember = spyOn(cache, "remember").mockImplementation(() => {});

	const reader = mock<typeof RepositoryReader.read>(async () => ({
		ok: false,
		error: {
			code: "not-a-repository",
			message: "Not a Git repository",
			operation: "open-repository",
			retryable: false,
		},
	}));

	const picker = spyOn(root.renderer, "promptForPaths").mockResolvedValue(null);

	root.render(
		<App readDiff={readDiff} readRepository={reader} discoveryCache={cache} />
	);
	click("open-repository");
	await settle();
	expect(reader).not.toHaveBeenCalled();
	expect(root.renderer.findByTestId("repository-notice")).toBeUndefined();
	picker.mockRejectedValue(new Error("Picker unavailable"));
	click("open-repository");
	await settle();
	expect(root.renderer.getAllText()).toContain("Picker unavailable");
	picker.mockResolvedValue(["/not-git"]);
	click("open-repository");
	await settle();
	expect(root.renderer.getAllText()).toContain("Not a Git repository");
	expect(remember).not.toHaveBeenCalled();
	reader.mockResolvedValue({ ok: true, value: repositorySnapshot() });
	click("open-repository");
	await settle();
	expect(root.renderer.getAllText()).toContain("Working tree clean");
	expect(root.renderer.findByTestId("repository-notice")).toBeUndefined();
	expect(remember).toHaveBeenCalledWith("/test/project");
});

it("shows refresh errors alongside previous data, then repairs focus after a selected file disappears", async () => {
	const reader = mock<typeof RepositoryReader.read>(async () => ({
		ok: true,
		value: repositorySnapshot([changedFile("a.ts")]),
	}));

	spyOn(root.renderer, "promptForPaths").mockResolvedValue(["/test/project"]);
	root.render(<App readDiff={readDiff} readRepository={reader} />);
	click("open-repository");
	await settle();
	click("entry-a.ts");
	reader.mockRejectedValue(new Error("Disk unavailable"));
	click("refresh-repository");
	await settle();
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Previous results shown."
	);
	expect(element("entry-a.ts").customProps?.["aria-selected"]).toBe(true);
	reader.mockResolvedValue({
		ok: true,
		value: repositorySnapshot([changedFile("b.ts")]),
	});
	click("refresh-repository");
	await settle();
	expect(element("entry-b.ts").customProps?.tabIndex).toBe(0);
	expect(root.renderer.findByTestId("diff-header")).toBeUndefined();
	expect(root.renderer.findByTestId("repository-notice")).toBeUndefined();
});

it("keeps pending reads attached to their tab and cancels them on close", async () => {
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryReader.read>>>();

	const reader = mock<typeof RepositoryReader.read>(() => pending.promise);

	spyOn(root.renderer, "promptForPaths").mockResolvedValue(["/test/project"]);
	root.render(
		<App readDiff={readDiff} readRepository={reader} initialTabCount={2} />
	);
	click("open-repository");
	await settle();
	expect(root.renderer.getAllText()).toContain("Opening…");
	expect(element("open-repository").customProps?.tabIndex).toBeUndefined();
	click("workspace-2");
	expect(root.renderer.getAllText()).not.toContain("Reading repository…");
	click("close-workspace-1");
	expect(reader.mock.calls[0]?.[1].aborted).toBe(true);
	pending.resolve({
		ok: true,
		value: repositorySnapshot([changedFile("late.ts")]),
	});
	await settle();
	expect(root.renderer.findByTestId("entry-late.ts")).toBeUndefined();
	expect(root.renderer.getAllText()).toContain("QUICK ACTIONS");
});

it("ignores a picker result after its tab closes and never reads for a removed tab", async () => {
	const pending = Promise.withResolvers<string[] | null>();

	spyOn(root.renderer, "promptForPaths").mockReturnValue(pending.promise);
	const reader = mock<typeof RepositoryReader.read>(async () => ({
		ok: true,
		value: repositorySnapshot(),
	}));

	root.render(<App readDiff={readDiff} readRepository={reader} />);
	click("open-repository");
	click("close-workspace-1");
	click("workspace-home");
	pending.resolve(["/test/project"]);
	await settle();
	expect(reader).not.toHaveBeenCalled();
	expect(root.renderer.getAllText()).toContain("QUICK ACTIONS");
});

it("loads in the background without replacing the active tab and aborts reads on unmount", async () => {
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryReader.read>>>();

	const reader = mock<typeof RepositoryReader.read>(() => pending.promise);

	spyOn(root.renderer, "promptForPaths").mockResolvedValue(["/test/project"]);
	root.render(
		<App readDiff={readDiff} readRepository={reader} initialTabCount={2} />
	);
	click("open-repository");
	await settle();
	click("workspace-2");
	pending.resolve({
		ok: true,
		value: repositorySnapshot([changedFile("background.ts")]),
	});
	await settle();
	expect(root.renderer.findByTestId("entry-background.ts")).toBeUndefined();
	expect(element("workspace-2").customProps?.["aria-selected"]).toBe(true);
	click("workspace-1");
	expect(element("entry-background.ts")).toBeDefined();
	const refresh =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryReader.read>>>();

	reader.mockReturnValue(refresh.promise);
	click("refresh-repository");
	root.render(<div />);
	expect(reader.mock.calls[1]?.[1].aborted).toBe(true);
	refresh.resolve({ ok: true, value: repositorySnapshot() });
	await settle();
	expect(root.renderer.getAllText()).toEqual([]);
});
