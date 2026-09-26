/**
 * Covers: compact recent-branch menus, inline creation, lifted tab/backdrop geometry, keyboard navigation and worktree tabs.
 * Real: App, reducers, window-owned mutation coordination, GPUIX layout and events.
 * Doubles: Git boundaries and folder picker, with isolated in-memory repository snapshots.
 * Requires: patched GPUIX renderer and macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import type { BranchInfo, RepositorySnapshot } from "@1git/git";
import { App } from "../../src/app";
import { windowOptions } from "../../src/window-options";
import { RepositoryBranches } from "../../src/feature/workspace-tabs/lib/repository-branches";
import type { RepositoryReader } from "../../src/feature/repository-workspace/lib/repository-reader";
import {
	repositorySnapshot,
	changedFile,
} from "../_shared/repository-snapshot";

let root: TestRoot;
let snapshot: RepositorySnapshot;

const branch = (
	name: string,
	worktreePath: string | null = null
): BranchInfo => ({
	name,
	fullName: `refs/heads/${name}`,
	oid: "1234567890abcdef",
	checkedOut: name === "main",
	type: "local",
	worktreePath,
	ahead: 0,
	behind: 0,
	committedAt: null,
	remote: null,
	summary: "",
	upstream: null,
});

const collection = () => ({
	branches: [
		branch("main", "/test/project"),
		branch("feature/ui"),
		branch("feature/linked", "/test/linked"),
	],
	current: snapshot.head.branch,
});

const readBranches = mock<typeof RepositoryBranches.read>(async () => ({
	ok: true,
	value: {
		branches: collection(),
		worktrees: [
			{
				path: "/test/linked",
				branch: "refs/heads/feature/linked",
				headOid: snapshot.head.oid,
				detached: false,
				locked: false,
				lockReason: null,
				prunable: false,
				pruneReason: null,
			},
		],
	},
}));

const readRepository = mock<typeof RepositoryReader.read>(async (path) => ({
	ok: true,
	value:
		path === "/test/linked"
			? {
					...snapshot,
					repository: { ...snapshot.repository, root: path },
					head: { ...snapshot.head, branch: "feature/linked" },
				}
			: snapshot,
}));

const writeBranch = mock<typeof RepositoryBranches.write>(
	async (_path, request) => {
		snapshot = {
			...snapshot,
			head: { ...snapshot.head, branch: request.name },
		};

		return { ok: true, value: { branches: collection(), snapshot } };
	}
);

beforeEach(() => {
	snapshot = repositorySnapshot();
	readBranches.mockClear();
	readRepository.mockClear();
	writeBranch.mockClear();
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

const bounds = (id: string) => {
	const box = root.renderer.getElementBounds(element(id).id);

	if (!box) throw new Error(`No bounds for ${id}`);

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
	root.renderer.clockFastForward(250);
	root.renderer.flush();
	root.renderer.dispatchNativeEvents();
	root.renderer.flush();
	await Bun.sleep(0);
	root.renderer.flush();
};

const open = async (): Promise<void> => {
	root.render(
		<App
			readRepository={readRepository}
			readBranches={readBranches}
			writeBranch={writeBranch}
		/>
	);
	click("open-repository");
	await settle();
};

const menu = async (): Promise<void> => {
	click("workspace-1");
	await settle();
};

it("opens only the active tab's compact menu with branch context and Escape focus restoration", async () => {
	await open();
	click("add-workspace");
	await settle();
	click("workspace-1");
	await settle();
	expect(root.renderer.findByTestId("workspace-menu")).toBeUndefined();
	await menu();
	expect(bounds("workspace-menu").y).toBe(
		bounds("slot-workspace-1").y + bounds("slot-workspace-1").height - 1
	);
	expect(bounds("workspace-menu").height).toBeGreaterThan(180);
	expect(root.renderer.findByTestId("branch-search")).toBeUndefined();
	expect(root.renderer.getAllText()).toContain("No upstream");
	expect(root.renderer.getAllText()).not.toContain("Switch branch");
	expect(root.renderer.getAllText()).not.toContain("Close");
	expect(bounds("branch-feature/ui").y - bounds("branch-main").y).toBe(28);
	expect(element("branch-feature/ui")).toBeTruthy();
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(root.renderer.findByTestId("workspace-menu")).toBeUndefined();
	expect(root.renderer.getFocusedElementId()).toBe(element("workspace-1").id);
});

it("switches a branch using native keyboard navigation and refreshes the tab label", async () => {
	await open();
	await menu();
	root.renderer.simulateKeystrokes("down");
	await settle();
	root.renderer.simulateKeystrokes("down");
	await settle();
	root.renderer.simulateKeystrokes("enter");
	await settle();
	expect(writeBranch).toHaveBeenCalledWith("/test/project", {
		kind: "switch",
		name: "feature/ui",
		expectedHead: snapshot.head.oid,
		expectedBranch: "main",
	});
	expect(root.renderer.getAllText()).toContain(" / feature/ui");
	expect(root.renderer.findByTestId("workspace-menu")).toBeUndefined();
});

it("creates and switches explicitly, preserving a commit draft", async () => {
	await open();
	click("commit-message");
	root.renderer.simulateKeystrokes("d r a f t");
	await menu();
	click("create-branch");
	await settle();
	root.renderer.simulateKeystrokes("f e a t / n e w");
	await settle();
	click("create-branch");
	await settle();
	expect(writeBranch.mock.calls[0]?.[1]).toMatchObject({
		kind: "create",
		name: "feat/new",
	});
	expect(root.renderer.getAllText()).toContain(" / feat/new");
	expect(element("commit-message").customProps?.value).toBe("draft");
});

it("shows the three newest local branches and expands, scrolls, and collapses the rest", async () => {
	const now = Date.now();

	const branches = Array.from({ length: 16 }, (_, index) => ({
		...branch(index === 0 ? "main" : `feature/${index}`),
		committedAt: new Date(now - index * 3_600_000).toISOString(),
		upstream: index === 0 ? "origin/main" : null,
		ahead: index === 0 ? 2 : 0,
	}));

	readBranches.mockImplementationOnce(async () => ({
		ok: true,
		value: {
			branches: {
				current: "main",
				branches: [
					...branches.toReversed(),
					{ ...branch("origin/remote"), type: "remote" },
				],
			},
			worktrees: [],
		},
	}));
	await open();
	await menu();
	expect(root.renderer.getAllText()).toContain("origin/main · 2 ahead");
	expect(root.renderer.getAllText()).toContain("just now");
	expect(bounds("branch-main").y).toBeLessThan(bounds("branch-feature/1").y);
	expect(bounds("branch-feature/1").y).toBeLessThan(
		bounds("branch-feature/2").y
	);
	expect(root.renderer.findByTestId("branch-feature/3")).toBeUndefined();
	expect(root.renderer.findByTestId("branch-origin/remote")).toBeUndefined();
	const collapsedHeight = bounds("workspace-menu").height;

	click("more-branches");
	await settle();
	expect(element("branch-feature/15")).toBeTruthy();
	expect(bounds("workspace-menu").height).toBeGreaterThan(collapsedHeight);
	expect(bounds("workspace-menu").height).toBeLessThanOrEqual(370);
	root.renderer.simulateKeystrokes("up");
	await settle();
	expect(root.renderer.getFocusedElementId()).toBe(
		element("branch-feature/15").id
	);
	const list = bounds("workspace-menu-list");
	const last = bounds("branch-feature/15");

	const offset =
		root.renderer.getScrollOffset(element("workspace-menu-list").id)?.[1] ?? 0;

	expect(last.y).toBeGreaterThanOrEqual(list.y - offset);
	expect(last.y + last.height).toBeLessThanOrEqual(
		list.y - offset + list.height
	);
	root.renderer.simulateKeystrokes("down");
	await settle();
	root.renderer.simulateKeystrokes("enter");
	await settle();
	expect(root.renderer.findByTestId("branch-feature/3")).toBeUndefined();
	expect(bounds("workspace-menu").height).toBe(collapsedHeight);
	expect(writeBranch).not.toHaveBeenCalled();
});

it("replaces the actions with an inline form and returns with Cancel or Escape without writing", async () => {
	await open();
	await menu();
	click("create-branch");
	await settle();
	expect(root.renderer.findByTestId("branch-main")).toBeUndefined();
	expect(root.renderer.getFocusedElementId()).toBe(element("branch-name").id);
	root.renderer.simulateKeystrokes("space enter");
	await settle();
	expect(writeBranch).not.toHaveBeenCalled();
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(root.renderer.findByTestId("branch-name")).toBeUndefined();
	expect(element("branch-main")).toBeTruthy();
	root.renderer.simulateKeystrokes("up");
	await settle();
	root.renderer.simulateKeystrokes("enter");
	await settle();
	expect(element("branch-name")).toBeTruthy();
	click("cancel-create-branch");
	await settle();
	expect(element("branch-main")).toBeTruthy();
	expect(writeBranch).not.toHaveBeenCalled();
});

it("keeps empty and failed branch lists dismissible", async () => {
	readBranches.mockImplementationOnce(async () => ({
		ok: true,
		value: { branches: { branches: [], current: null }, worktrees: [] },
	}));
	snapshot = { ...snapshot, head: { ...snapshot.head, branch: null } };
	await open();
	await menu();
	expect(root.renderer.getAllText()).toContain("Detached HEAD");
	expect(root.renderer.getAllText()).toContain("No local branches available.");
	expect(root.renderer.findByTestId("more-branches")).toBeUndefined();
	root.renderer.simulateKeystrokes("escape");
	await settle();
	readBranches.mockImplementationOnce(async () => {
		throw new Error("Unavailable");
	});
	await menu();
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Could not load branches"
	);
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(root.renderer.findByTestId("workspace-menu")).toBeUndefined();
});

it("opens an existing worktree and reuses its tab on a second open", async () => {
	await open();
	await menu();
	click("worktree-/test/linked");
	await settle();
	expect(element("workspace-2").customProps?.["aria-selected"]).toBe(true);
	expect(root.renderer.getAllText()).toContain(" / feature/linked");
	click("workspace-1");
	await settle();
	await menu();
	click("worktree-/test/linked");
	await settle();
	expect(root.renderer.findByTestId("workspace-3")).toBeUndefined();
	expect(element("workspace-2").customProps?.["aria-selected"]).toBe(true);
	expect(writeBranch).not.toHaveBeenCalled();
});

it("blocks dirty-tree switching and branches already checked out elsewhere", async () => {
	snapshot = repositorySnapshot([changedFile("a.txt")]);
	await open();
	await menu();
	click("branch-feature/ui");
	click("branch-feature/linked");
	expect(writeBranch).not.toHaveBeenCalled();
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Commit or stash changes"
	);
	click("add-workspace");
	await settle();
	expect(root.renderer.findByTestId("workspace-menu")).toBeUndefined();
});

it("retains failures inside the menu without losing the current branch", async () => {
	writeBranch.mockImplementationOnce(async () => ({
		ok: false,
		error: {
			code: "invalid-reference",
			operation: "checkout-branch",
			retryable: false,
			message: "Branch no longer exists",
		},
	}));
	await open();
	await menu();
	click("branch-feature/ui");
	await settle();
	expect(root.renderer.getAllText()).toContain("Branch no longer exists");
	expect(root.renderer.getAllText()).toContain(" / main");
	expect(element("workspace-menu")).toBeTruthy();
});

it("keeps the window-owned write locked if its menu closes while switching", async () => {
	let resolve: (() => void) | undefined;

	writeBranch.mockImplementationOnce(async () => {
		await new Promise<void>((done) => {
			resolve = done;
		});

		return { ok: true, value: { branches: collection(), snapshot } };
	});
	await open();
	await menu();
	click("branch-feature/ui");
	await settle();
	root.renderer.nativeSimulateKeyDown(element("workspace-menu").id, "escape");
	await settle();
	click("close-workspace-1");
	await settle();
	expect(element("workspace-1")).toBeTruthy();
	resolve?.();
	await settle();
	click("close-workspace-1");
	await settle();
	expect(root.renderer.findByTestId("workspace-1")).toBeUndefined();
});

it("reorders by captured drag without opening the menu", async () => {
	await open();
	click("add-workspace");
	await settle();
	click("workspace-1");
	await settle();
	const start = bounds("workspace-1");
	const target = bounds("workspace-2");

	root.renderer.nativeSimulateMouseDown(start.x + 15, start.y + 10);
	root.renderer.nativeSimulateMouseMove(target.x + 50, target.y + 10, 0);
	root.renderer.nativeSimulateMouseUp(target.x + 50, target.y + 10);
	await settle();
	expect(root.renderer.findByTestId("workspace-menu")).toBeUndefined();
	expect(bounds("workspace-1").x).toBeGreaterThan(bounds("workspace-2").x);
});

it("keeps the menu inside the right edge and dismisses on a background click", async () => {
	await open();

	for (let index = 0; index < 6; index += 1) click("add-workspace");

	await settle();
	click("open-repository");
	await settle();
	click("workspace-7");
	await settle();
	const box = bounds("workspace-menu");

	expect(box.x).toBeGreaterThanOrEqual(8);
	expect(box.x + box.width).toBeLessThanOrEqual(980 - 8);
	expect(bounds("workspace-menu-tab").x).toBe(bounds("slot-workspace-7").x);
	const offset = root.renderer.getScrollOffset(element("workspace-tabs").id);

	root.renderer.nativeSimulateScrollWheel(500, 20, 150, 0);
	await settle();
	expect(root.renderer.getScrollOffset(element("workspace-tabs").id)).toEqual(
		offset
	);
	root.renderer.nativeSimulateClick(800, 600);
	await settle();
	expect(root.renderer.findByTestId("workspace-menu")).toBeUndefined();
});

it("lifts an identical tab silhouette above a full-window backdrop with the menu centered and attached", async () => {
	await open();
	const original = bounds("slot-workspace-1");

	await menu();
	const preview = bounds("workspace-menu-tab");
	const menuBox = bounds("workspace-menu");

	expect(preview).toEqual(original);
	expect(element("workspace-menu-tab-surface").customProps?.source).toBe(
		element("surface-workspace-1").customProps?.source
	);
	expect(bounds("avatar-menu-workspace-1")).toEqual(
		bounds("avatar-workspace-1")
	);
	expect(menuBox.x + menuBox.width / 2).toBe(preview.x + preview.width / 2);
	expect(menuBox.y).toBe(preview.y + preview.height - 1);
	expect(bounds("workspace-menu-backdrop")).toEqual({
		x: 0,
		y: 0,
		width: 980,
		height: 640,
	});
	click("workspace-menu-tab");
	await settle();
	expect(root.renderer.findByTestId("workspace-menu")).toBeUndefined();
	expect(element("workspace-1")).toBeTruthy();
});

it("dismisses the backdrop without activating the dimmed add or close controls", async () => {
	await open();
	await menu();
	click("add-workspace");
	await settle();
	expect(root.renderer.findByTestId("workspace-menu")).toBeUndefined();
	expect(root.renderer.findByTestId("workspace-2")).toBeUndefined();
	expect(root.renderer.getFocusedElementId()).toBe(element("workspace-1").id);
	await menu();
	click("close-workspace-1");
	await settle();
	expect(root.renderer.findByTestId("workspace-menu")).toBeUndefined();
	expect(element("workspace-1")).toBeTruthy();
});

it("updates every tab for the same folder after a branch switch", async () => {
	await open();
	click("add-workspace");
	await settle();
	click("open-repository");
	await settle();
	click("workspace-2");
	await settle();
	click("branch-feature/ui");
	await settle();
	expect(
		root.renderer.getAllText().filter((text) => text === " / feature/ui")
	).toHaveLength(2);
});

it("opens with Down, wraps Up to the final action, and dismisses with Tab", async () => {
	await open();
	root.renderer.nativeSimulateKeyDown(element("workspace-1").id, "down");
	await settle();
	expect(element("workspace-menu")).toBeTruthy();
	root.renderer.simulateKeystrokes("up");
	await settle();
	expect(root.renderer.getFocusedElementId()).toBe(element("create-branch").id);
	root.renderer.simulateKeystrokes("tab");
	await settle();
	expect(root.renderer.findByTestId("workspace-menu")).toBeUndefined();
	expect(root.renderer.getFocusedElementId()).toBe(
		element("close-workspace-1").id
	);
});
