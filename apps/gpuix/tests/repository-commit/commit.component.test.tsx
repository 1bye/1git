/**
 * Covers: checked-file commits, hook output/cancellation, last-commit undo/amend, rail Sync controls, duplicate prevention, draft/error retention and refresh.
 * Real: App, reducers, hooks and native GPUIX events/layout.
 * Doubles: Git reads/writes and folder picker; no live repository mutations.
 * Requires: patched GPUIX renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import type { RepositoryCommit } from "../../src/feature/repository-workspace/lib/repository-commit";
import type { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import type { RepositorySync } from "../../src/feature/repository-workspace/lib/repository-sync";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";
import { commitInfo, emptyHistory } from "../_shared/history-page";
import { windowOptions } from "../../src/window-options";
import { diffPatch, diffSection } from "../_shared/diff-patch";

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

const node = (id: string) => {
	const element = root.renderer.findByTestId(id);

	if (!element) throw new Error(`Missing ${id}`);

	return element;
};

const click = (id: string): void => {
	const box = root.renderer.getElementBounds(node(id).id);

	if (!box) throw new Error(`Missing bounds for ${id}`);

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2
	);
	root.renderer.flush();
};

const settle = async (): Promise<void> => {
	for (let index = 0; index < 5; index++) {
		await Bun.sleep(0);
		root.renderer.flush();
	}
};

const message = (keys = "f i x"): void => {
	click("commit-message");
	root.renderer.simulateKeystrokes(keys);
	root.renderer.flush();
};

const snapshot = () =>
	repositorySnapshot([changedFile("a.ts"), changedFile("b.ts")]);

const readRepository = async () => ({ ok: true as const, value: snapshot() });

it.each([false, true])(
	"passes native line inclusion to commit/amend and makes the file checkbox mixed (amend: %s)",
	async (amend) => {
		const patch = diffPatch("a.ts");

		const writeCommit = mock<typeof RepositoryCommit.write>(async () => ({
			ok: true,
			value: {
				outcome: "committed",
				oid: "new-head",
				snapshot: null,
				warning: null,
			},
		}));

		root.render(
			<App
				readRepository={readRepository}
				readLastCommit={async () => lastCommit}
				readDiff={async () => ({
					ok: true,
					value: [diffSection("working", patch)],
				})}
				writeCommit={writeCommit}
			/>
		);
		await open();
		await settle();

		if (amend) {
			click("commit-amend");
			await settle();
		}

		click("entry-a.ts");
		await settle();
		const content = root.renderer.findByTestId("diff-viewport-content");

		if (!content) throw new Error("Missing diff");

		const bounds = root.renderer.getElementBounds(content.id);

		if (!bounds) throw new Error("Missing diff bounds");

		root.renderer.nativeSimulateClick(bounds.x + 27, bounds.y + 26 + 21 + 10);
		await settle();
		expect(node("include-a.ts").customProps?.["aria-checked"]).toBe("mixed");
		click("include-b.ts");

		if (!amend) message();

		click("commit-submit");
		await settle();
		expect(writeCommit).toHaveBeenCalledTimes(1);
		expect(writeCommit.mock.calls[0]?.[1].amend).toBe(amend || undefined);
		expect(writeCommit.mock.calls[0]?.[1].partialFiles).toEqual([
			{ path: "a.ts", expectedPatch: patch, includedLines: ["+:11"] },
		]);
	}
);

const lastCommit: Extract<
	Awaited<ReturnType<typeof RepositoryCommit.readLast>>,
	{ ok: true }
> = {
	ok: true,
	value: {
		undoUnavailableReason: null,
		commit: {
			oid: snapshot().head.oid ?? "",
			summary: "Original",
			body: "Original\n\nDetails",
			parentOids: ["b".repeat(40)],
			author: { name: "Test", email: "test@example.com" },
			committer: { name: "Test", email: "test@example.com" },
			authoredAt: "2026-10-05T10:00:00Z",
			committedAt: "2026-10-05T10:00:00Z",
		},
	},
};

it("pins the last commit below the composer with right-aligned Amend and Undo", async () => {
	const readLast = mock<typeof RepositoryCommit.readLast>(
		async () => lastCommit
	);

	root.render(
		<App readRepository={readRepository} readLastCommit={readLast} />
	);
	await open();
	await settle();
	expect(root.renderer.getAllText().join(" ")).toContain("Committed");
	expect(root.renderer.getAllText()).toContain("Original");
	expect(node("commit-actions").style?.position).toBe("absolute");
	expect(node("commit-amend")).toBeDefined();
	const footer = root.renderer.getElementBounds(node("last-commit-footer").id)!;
	const undo = root.renderer.getElementBounds(node("commit-undo").id)!;

	const summary = root.renderer.getElementBounds(
		node("last-commit-summary").id
	)!;

	const submit = root.renderer.getElementBounds(node("commit-submit").id)!;

	expect(footer.y).toBeGreaterThan(submit.y + submit.height);
	expect(undo.x).toBeGreaterThan(summary.x + summary.width);
	expect(footer.y + footer.height).toBeLessThanOrEqual(640);
	const count = readLast.mock.calls.length;

	message("d r a f t");
	click("include-b.ts");
	expect(readLast.mock.calls.length).toBe(count);
	const screenshot = process.env.GPUIX_UNDO_SCREENSHOT;

	if (screenshot) root.renderer.captureScreenshot(screenshot);
});

it("loads the last commit for amendment without writing, then Cancel restores the ordinary draft and inclusion", async () => {
	const write = mock<typeof RepositoryCommit.write>(async () => ({
		ok: true,
		value: {
			outcome: "committed",
			oid: "new",
			snapshot: snapshot(),
			warning: null,
		},
	}));

	root.render(
		<App
			readRepository={readRepository}
			readLastCommit={async () => lastCommit}
			writeCommit={write}
		/>
	);
	await open();
	await settle();
	message("d r a f t");
	click("include-b.ts");
	root.renderer.nativeSimulateKeyDown(node("commit-amend").id, "enter");
	await settle();

	expect(node("amend-header")).toBeDefined();
	expect(node("commit-message").customProps?.value).toBe("Original\n\nDetails");
	expect(root.renderer.getFocusedElementId()).toBe(node("commit-message").id);
	expect(node("include-b.ts").customProps?.["aria-checked"]).toBe(false);
	expect(write).not.toHaveBeenCalled();
	const label = root.renderer.getElementBounds(node("amend-label").id);

	expect(label?.height).toBe(12);
	const screenshot = process.env.GPUIX_AMEND_SCREENSHOT;

	if (screenshot) root.renderer.captureScreenshot(screenshot);

	click("amend-cancel");
	await settle();
	expect(root.renderer.findByTestId("amend-header")).toBeUndefined();
	expect(node("commit-message").customProps?.value).toBe("draft");
	expect(node("include-b.ts").customProps?.["aria-checked"]).toBe(false);
	expect(root.renderer.getFocusedElementId()).toBe(node("commit-message").id);
});

it("amends only selected changes once, protects closing, and restores the ordinary draft on success", async () => {
	const result =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryCommit.write>>>();

	const write = mock<typeof RepositoryCommit.write>(() => result.promise);

	root.render(
		<App
			readRepository={readRepository}
			readLastCommit={async () => lastCommit}
			writeCommit={write}
		/>
	);
	await open();
	await settle();
	message("d r a f t");
	click("include-b.ts");
	click("commit-amend");
	await settle();
	click("commit-submit");
	click("commit-submit");
	click("amend-cancel");
	root.renderer.nativeSimulateKeyDown(node("commit-message").id, "cmd-w");
	root.renderer.flush();

	expect(write).toHaveBeenCalledTimes(1);
	expect(write.mock.calls[0]?.[1]).toMatchObject({
		amend: true,
		paths: ["a.ts"],
		message: "Original\n\nDetails",
		expectedHead: snapshot().head.oid,
		expectedBranch: "main",
	});
	expect(node("amend-header")).toBeDefined();
	result.resolve({
		ok: true,
		value: {
			outcome: "committed",
			oid: "new-head",
			snapshot: {
				...snapshot(),
				head: { ...snapshot().head, oid: "new-head" },
			},
			warning: null,
		},
	});
	await settle();
	await settle();
	expect(root.renderer.findByTestId("amend-header")).toBeUndefined();
	expect(node("commit-message").customProps?.value).toBe("draft");
});

it("supports message-only amend via Command Enter and retains amend intent after a hook failure", async () => {
	const write = mock<typeof RepositoryCommit.write>(async () => ({
		ok: false,
		error: {
			operation: "commit",
			code: "command-failed",
			message: "Hook rejected",
			retryable: false,
		},
	}));

	root.render(
		<App
			readRepository={async () => ({ ok: true, value: repositorySnapshot() })}
			readLastCommit={async () => lastCommit}
			writeCommit={write}
		/>
	);
	await open();
	await settle();
	click("commit-amend");
	await settle();
	root.renderer.nativeSimulateKeyDown(node("commit-message").id, "cmd-enter");
	await settle();

	expect(write).toHaveBeenCalledTimes(1);
	expect(write.mock.calls[0]?.[1]).toMatchObject({ amend: true, paths: [] });
	expect(node("amend-header")).toBeDefined();
	expect(node("commit-message").customProps?.value).toBe("Original\n\nDetails");
	expect(root.renderer.getAllText().join(" ")).toContain("Hook rejected");
	click("amend-cancel");
	await settle();
	expect(node("commit-message").customProps?.value).toBe("");
});

it("undoes directly once, blocks duplicate writes/closing and restores the old message", async () => {
	const pendingUndo =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryCommit.undo>>>();

	const undo = mock<typeof RepositoryCommit.undo>(() => pendingUndo.promise);

	root.render(
		<App
			readRepository={readRepository}
			readLastCommit={async () => lastCommit}
			undoCommit={undo}
		/>
	);
	await open();
	await settle();
	root.renderer.nativeSimulateKeyDown(node("commit-undo").id, "enter");
	root.renderer.flush();
	click("commit-undo");
	root.renderer.nativeSimulateKeyDown(node("commit-message").id, "cmd-w");
	root.renderer.flush();
	expect(node("commit-message")).toBeDefined();
	expect(undo).toHaveBeenCalledTimes(1);
	expect(undo.mock.calls[0]?.[1]).toEqual({
		expectedHead: snapshot().head.oid ?? "",
		expectedBranch: "main",
	});
	pendingUndo.resolve({
		ok: true,
		value: {
			snapshot: repositorySnapshot([changedFile("undone.ts")]),
			message: "Original\n\nDetails",
			recoveryRef: "refs/1git/undo/test",
			warning: null,
		},
	});
	await settle();
	await settle();
	expect(node("commit-message").customProps?.value).toBe("Original\n\nDetails");
	expect(node("entry-undone.ts")).toBeDefined();
});

it("shows published commit metadata without allowing Undo or Amend and preserves an existing draft", async () => {
	const undo = mock<typeof RepositoryCommit.undo>(async () => ({
		ok: true,
		value: {
			snapshot: repositorySnapshot(),
			message: "Original",
			recoveryRef: "refs/1git/undo/test",
			warning: null,
		},
	}));

	const published = async (): ReturnType<typeof RepositoryCommit.readLast> => ({
		ok: true,
		value: {
			...lastCommit.value,
			undoUnavailableReason: "Already published",
		},
	});

	root.render(
		<App
			readRepository={readRepository}
			readLastCommit={published}
			undoCommit={undo}
		/>
	);
	await open();
	await settle();
	message("d r a f t");
	expect(root.renderer.getAllText()).toContain("Original");
	expect(node("commit-undo").style.opacity).toBe(0.45);
	expect(node("commit-amend").style.opacity).toBe(0.45);
	click("commit-amend");
	expect(root.renderer.findByTestId("amend-header")).toBeUndefined();
	click("commit-undo");
	expect(undo).not.toHaveBeenCalled();
	root.render(
		<App
			readRepository={readRepository}
			readLastCommit={async () => lastCommit}
			undoCommit={undo}
		/>
	);
	await settle();
	click("commit-undo");
	await settle();
	await settle();
	expect(undo).toHaveBeenCalledTimes(1);
	expect(node("commit-message").customProps?.value).toBe("draft");
});

it("opens and refreshes a repository with Command O and R", async () => {
	const read = mock(readRepository);

	root.render(<App readRepository={read} />);
	await settle();
	root.renderer.nativeSimulateKeyDown(node("open-repository").id, "cmd-o");
	await settle();
	expect(root.renderer.promptForPaths).toHaveBeenCalledTimes(1);
	expect(read).toHaveBeenCalled();
	const count = read.mock.calls.length;

	root.renderer.nativeSimulateKeyDown(node("commit-message").id, "cmd-r");
	await settle();
	expect(read.mock.calls.length).toBeGreaterThan(count);
});

it("offers only checked-file commits and never submits with all checkboxes cleared", async () => {
	const partial = repositorySnapshot([
		changedFile("a.ts", { indexStatus: "modified" }),
	]);

	const writeCommit = mock<typeof RepositoryCommit.write>(async () => ({
		ok: true,
		value: {
			outcome: "committed",
			oid: "new",
			snapshot: repositorySnapshot(),
			warning: null,
		},
	}));

	root.render(
		<App
			readRepository={async () => ({ ok: true, value: partial })}
			writeCommit={writeCommit}
		/>
	);
	await open();
	expect(root.renderer.findByTestId("commit-mode-files")).toBeUndefined();
	expect(root.renderer.findByTestId("commit-mode-staged")).toBeUndefined();
	expect(root.renderer.getAllText()).not.toContain("Staged changes");
	click("include-a.ts");
	message();
	click("commit-submit");
	root.renderer.simulateKeystrokes("cmd-enter");
	root.renderer.flush();
	expect(writeCommit).not.toHaveBeenCalled();
	click("include-a.ts");
	const screenshot = process.env.GPUIX_CHECKED_COMMIT_SCREENSHOT;

	if (screenshot) root.renderer.captureScreenshot(screenshot);

	click("commit-submit");
	await settle();
	expect(writeCommit).toHaveBeenCalledTimes(1);
	expect(writeCommit.mock.calls[0]?.[1]).toMatchObject({
		includePartialStaging: true,
		paths: ["a.ts"],
	});
});

const open = async (): Promise<void> => {
	click("open-repository");
	await settle();
	click("include-all");
};

it("keeps the rail Sync separate from the composer and preserves the draft", async () => {
	const base = snapshot();

	const tracked = {
		...base,
		head: { ...base.head, upstream: "origin/main", ahead: 1 },
	};

	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositorySync.write>>>();

	const writeSyncRepository = mock<typeof RepositorySync.write>(
		() => pending.promise
	);

	const read = mock(async () => ({ ok: true as const, value: tracked }));

	root.render(
		<App readRepository={read} writeSyncRepository={writeSyncRepository} />
	);
	await open();
	const composer = root.renderer.getElementBounds(node("commit-composer").id);

	const surface = root.renderer.getElementBounds(
		node("commit-editor-surface").id
	)!;

	const editor = root.renderer.getElementBounds(node("commit-message").id);

	expect(root.renderer.getAllText()).not.toContain("⌘ Enter");
	expect(node("commit-message").style).toMatchObject({
		padding: 8,
		borderWidth: 0,
		height: 1,
	});
	expect(node("commit-message").style?.paddingBottom).toBeUndefined();
	expect(node("commit-message").customProps?.scrollPaddingBottom).toBe(34);
	expect(editor?.x).toBe((composer?.x ?? 0) + 8);
	expect(editor?.y).toBe(surface.y + 8);
	expect(editor?.width).toBe(composer?.width);
	const layoutScreenshot = process.env.GPUIX_COMPOSER_LAYOUT_SCREENSHOT;

	if (layoutScreenshot) root.renderer.captureScreenshot(layoutScreenshot);

	message();
	const sync = root.renderer.getElementBounds(node("rail-sync").id);
	const commit = root.renderer.getElementBounds(node("commit-submit").id);

	expect(sync).toBeDefined();
	expect(commit).toBeDefined();
	expect(sync?.x).toBeLessThan(composer?.x ?? 0);
	expect(sync?.y).toBeLessThan(commit?.y ?? 0);
	expect(commit && commit.x + commit.width).toBe(
		(composer?.x ?? 0) + (composer?.width ?? 0) - 10
	);
	const footer = root.renderer.getElementBounds(node("last-commit-footer").id)!;

	expect(footer.y - (commit!.y + commit!.height)).toBe(10);
	expect(surface.y + surface.height).toBe(footer.y);
	expect(node("commit-actions-fade").style?.pointerEvents).toBe("none");
	expect(node("rail-sync").style?.backgroundColor).not.toBe(
		node("commit-submit").style?.backgroundColor
	);
	const screenshot = process.env.GPUIX_SYNC_SCREENSHOT;

	if (screenshot) root.renderer.captureScreenshot(screenshot);

	click("rail-sync");
	click("rail-sync");
	await settle();
	root.renderer.clockFastForward(250);
	root.renderer.flush();
	expect(writeSyncRepository).toHaveBeenCalledTimes(1);
	expect(writeSyncRepository.mock.calls[0]?.slice(0, 2)).toEqual([
		"/test/project",
		{
			kind: "sync",
			expectedHead: tracked.head.oid ?? "",
			expectedBranch: "main",
		},
	]);
	expect(writeSyncRepository.mock.calls[0]?.[2].aborted).toBe(false);
	click("rail-sync-stop");
	expect(writeSyncRepository.mock.calls[0]?.[2].aborted).toBe(true);
	expect(node("rail-sync").customProps?.["aria-label"]).toContain("Syncing…");
	click("commit-submit");
	expect(node("commit-message").customProps?.value).toBe("fix");
	pending.resolve({
		ok: false,
		error: {
			code: "aborted",
			operation: "fetch",
			message: "Aborted",
			retryable: false,
		},
	});
	await settle();
	await settle();
	expect(read).toHaveBeenCalledTimes(2);
	expect(root.renderer.getAllText().join(" ")).toContain(
		"review status before retrying"
	);
	expect(node("commit-message").customProps?.value).toBe("fix");
});

it("syncs with the keyboard without extra menu reads or submitting checked files", async () => {
	const base = snapshot();

	const tracked = {
		...base,
		head: { ...base.head, upstream: "origin/main", ahead: 1 },
	};

	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositorySync.write>>>();

	const writeSyncRepository = mock<typeof RepositorySync.write>(
		() => pending.promise
	);

	const writeCommit = mock<typeof RepositoryCommit.write>(async () => ({
		ok: false,
		error: {
			code: "command-failed",
			operation: "commit",
			message: "Unexpected commit",
			retryable: false,
		},
	}));

	const readBranches = mock(async () => {
		throw new Error("No menu read is needed");
	});

	root.render(
		<App
			readRepository={async () => ({ ok: true, value: tracked })}
			writeSyncRepository={writeSyncRepository}
			writeCommit={writeCommit}
			readBranches={readBranches}
		/>
	);
	await open();
	message();
	click("include-b.ts");
	root.renderer.nativeSimulateKeyDown(node("rail-sync").id, "enter");
	root.renderer.flush();
	click("commit-submit");
	root.renderer.nativeSimulateKeyDown(node("commit-message").id, "cmd-enter");
	root.renderer.flush();
	expect(writeSyncRepository).toHaveBeenCalledTimes(1);
	expect(writeCommit).not.toHaveBeenCalled();
	expect(readBranches).not.toHaveBeenCalled();
	expect(node("commit-message").customProps?.readOnly).toBe(true);
	pending.resolve({
		ok: true,
		value: {
			operation: "push",
			remote: "origin",
			branch: "main",
			snapshot: tracked,
		},
	});
	await settle();
	await settle();
	expect(node("rail-sync").customProps?.["aria-label"]).toContain(
		"Sync complete"
	);
	expect(node("rail-sync").customProps?.["aria-label"]).toBe(
		"Sync complete — 1 outgoing"
	);
	expect(root.renderer.findByTestId("commit-notice-scroll")).toBeUndefined();
	expect(node("commit-message").customProps?.value).toBe("fix");
	expect(node("include-b.ts").customProps?.["aria-checked"]).toBe(false);
	const screenshot = process.env.GPUIX_SYNC_COMPLETE_SCREENSHOT;

	if (screenshot) root.renderer.captureScreenshot(screenshot);

	await Bun.sleep(3_100);
	root.renderer.flush();
	expect(root.renderer.getAllText()).not.toContain("Sync complete");
	expect(node("rail-sync").customProps?.["aria-label"]).toBe(
		"Push outgoing commits — 1 outgoing"
	);
	click("view-history");
	click("view-changes");
	await settle();
	expect(root.renderer.getAllText()).not.toContain("Sync complete");
});

it("replaces Sync completion with progress on retry and keeps failure details visible", async () => {
	const base = snapshot();

	const tracked = {
		...base,
		head: { ...base.head, upstream: "origin/main", ahead: 1 },
	};

	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositorySync.write>>>();

	const writeSyncRepository = mock<typeof RepositorySync.write>(async () => ({
		ok: true,
		value: {
			operation: "fetch",
			remote: "origin",
			branch: "main",
			snapshot: tracked,
		},
	}));

	root.render(
		<App
			readRepository={async () => ({ ok: true, value: tracked })}
			writeSyncRepository={writeSyncRepository}
		/>
	);
	await open();
	click("rail-sync");
	await settle();
	await settle();
	expect(node("rail-sync").customProps?.["aria-label"]).toContain(
		"Sync complete"
	);
	writeSyncRepository.mockImplementation(() => pending.promise);
	click("rail-sync");
	expect(node("rail-sync").customProps?.["aria-label"]).toContain("Syncing…");
	expect(root.renderer.getAllText()).not.toContain("Sync complete");
	expect(root.renderer.findByTestId("commit-notice-scroll")).toBeUndefined();
	pending.resolve({
		ok: false,
		error: {
			code: "command-failed",
			operation: "fetch",
			message: "Cannot reach upstream.",
			retryable: true,
		},
	});
	await settle();
	await settle();
	expect(writeSyncRepository).toHaveBeenCalledTimes(2);
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Cannot reach upstream."
	);
	expect(root.renderer.getAllText()).not.toContain("Sync complete");
	expect(node("rail-sync").customProps?.["aria-label"]).toBe(
		"Synchronization needs attention — 1 outgoing"
	);
});

it("never synchronizes preview workspaces", async () => {
	const writeSyncRepository = mock<typeof RepositorySync.write>(async () => {
		throw new Error("Previews must not sync");
	});

	root.render(<App preview writeSyncRepository={writeSyncRepository} />);
	expect(root.renderer.findByTestId("rail-sync")).toBeUndefined();
	expect(writeSyncRepository).not.toHaveBeenCalled();
});

it("commits only checked paths once, prevents edits/close while pending, clears the draft after success and refreshes History", async () => {
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryCommit.write>>>();

	const writeCommit = mock<typeof RepositoryCommit.write>(
		() => pending.promise
	);

	const history = mock<typeof RepositoryHistory.read>(emptyHistory);

	root.render(
		<App
			readRepository={readRepository}
			writeCommit={writeCommit}
			readHistory={history}
		/>
	);
	await open();
	expect(root.renderer.getAllText().join(" ")).not.toContain(
		"Whole-file commit · excluded staging is preserved"
	);
	expect(root.renderer.findByTestId("commit-notice-scroll")).toBeUndefined();
	click("include-b.ts");
	message("f i x enter enter d e t a i l s");
	root.renderer.simulateKeystrokes("cmd-enter");
	root.renderer.flush();
	click("commit-submit");
	expect(writeCommit).toHaveBeenCalledTimes(1);
	expect(writeCommit.mock.calls[0]).toEqual([
		"/test/project",
		{
			signal: expect.any(AbortSignal),
			onProgress: expect.any(Function),
			includePartialStaging: true,
			paths: ["a.ts"],
			message: "fix\n\ndetails",
			expectedHead: snapshot().head.oid,
			expectedBranch: "main",
		},
	]);
	expect(root.renderer.getAllText()).toContain("Committing…");
	expect(root.renderer.findByTestId("commit-notice-scroll")).toBeUndefined();
	expect(node("commit-message").customProps?.readOnly).toBe(true);
	root.renderer.nativeSimulateKeyDown(node("commit-message").id, "cmd-w");
	root.renderer.flush();
	expect(node("commit-message")).toBeDefined();
	click("include-b.ts");
	click("close-workspace-1");
	expect(root.renderer.findByTestId("workspace-1")).toBeDefined();
	click("view-history");
	expect(history).not.toHaveBeenCalled();
	const after = repositorySnapshot([changedFile("b.ts")]);

	pending.resolve({
		ok: true,
		value: {
			outcome: "committed",
			oid: "b".repeat(40),
			snapshot: { ...after, head: { ...after.head, oid: "b".repeat(40) } },
			warning: null,
		},
	});
	await settle();
	await settle();
	expect(history.mock.calls[0]?.[1]).toBe("b".repeat(40));
	click("view-changes");
	expect(node("commit-message").customProps?.value).toBe("");
	expect(node("include-b.ts").customProps?.["aria-checked"]).toBe(false);
	expect(root.renderer.findByTestId("entry-a.ts")).toBeUndefined();
	expect(root.renderer.getAllText()).not.toContain("Committed bbbbbbb.");
	expect(root.renderer.findByTestId("commit-notice-scroll")).toBeUndefined();
});

it.each(["light", "dark"] as const)(
	"streams bounded hook output in %s mode, stays responsive and waits for cancellation cleanup before unlocking",
	async (appearance) => {
		const pending =
			Promise.withResolvers<
				Awaited<ReturnType<typeof RepositoryCommit.write>>
			>();

		const writeCommit = mock<typeof RepositoryCommit.write>(
			() => pending.promise
		);

		root.render(
			<App
				initialSession={{ version: 1, tabs: [], activeId: null, appearance }}
				readRepository={readRepository}
				writeCommit={writeCommit}
				readLastCommit={async () => ({
					ok: true,
					value: { commit: commitInfo(), undoUnavailableReason: null },
				})}
			/>
		);
		await open();
		message();
		click("commit-submit");
		const input = writeCommit.mock.calls[0]?.[1];

		expect(input?.signal?.aborted).toBe(false);
		input?.onProgress?.({
			phase: "committing",
			output: "\u001b[32mpre-commit: running checks\u001b[0m\n",
		});
		await Bun.sleep(120);
		await settle();
		expect(root.renderer.getAllText()).toContain(
			"Running hooks and committing…"
		);
		expect(root.renderer.getAllText().join("\n")).toContain(
			"pre-commit: running checks"
		);
		expect(root.renderer.getAllText().join("\n")).not.toContain("\u001b");
		input?.onProgress?.({
			phase: "committing",
			output: "check output\n".repeat(5000),
		});
		await Bun.sleep(120);
		await settle();
		expect(root.renderer.getAllText().join("\n").length).toBeLessThan(36000);
		const screenshot = process.env.GPUIX_COMMIT_HOOK_SCREENSHOT;

		if (screenshot)
			root.renderer.captureScreenshot(
				`${screenshot}-running-${appearance}.png`
			);

		click("commit-cancel");
		expect(input?.signal?.aborted).toBe(true);
		expect(root.renderer.getAllText()).toContain("Stopping Git and hooks…");
		expect(node("commit-message").customProps?.readOnly).toBe(true);
		click("commit-submit");
		click("close-workspace-1");
		expect(writeCommit).toHaveBeenCalledTimes(1);
		expect(node("workspace-1")).toBeDefined();
		pending.resolve({
			ok: false,
			error: {
				code: "aborted",
				message: "Git operation was aborted.",
				operation: "commit",
				retryable: false,
			},
		});
		await settle();
		expect(node("commit-message").customProps?.value).toBe("fix");
		expect(root.renderer.getAllText().join("\n")).toContain(
			"No commit was created"
		);
		expect(root.renderer.findByTestId("commit-cancel")).toBeUndefined();
		expect(
			root.renderer.getElementBounds(node("commit-process").id)?.y
		).toBeLessThan(
			root.renderer.getElementBounds(node("commit-submit").id)?.y ?? 0
		);
		input?.onProgress?.({
			phase: "committing",
			output: "late output must be ignored",
		});
		await Bun.sleep(120);
		await settle();
		expect(root.renderer.getAllText().join("\n")).not.toContain(
			"late output must be ignored"
		);

		if (screenshot)
			root.renderer.captureScreenshot(
				`${screenshot}-cancelled-${appearance}.png`
			);
	}
);

it("retains message and inclusion after hook failures and allows an explicit retry", async () => {
	const writeCommit = mock<typeof RepositoryCommit.write>(async () => ({
		ok: false,
		error: {
			code: "command-failed",
			operation: "commit",
			message: "Commit rejected.",
			details: "pre-commit checks failed",
			retryable: false,
		},
	}));

	root.render(
		<App readRepository={readRepository} writeCommit={writeCommit} />
	);
	await open();
	click("include-b.ts");
	message();
	click("commit-submit");
	await settle();
	expect(node("commit-message").customProps?.value).toBe("fix");
	expect(node("include-b.ts").customProps?.["aria-checked"]).toBe(false);
	expect(root.renderer.getAllText().join(" ")).toContain(
		"pre-commit checks failed"
	);
	click("commit-submit");
	await settle();
	expect(writeCommit).toHaveBeenCalledTimes(2);
});

it("commits complete checked files despite external partial staging, and blocks uncertain outcomes until refresh", async () => {
	const partial = repositorySnapshot([
		changedFile("a.ts", { indexStatus: "modified" }),
		changedFile("b.ts"),
	]);

	const writeCommit = mock<typeof RepositoryCommit.write>(async () => ({
		ok: true,
		value: {
			outcome: "unknown",
			oid: null,
			snapshot: null,
			warning: "Inspect History before retrying.",
		},
	}));

	root.render(
		<App
			readRepository={async () => ({ ok: true, value: partial })}
			writeCommit={writeCommit}
		/>
	);
	await open();
	message();
	click("commit-submit");
	await settle();
	expect(writeCommit).toHaveBeenCalledTimes(1);
	expect(writeCommit.mock.calls[0]?.[1]).toMatchObject({
		includePartialStaging: true,
		paths: ["a.ts", "b.ts"],
	});
	expect(node("commit-message").customProps?.value).toBe("fix");
	expect(root.renderer.getAllText()).toContain(
		"Inspect History before retrying."
	);
	click("commit-submit");
	expect(writeCommit).toHaveBeenCalledTimes(1);
	click("refresh-repository");
	await settle();
	click("commit-submit");
	await settle();
	expect(writeCommit).toHaveBeenCalledTimes(2);
});

it("updates both tabs of a repository without clearing another tab's draft or issuing a second write", async () => {
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryCommit.write>>>();

	const writeCommit = mock<typeof RepositoryCommit.write>(
		() => pending.promise
	);

	root.render(
		<App
			initialTabCount={2}
			readRepository={readRepository}
			writeCommit={writeCommit}
		/>
	);
	await open();
	message("o n e");
	click("workspace-2");
	await open();
	message("t w o");
	click("workspace-1");
	click("commit-submit");
	click("workspace-2");
	click("commit-submit");
	expect(writeCommit).toHaveBeenCalledTimes(1);
	pending.resolve({
		ok: true,
		value: {
			outcome: "committed",
			oid: "c".repeat(40),
			snapshot: repositorySnapshot(),
			warning: null,
		},
	});
	await settle();
	expect(node("commit-message").customProps?.value).toBe("two");
	expect(root.renderer.findByTestId("entry-a.ts")).toBeUndefined();
	click("workspace-1");
	expect(node("commit-message").customProps?.value).toBe("");
});

it("keeps a confirmed commit successful when the follow-up refresh fails, without allowing accidental resubmission", async () => {
	const writeCommit = mock<typeof RepositoryCommit.write>(async () => ({
		ok: true,
		value: {
			outcome: "committed",
			oid: null,
			snapshot: null,
			warning: "Commit created. Refresh failed.",
		},
	}));

	root.render(
		<App readRepository={readRepository} writeCommit={writeCommit} />
	);
	await open();
	message();
	click("commit-submit");
	await settle();
	expect(node("commit-message").customProps?.value).toBe("");
	expect(root.renderer.getAllText()).toContain(
		"Commit created. Refresh failed."
	);
	message("a g a i n");
	click("commit-submit");
	expect(writeCommit).toHaveBeenCalledTimes(1);
});

it("keeps long hook errors scrollable without hiding the file list or composer controls", async () => {
	root.render(
		<App
			readRepository={readRepository}
			writeCommit={async () => ({
				ok: false,
				error: {
					code: "command-failed",
					operation: "commit",
					message: "Hook rejected.",
					details: "Check source formatting.\n".repeat(100),
					retryable: false,
				},
			})}
		/>
	);
	await open();
	message();
	click("commit-submit");
	await settle();
	const details = node("commit-notice-scroll");
	const bounds = root.renderer.getElementBounds(details.id);
	const button = root.renderer.getElementBounds(node("commit-submit").id);

	expect(bounds?.height).toBeLessThanOrEqual(64);
	expect((button?.y ?? 640) + (button?.height ?? 0)).toBeLessThan(640);
	expect(
		root.renderer.getElementBounds(node("entry-a.ts").id)?.height
	).toBeGreaterThan(0);
	root.renderer.focusElement(details.id);
	root.renderer.simulateKeystrokes("pagedown");
	root.renderer.flush();
	expect(root.renderer.getScrollOffset(details.id)?.[1]).toBeLessThan(0);

	message("space a g a i n");
	expect(root.renderer.getAllText().join(" ")).not.toContain("Hook rejected.");
});
