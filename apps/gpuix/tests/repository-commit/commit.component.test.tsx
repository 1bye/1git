/**
 * Covers: explicit commits, duplicate prevention, draft/error retention, cross-tab refresh and partial-staging guards.
 * Real: App, reducers, hooks and native GPUIX events/layout.
 * Doubles: Git reads/writes and folder picker; no live repository mutations.
 * Requires: patched GPUIX renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import type { RepositoryCommit } from "../../src/feature/repository-workspace/lib/repository-commit";
import type { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
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

const open = async (): Promise<void> => {
	click("open-repository");
	await settle();
};

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
			paths: ["a.ts"],
			message: "fix\n\ndetails",
			expectedHead: snapshot().head.oid,
			expectedBranch: "main",
		},
	]);
	expect(root.renderer.getAllText()).toContain("Committing…");
	expect(node("commit-message").customProps?.readOnly).toBe(true);
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
	expect(root.renderer.getAllText()).toContain("Committed bbbbbbb.");
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

it("blocks selected partial staging until excluded, and blocks uncertain outcomes until a manual refresh", async () => {
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
	expect(writeCommit).not.toHaveBeenCalled();
	expect(root.renderer.getAllText().join(" ")).toContain("partially staged");
	click("include-a.ts");
	click("commit-submit");
	await settle();
	expect(writeCommit).toHaveBeenCalledTimes(1);
	expect(node("commit-message").customProps?.value).toBe("fix");
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
