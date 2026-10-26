/**
 * Covers: restored native tabs/drafts, background reads, retry, autosave, quit-save veto, cleanup and preview isolation.
 * Real: App, session/connection hooks, reducers and GPUIX native layout/events.
 * Doubles: repository reads and session save boundary; no user filesystem or live Git.
 * Requires: patched GPUIX renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import type { WorkspaceSessionDocument } from "../../src/feature/workspace-tabs/lib/workspace-session";
import type { RepositoryReader } from "../../src/feature/repository-workspace/lib/repository-reader";
import {
	repositorySnapshot,
	changedFile,
} from "../_shared/repository-snapshot";
import { windowOptions } from "../../src/window-options";
import { AppTermination } from "../../src/app-termination";
import {
	commitInfo,
	committedFiles,
	historyPage,
} from "../_shared/history-page";

let root: TestRoot;

beforeEach(() => {
	root = createTestRoot({
		width: 1100,
		height: 700,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
});
afterEach(() => {
	root.unmount();
});

const session = (): WorkspaceSessionDocument => ({
	version: 1,
	tabs: [
		{ id: "workspace-3", path: "/test/linked", draft: "Linked draft" },
		{ id: "workspace-1", path: "/test/project", draft: "Main draft" },
		{ id: "workspace-2", path: null, draft: "" },
	],
	activeId: "workspace-1",
});

const node = (id: string) => {
	const element = root.renderer.findByTestId(id);

	if (!element) throw new Error(`Missing ${id}`);

	return element;
};

const click = (id: string): void => {
	const bounds = root.renderer.getElementBounds(node(id).id);

	if (!bounds) throw new Error(`Missing bounds for ${id}`);

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	root.renderer.flush();
};

const settle = async (): Promise<void> => {
	await Bun.sleep(0);
	root.renderer.flush();
};

const read: typeof RepositoryReader.read = async (path) => {
	const snapshot = repositorySnapshot([changedFile("fresh.ts")]);

	return {
		ok: true,
		value: {
			...snapshot,
			head: { ...snapshot.head, branch: "fresh-branch" },
			repository: { ...snapshot.repository, root: path },
		},
	};
};

it("restores and saves the file layout across all file panes", async () => {
	const save = mock<(document: WorkspaceSessionDocument) => void>(() => {});

	root.render(
		<App
			initialSession={{
				...session(),
				fileListLayout: "tree",
				onboarding: "complete",
			}}
			readRepository={read}
			saveSession={save}
		/>
	);
	await settle();
	await settle();
	expect(node("changes-file-layout").customProps?.["aria-description"]).toBe(
		"Current layout: Tree view"
	);
	const toggle = root.renderer.getElementBounds(node("changes-file-layout").id);
	const refresh = root.renderer.getElementBounds(node("refresh-repository").id);
	const search = root.renderer.getElementBounds(node("filter-changes").id);

	expect(toggle?.width).toBe(26);
	expect(toggle?.y).toBe(refresh?.y);
	expect(toggle?.y).toBe(search?.y);
	expect((toggle?.x ?? 0) + (toggle?.width ?? 0)).toBeLessThanOrEqual(
		refresh?.x ?? 0
	);
	expect((refresh?.x ?? 0) + (refresh?.width ?? 0)).toBeLessThanOrEqual(
		search?.x ?? 0
	);
	expect(node("repository-list-viewport").customProps?.role).toBe("treegrid");
	click("changes-file-layout");
	await Bun.sleep(250);
	root.renderer.flush();
	expect(save.mock.calls.at(-1)?.[0].fileListLayout).toBe("list");
	click("changes-file-layout");
	await Bun.sleep(250);
	root.renderer.flush();
	expect(save.mock.calls.at(-1)?.[0].fileListLayout).toBe("tree");
});

it("restores History, loads the saved older commit and its selected file before saving navigation", async () => {
	const commit = commitInfo(60).oid;
	const save = mock<(document: WorkspaceSessionDocument) => void>(() => {});

	const pages = mock(async (_root: string, _head: string, offset: number) => ({
		ok: true as const,
		value: historyPage(offset, 50, true),
	}));

	root.render(
		<App
			initialSession={{
				version: 1,
				activeId: "workspace-1",
				tabs: [
					{
						id: "workspace-1",
						path: "/test/project",
						draft: "Keep",
						navigation: {
							view: "history",
							changes: "fresh.ts",
							history: commit,
							historyFile: "src/file-2.ts",
							historyLimit: 150,
							stashes: null,
							stashFile: null,
						},
					},
				],
			}}
			readRepository={read}
			readHistory={pages}
			readCommitFiles={async (_path, oid) => ({
				ok: true,
				value: committedFiles(oid),
			})}
			readDiff={async () => ({ ok: true, value: [] })}
			saveSession={save}
		/>
	);

	for (let attempt = 0; attempt < 20; attempt++) await settle();

	expect(node(`entry-${commit}`).customProps?.["aria-selected"]).toBe(true);
	expect(node("entry-src/file-2.ts").customProps?.["aria-selected"]).toBe(true);
	expect(pages.mock.calls.map((call) => call[2])).toEqual([0, 50]);
	root.unmount();
	expect(save.mock.calls.at(-1)?.[0].tabs[0]?.navigation).toMatchObject({
		view: "history",
		history: commit,
		historyFile: "src/file-2.ts",
		changes: "fresh.ts",
	});
});

it("restores order and the active tab immediately, reads each saved root and keeps drafts when reads complete out of order", async () => {
	const linked = Promise.withResolvers<Awaited<ReturnType<typeof read>>>();
	const main = Promise.withResolvers<Awaited<ReturnType<typeof read>>>();

	const reader = mock<typeof read>((path) =>
		path === "/test/linked" ? linked.promise : main.promise
	);

	const save = mock<(document: WorkspaceSessionDocument) => void>(() => {});

	root.render(
		<App
			initialSession={session()}
			readRepository={reader}
			saveSession={save}
		/>
	);
	await settle();
	expect(node("workspace-1").customProps?.["aria-selected"]).toBe(true);
	expect(node("commit-message").customProps?.value).toBe("Main draft");
	expect(
		root.renderer.getElementBounds(node("workspace-3").id)?.x
	).toBeLessThan(
		root.renderer.getElementBounds(node("workspace-1").id)?.x ?? 0
	);
	expect(reader.mock.calls.map(([path]) => path)).toEqual([
		"/test/linked",
		"/test/project",
	]);
	expect(save).not.toHaveBeenCalled();
	main.resolve(await read("/test/project", new AbortController().signal));
	await settle();
	expect(root.renderer.getAllText()).toContain(" / fresh-branch");
	expect(node("entry-fresh.ts")).toBeTruthy();
	click("workspace-3");
	linked.resolve(await read("/test/linked", new AbortController().signal));
	await settle();
	expect(node("commit-message").customProps?.value).toBe("Linked draft");
	expect(node("workspace-3").customProps?.["aria-selected"]).toBe(true);
	root.render(<div />);
	expect(save.mock.calls.at(-1)?.[0]).toMatchObject({
		...session(),
		activeId: "workspace-3",
	});
});

it("keeps an unavailable repository and editable draft, then retries its saved path without a picker", async () => {
	const reader = mock<typeof read>(async () => ({
		ok: false,
		error: {
			operation: "open-repository",
			code: "not-found",
			message: "Disk unavailable",
			retryable: true,
		},
	}));

	const save = mock<(document: WorkspaceSessionDocument) => void>(() => {});

	const initial = {
		...session(),
		tabs: session().tabs.filter(({ id }) => id === "workspace-1"),
	};

	root.render(
		<App initialSession={initial} readRepository={reader} saveSession={save} />
	);
	await settle();
	expect(root.renderer.getAllText()).toContain("Could not read repository");
	expect(reader).toHaveBeenCalledWith("/test/project", expect.any(AbortSignal));
	expect(node("commit-message").customProps?.value).toBe("Main draft");
	await Bun.sleep(240);
	root.renderer.flush();
	expect(save.mock.calls.at(-1)?.[0].tabs[0]).toMatchObject({
		path: "/test/project",
		draft: "Main draft",
	});
	click("commit-message");
	root.renderer.simulateKeystrokes("cmd-a r e c o v e r e d");
	root.renderer.flush();
	reader.mockImplementation(read);
	click("open-repository");
	await settle();
	expect(reader.mock.calls[1]?.[0]).toBe("/test/project");
	expect(node("commit-message").customProps?.value).toBe("recovered");
	expect(root.renderer.getAllText()).not.toContain("Could not read repository");
	root.render(<div />);
	expect(save.mock.calls.at(-1)?.[0].tabs[0]).toMatchObject({
		path: "/test/project",
		draft: "recovered",
	});
});

it("saves reorder, Home navigation, closure and the latest draft on unmount without waiting for the debounce", async () => {
	const save = mock<(document: WorkspaceSessionDocument) => void>(() => {});

	root.render(
		<App initialSession={session()} readRepository={read} saveSession={save} />
	);
	await settle();
	root.renderer.focusElement(node("workspace-1").id);
	root.renderer.simulateKeystrokes("shift-left");
	root.renderer.flush();
	click("close-workspace-2");
	click("workspace-home");
	click("workspace-1");
	click("commit-message");
	root.renderer.simulateKeystrokes("cmd-a l a s t");
	root.renderer.flush();
	root.render(<div />);
	const saved = save.mock.calls.at(-1)?.[0];

	expect(saved?.tabs.map(({ id }) => id)).toEqual([
		"workspace-1",
		"workspace-3",
	]);
	expect(saved?.activeId).toBe("workspace-1");
	expect(saved?.tabs[0]?.draft).toBe("last");
});

it("flushes the latest draft before AppKit quit without waiting for the debounce", async () => {
	const save = mock<(document: WorkspaceSessionDocument) => void>(() => {});

	root.render(
		<App initialSession={session()} readRepository={read} saveSession={save} />
	);
	await settle();
	click("commit-message");
	root.renderer.simulateKeystrokes("cmd-a l a s t");
	root.renderer.flush();

	expect(AppTermination.canQuit()).toBe(true);
	expect(
		save.mock.calls.at(-1)?.[0].tabs.find(({ id }) => id === "workspace-1")
			?.draft
	).toBe("last");
});

it("vetoes quit when the current draft cannot be saved and allows a retry", async () => {
	let failed = true;

	const save = mock<(document: WorkspaceSessionDocument) => void>(() => {
		if (failed) throw new Error("Disk full");
	});

	root.render(
		<App initialSession={session()} readRepository={read} saveSession={save} />
	);
	await settle();

	expect(AppTermination.canQuit()).toBe(false);
	root.renderer.flush();
	expect(node("commit-message").customProps?.value).toBe("Main draft");
	failed = false;
	expect(AppTermination.canQuit()).toBe(true);
	expect(
		save.mock.calls.at(-1)?.[0].tabs.find(({ id }) => id === "workspace-1")
			?.draft
	).toBe("Main draft");
});

it("cancels restored reads when tabs close or the app unmounts and ignores late results", async () => {
	const pending = Promise.withResolvers<Awaited<ReturnType<typeof read>>>();
	const reader = mock<typeof read>(() => pending.promise);
	const save = mock<(document: WorkspaceSessionDocument) => void>(() => {});

	root.render(
		<App
			initialSession={session()}
			readRepository={reader}
			saveSession={save}
		/>
	);
	await settle();
	click("close-workspace-3");
	expect(reader.mock.calls[0]?.[1].aborted).toBe(true);
	root.render(<div />);
	expect(reader.mock.calls[1]?.[1].aborted).toBe(true);
	pending.resolve(await read("/test/linked", new AbortController().signal));
	await settle();
	expect(root.renderer.getAllText()).toEqual([]);
	expect(save.mock.calls.at(-1)?.[0].tabs.map(({ id }) => id)).toEqual([
		"workspace-1",
		"workspace-2",
	]);
});

it("debounces saving, ignores unrelated view/selection changes and exposes recoverable storage failures", async () => {
	let failed = true;

	const save = mock<(document: WorkspaceSessionDocument) => void>(() => {
		if (failed) throw new Error("Disk full");
	});

	root.render(
		<App initialSession={session()} readRepository={read} saveSession={save} />
	);
	await settle();
	await Bun.sleep(240);
	root.renderer.flush();
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Session not saved. Disk full"
	);
	expect(node("commit-message").customProps?.value).toBe("Main draft");
	failed = false;
	click("retry-session-save");
	expect(root.renderer.findByTestId("session-notice")).toBeUndefined();
	const savedCount = save.mock.calls.length;

	click("include-fresh.ts");
	await Bun.sleep(240);
	expect(save).toHaveBeenCalledTimes(savedCount);
	click("commit-message");
	root.renderer.simulateKeystrokes("cmd-a n e w");
	root.renderer.flush();
	await Bun.sleep(240);
	expect(
		save.mock.calls.at(-1)?.[0].tabs.find(({ id }) => id === "workspace-1")
			?.draft
	).toBe("new");
});

it("leaves sample mode isolated from saved sessions, saves no Git data and removes exit listeners on unmount", async () => {
	const save = mock<(document: WorkspaceSessionDocument) => void>(() => {});
	const reader = mock(read);
	const previous = process.listenerCount("exit");

	root.render(
		<App
			preview
			initialSession={session()}
			saveSession={save}
			readRepository={reader}
		/>
	);
	await settle();
	expect(root.renderer.getAllText()).toContain(
		"Preview only · no repository connected"
	);
	expect(reader).not.toHaveBeenCalled();
	root.render(<div />);
	expect(save).not.toHaveBeenCalled();
	expect(process.listenerCount("exit")).toBe(previous);
});

it("persists the cleared draft after a confirmed commit without replaying the write on restart", async () => {
	const save = mock<(document: WorkspaceSessionDocument) => void>(() => {});

	const write = mock(async () => ({
		ok: true as const,
		value: {
			outcome: "committed" as const,
			oid: "b".repeat(40),
			snapshot: repositorySnapshot(),
			warning: null,
		},
	}));

	root.render(
		<App
			initialSession={session()}
			readRepository={read}
			saveSession={save}
			writeCommit={write}
		/>
	);
	await settle();
	expect(write).not.toHaveBeenCalled();
	click("include-fresh.ts");
	click("commit-submit");
	await settle();
	await settle();
	expect(node("commit-message").customProps?.value).toBe("");
	root.render(<div />);
	const saved = save.mock.calls.at(-1)?.[0];

	expect(saved?.tabs.find(({ id }) => id === "workspace-1")?.draft).toBe("");
	expect(saved?.tabs.find(({ id }) => id === "workspace-3")?.draft).toBe(
		"Linked draft"
	);
	root.render(
		<App initialSession={saved} readRepository={read} writeCommit={write} />
	);
	await settle();
	expect(write).toHaveBeenCalledTimes(1);
	expect(node("commit-message").customProps?.value).toBe("");
});
