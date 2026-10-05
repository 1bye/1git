/**
 * Covers: checked-file commits, combined Sync controls, duplicate prevention, draft/error retention and refresh.
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
import { emptyHistory } from "../_shared/history-page";
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
	await Bun.sleep(0);
	root.renderer.flush();
};

const message = (keys = "f i x"): void => {
	click("commit-message");
	root.renderer.simulateKeystrokes(keys);
	root.renderer.flush();
};

const snapshot = () =>
	repositorySnapshot([changedFile("a.ts"), changedFile("b.ts")]);

const readRepository = async () => ({ ok: true as const, value: snapshot() });

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
};

it("places a secondary Sync button immediately left of Commit and preserves the draft", async () => {
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
	const editor = root.renderer.getElementBounds(node("commit-message").id);

	expect(root.renderer.getAllText()).not.toContain("⌘ Enter");
	expect(node("commit-message").style).toMatchObject({
		padding: 8,
		paddingBottom: 4,
		borderWidth: 0,
	});
	expect(editor?.x).toBe((composer?.x ?? 0) + 8);
	expect(editor?.y).toBe((composer?.y ?? 0) + 9);
	expect(editor?.width).toBe(composer?.width);
	const layoutScreenshot = process.env.GPUIX_COMPOSER_LAYOUT_SCREENSHOT;

	if (layoutScreenshot) root.renderer.captureScreenshot(layoutScreenshot);

	message();
	const sync = root.renderer.getElementBounds(node("commit-sync").id);
	const commit = root.renderer.getElementBounds(node("commit-submit").id);

	expect(sync).toBeDefined();
	expect(commit).toBeDefined();
	expect(sync && commit && sync.x + sync.width).toBeLessThan(commit?.x ?? 0);
	expect(sync?.y).toBe(commit?.y);
	expect(commit && commit.x + commit.width).toBe(
		(composer?.x ?? 0) + (composer?.width ?? 0) - 10
	);
	expect(node("commit-sync").style?.backgroundColor).not.toBe(
		node("commit-submit").style?.backgroundColor
	);
	const screenshot = process.env.GPUIX_SYNC_SCREENSHOT;

	if (screenshot) root.renderer.captureScreenshot(screenshot);

	click("commit-sync");
	click("commit-sync");
	expect(writeSyncRepository).toHaveBeenCalledTimes(1);
	expect(writeSyncRepository.mock.calls[0]?.slice(0, 2)).toEqual([
		"/test/project",
		{
			kind: "sync",
			expectedHead: tracked.head.oid ?? "",
			expectedBranch: "main",
		},
	]);
	expect(writeSyncRepository.mock.calls[0]?.[2].aborted).toBe(true);
	expect(root.renderer.getAllText()).toContain("Syncing…");
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
	root.renderer.nativeSimulateKeyDown(node("commit-sync").id, "enter");
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
	expect(root.renderer.getAllText()).toContain("Sync complete");
	expect(node("commit-sync").customProps?.["aria-label"]).toBe("Sync complete");
	expect(root.renderer.findByTestId("commit-notice-scroll")).toBeUndefined();
	expect(node("commit-message").customProps?.value).toBe("fix");
	expect(node("include-b.ts").customProps?.["aria-checked"]).toBe(false);
	const screenshot = process.env.GPUIX_SYNC_COMPLETE_SCREENSHOT;

	if (screenshot) root.renderer.captureScreenshot(screenshot);

	await Bun.sleep(3_100);
	root.renderer.flush();
	expect(root.renderer.getAllText()).not.toContain("Sync complete");
	expect(node("commit-sync").customProps?.["aria-label"]).toBe(
		"Sync with upstream"
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
		head: { ...base.head, upstream: "origin/main" },
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
	click("commit-sync");
	await settle();
	await settle();
	expect(root.renderer.getAllText()).toContain("Sync complete");
	writeSyncRepository.mockImplementation(() => pending.promise);
	click("commit-sync");
	expect(root.renderer.getAllText()).toContain("Syncing…");
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
	expect(node("commit-sync").customProps?.["aria-label"]).toBe(
		"Sync with upstream"
	);
});

it.each(["untracked", "detached", "unborn", "merge"] as const)(
	"disables Sync for a %s branch without writes",
	async (condition) => {
		const base = snapshot();

		const value = {
			...base,
			head: {
				...base.head,
				upstream: condition === "untracked" ? null : "origin/main",
				branch: condition === "detached" ? null : "main",
				detached: condition === "detached",
				oid: condition === "unborn" ? null : base.head.oid,
				unborn: condition === "unborn",
			},
			operationState:
				condition === "merge" ? ("merge" as const) : ("normal" as const),
		};

		const writeSyncRepository = mock<typeof RepositorySync.write>(async () => {
			throw new Error("Blocked branches must not sync");
		});

		root.render(
			<App
				readRepository={async () => ({ ok: true, value })}
				writeSyncRepository={writeSyncRepository}
			/>
		);
		await open();
		expect(node("commit-sync").style.opacity).toBe(0.45);
		click("commit-sync");
		root.renderer.nativeSimulateKeyDown(node("commit-sync").id, "enter");
		root.renderer.flush();
		expect(writeSyncRepository).not.toHaveBeenCalled();
	}
);

it("never synchronizes preview workspaces", async () => {
	const writeSyncRepository = mock<typeof RepositorySync.write>(async () => {
		throw new Error("Previews must not sync");
	});

	root.render(<App preview writeSyncRepository={writeSyncRepository} />);
	expect(node("commit-sync").style.opacity).toBe(0.45);
	click("commit-sync");
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
