/**
 * Covers: branch menus, inline creation, keyboard navigation, worktree tabs, cancellable sync and explicit publishing.
 * Real: App, reducers, window-owned mutation coordination, GPUIX layout and events.
 * Doubles: Git boundaries and folder picker, with isolated in-memory repository snapshots.
 * Requires: patched GPUIX renderer and macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import type {
	BranchInfo,
	RemoteInfo,
	RepositorySnapshot,
	WorktreeInfo,
} from "@1git/git";
import { App } from "../../src/app";
import { windowOptions } from "../../src/window-options";
import { RepositoryBranches } from "../../src/feature/workspace-tabs/lib/repository-branches";
import { NativeFileMenu } from "../../src/feature/repository-workspace/lib/native-file-menu";
import type { RepositoryWorktrees } from "../../src/feature/workspace-tabs/lib/repository-worktrees";
import type { RepositoryReader } from "../../src/feature/repository-workspace/lib/repository-reader";
import type { RepositorySync } from "../../src/feature/repository-workspace/lib/repository-sync";
import {
	repositorySnapshot,
	changedFile,
} from "../_shared/repository-snapshot";

let root: TestRoot;
let snapshot: RepositorySnapshot;
let remotes: readonly RemoteInfo[];
let remoteBranches: BranchInfo[];

const origin: RemoteInfo = {
	name: "origin",
	fetchUrls: ["/test/remote"],
	pushUrls: ["/test/remote"],
	defaultBranch: "main",
};

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
		{
			...branch("main", "/test/project"),
			upstream: snapshot.head.upstream,
			ahead: snapshot.head.ahead,
			behind: snapshot.head.behind,
			upstreamRemote: snapshot.head.upstream ? "origin" : null,
			upstreamRef: snapshot.head.upstream ? "refs/heads/main" : null,
		},
		branch("feature/ui"),
		branch("feature/linked", "/test/linked"),
		...remoteBranches,
	],
	current: snapshot.head.branch,
});

const readBranches = mock<typeof RepositoryBranches.read>(async () => ({
	ok: true,
	value: {
		branches: collection(),
		remotes,
		worktrees: [
			{
				path: "/test/project",
				branch: "main",
				headOid: snapshot.head.oid,
				detached: false,
				locked: false,
				lockReason: null,
				prunable: false,
				pruneReason: null,
			},
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

const readSnapshot: typeof RepositoryReader.read = async (path) => ({
	ok: true,
	value:
		path === "/test/linked"
			? {
					...snapshot,
					repository: { ...snapshot.repository, root: path },
					head: { ...snapshot.head, branch: "feature/linked" },
				}
			: snapshot,
});

const readRepository = mock(readSnapshot);

const writeBranch = mock<typeof RepositoryBranches.write>(
	async (_path, request) => {
		snapshot = {
			...snapshot,
			head: { ...snapshot.head, branch: request.name },
		};

		return { ok: true, value: { branches: collection(), snapshot } };
	}
);

const removeWorktree = mock<typeof RepositoryWorktrees.remove>();

const writeWorktree = mock<typeof RepositoryWorktrees.create>(
	async (_root, request) => ({ ok: true, value: request.path })
);

const fetchRepository = mock<typeof RepositorySync.fetch>(async () => ({
	ok: true,
	value: {
		operation: "fetch",
		remote: null,
		branch: snapshot.head.branch,
		snapshot,
	},
}));

const writeSyncRepository = mock<typeof RepositorySync.write>(
	async (_root, input) => ({
		ok: true,
		value: {
			operation: input.kind === "pull" ? "pull" : "push",
			remote: input.remote,
			branch: snapshot.head.branch,
			snapshot,
		},
	})
);

beforeEach(() => {
	snapshot = repositorySnapshot();
	remotes = [];
	remoteBranches = [];
	readBranches.mockClear();
	readRepository.mockClear();
	readRepository.mockImplementation(readSnapshot);
	writeBranch.mockClear();
	writeWorktree.mockReset();
	removeWorktree.mockReset();
	removeWorktree.mockImplementation(async (_root, request) => ({
		ok: true,
		value: request.path,
	}));
	writeWorktree.mockImplementation(async (_root, request) => ({
		ok: true,
		value: request.path,
	}));
	fetchRepository.mockClear();
	writeSyncRepository.mockClear();
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
			writeWorktree={writeWorktree}
			removeWorktree={removeWorktree}
			fetchRepository={fetchRepository}
			writeSyncRepository={writeSyncRepository}
			readDiff={async () => ({ ok: true, value: [] })}
		/>
	);
	click("open-repository");
	await settle();
};

const menu = async (): Promise<void> => {
	click("workspace-1");
	await settle();
};

const worktrees = async (): Promise<void> => {
	const box = bounds("worktrees");

	root.renderer.nativeSimulateMouseMove(
		box.x + box.width / 2,
		box.y + box.height / 2
	);
	await settle();
};

it("shows worktrees only in a right-hand hover submenu and keeps it open while entering", async () => {
	await open();
	await menu();
	expect(root.renderer.findByTestId("worktree-/test/linked")).toBeUndefined();
	expect(element("worktrees").customProps?.["aria-expanded"]).toBe(false);
	await worktrees();
	const parent = bounds("workspace-menu");
	const submenu = bounds("workspace-worktrees");

	expect(submenu.x).toBeGreaterThanOrEqual(parent.x + parent.width);
	expect(
		element("worktree-/test/project").customProps?.["aria-label"]
	).toContain("current worktree");
	expect(element("worktree-/test/linked")).toBeDefined();
	expect(element("worktrees").customProps?.["aria-expanded"]).toBe(true);

	if (process.env.GPUIX_WORKTREE_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_WORKTREE_SCREENSHOT}-right.png`
		);

	root.renderer.nativeSimulateMouseMove(submenu.x + 30, submenu.y + 20);
	root.renderer.flush();
	await Bun.sleep(200);
	await settle();
	expect(element("workspace-worktrees")).toBeDefined();
	expect(readRepository).toHaveBeenCalledTimes(1);
	root.renderer.nativeSimulateMouseMove(900, 600);
	root.renderer.flush();
	await Bun.sleep(200);
	await settle();
	expect(root.renderer.findByTestId("workspace-worktrees")).toBeUndefined();
	expect(element("workspace-menu")).toBeDefined();
});

it("flips the worktree submenu to the left near the window edge", async () => {
	await open();

	for (let index = 0; index < 6; index += 1) click("add-workspace");

	await settle();
	click("open-repository");
	await settle();
	click("workspace-7");
	await settle();
	await worktrees();
	const parent = bounds("workspace-menu");
	const submenu = bounds("workspace-worktrees");

	expect(submenu.x + submenu.width).toBeLessThanOrEqual(parent.x);
	expect(submenu.x).toBeGreaterThanOrEqual(8);
	expect(submenu.y + submenu.height).toBeLessThanOrEqual(640 - 8);

	if (process.env.GPUIX_WORKTREE_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_WORKTREE_SCREENSHOT}-left.png`
		);

	click("worktree-/test/linked");
	await settle();
	expect(element("workspace-8").customProps?.["aria-selected"]).toBe(true);
	expect(root.renderer.findByTestId("workspace-menu")).toBeUndefined();
});

it("opens worktrees with the keyboard, navigates once per key and returns to the parent", async () => {
	await open();
	await menu();
	root.renderer.focusElement(element("worktrees").id);
	root.renderer.simulateKeystrokes("right");
	await settle();
	expect(root.renderer.getFocusedElementId()).toBe(
		element("worktree-/test/project").id
	);
	root.renderer.simulateKeystrokes("down");
	await settle();
	expect(root.renderer.getFocusedElementId()).toBe(
		element("worktree-/test/linked").id
	);
	root.renderer.simulateKeystrokes("left");
	await settle();
	expect(root.renderer.findByTestId("workspace-worktrees")).toBeUndefined();
	expect(root.renderer.getFocusedElementId()).toBe(element("worktrees").id);
	root.renderer.simulateKeystrokes("enter");
	await settle();
	expect(element("workspace-worktrees")).toBeDefined();
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(root.renderer.findByTestId("workspace-worktrees")).toBeUndefined();
	expect(element("workspace-menu")).toBeDefined();
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(root.renderer.findByTestId("workspace-menu")).toBeUndefined();
	expect(root.renderer.getFocusedElementId()).toBe(element("workspace-1").id);
	expect(writeBranch).not.toHaveBeenCalled();
	expect(readRepository).toHaveBeenCalledTimes(1);
});

it("selects the current worktree without rereading it and refuses its removal", async () => {
	const nativeMenu = spyOn(NativeFileMenu, "show").mockReturnValue(0);

	await open();
	await menu();
	await worktrees();
	const current = bounds("worktree-/test/project");

	root.renderer.nativeSimulateClick(current.x + 20, current.y + 14, 2);
	await settle();
	expect(nativeMenu).toHaveBeenCalledWith(
		expect.anything(),
		["Remove worktree…"],
		[false],
		expect.any(Number),
		expect.any(Number)
	);
	expect(root.renderer.findByTestId("confirm-remove-worktree")).toBeUndefined();
	expect(removeWorktree).not.toHaveBeenCalled();
	click("worktree-/test/project");
	await settle();
	expect(root.renderer.findByTestId("workspace-menu")).toBeUndefined();
	expect(root.renderer.findByTestId("workspace-2")).toBeUndefined();
	expect(readRepository).toHaveBeenCalledTimes(1);
});

it("bounds and scrolls long worktree lists, keeps detached and locked entries, and hides stale entries", async () => {
	const entries: WorktreeInfo[] = Array.from({ length: 31 }, (_, index) => ({
		path: index === 0 ? "/test/project" : `/test/tree-${index}`,
		branch: index === 2 ? null : `refs/heads/topic-${index}`,
		headOid: snapshot.head.oid,
		detached: index === 2,
		locked: index === 1,
		lockReason: index === 1 ? "In use" : null,
		prunable: index === 30,
		pruneReason: index === 30 ? "Missing folder" : null,
	}));

	readBranches.mockImplementationOnce(async () => ({
		ok: true,
		value: { branches: collection(), remotes: [], worktrees: entries },
	}));
	await open();
	await menu();
	const parentHeight = bounds("workspace-menu").height;

	await worktrees();
	const submenu = bounds("workspace-worktrees");

	expect(submenu.height).toBeLessThanOrEqual(370);
	expect(bounds("workspace-menu").height).toBe(parentHeight);
	expect(element("worktree-/test/tree-1")).toBeDefined();
	expect(
		element("worktree-/test/tree-2").customProps?.["aria-label"]
	).toContain("detached HEAD");
	expect(root.renderer.findByTestId("worktree-/test/tree-30")).toBeUndefined();
	root.renderer.nativeSimulateScrollWheel(
		submenu.x + 30,
		submenu.y + 30,
		0,
		-600
	);
	await settle();
	expect(
		root.renderer.getScrollOffset(element("workspace-worktree-list").id)?.[1]
	).toBeLessThan(0);
	expect(readBranches).toHaveBeenCalledTimes(1);
	root.renderer.nativeSimulateClick(900, 600);
	await settle();
	expect(root.renderer.findByTestId("workspace-worktrees")).toBeUndefined();
	expect(root.renderer.findByTestId("workspace-menu")).toBeUndefined();
});

it("opens a read-only comparison even with uncommitted changes and returns to the workspace", async () => {
	snapshot = { ...snapshot, files: [changedFile("dirty.txt")] };
	await open();
	await menu();
	click("compare-branches");
	await settle();
	expect(root.renderer.findByTestId("branch-comparison")).toBeTruthy();
	expect(writeBranch).not.toHaveBeenCalled();
	click("close-comparison");
	await settle();
	expect(root.renderer.findByTestId("branch-comparison")).toBeUndefined();
	expect(root.renderer.findByTestId("entry-dirty.txt")).toBeTruthy();
});

it("warns about drafts, confirms removal, and closes only the removed worktree after success", async () => {
	spyOn(NativeFileMenu, "show").mockReturnValue(0);
	await open();
	await menu();
	await worktrees();
	click("worktree-/test/linked");
	await settle();
	click("commit-message");
	root.renderer.simulateKeystrokes("d r a f t");
	click("workspace-1");
	await settle();
	await menu();
	await worktrees();
	const box = bounds("worktree-/test/linked");

	root.renderer.nativeSimulateClick(box.x + 8, box.y + 8, 2);
	await settle();
	expect(root.renderer.getAllText()).toContain("/test/linked");
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Any saved commit drafts"
	);
	expect(removeWorktree).not.toHaveBeenCalled();
	click("cancel-remove-worktree");
	await settle();
	expect(root.renderer.findByTestId("workspace-2")).toBeDefined();
	await worktrees();
	const reopened = bounds("worktree-/test/linked");

	root.renderer.nativeSimulateClick(reopened.x + 8, reopened.y + 8, 2);
	await settle();
	click("confirm-remove-worktree");
	await settle();
	expect(removeWorktree).toHaveBeenCalledWith(
		"/test/project",
		expect.objectContaining({
			kind: "remove",
			path: "/test/linked",
			expectedBranch: "refs/heads/feature/linked",
		})
	);
	expect(root.renderer.findByTestId("workspace-2")).toBeUndefined();
	expect(root.renderer.findByTestId("workspace-1")).toBeDefined();
});

it("keeps affected tabs when removal fails", async () => {
	spyOn(NativeFileMenu, "show").mockReturnValue(0);
	const pendingRemoval =
		Promise.withResolvers<
			Awaited<ReturnType<typeof RepositoryWorktrees.remove>>
		>();

	removeWorktree.mockImplementation(async () => await pendingRemoval.promise);
	await open();
	await menu();
	await worktrees();
	click("worktree-/test/linked");
	await settle();
	click("workspace-1");
	await settle();
	await menu();
	await worktrees();
	const box = bounds("worktree-/test/linked");

	root.renderer.nativeSimulateClick(box.x + 8, box.y + 8, 2);
	await settle();
	click("confirm-remove-worktree");
	await settle();
	root.renderer.simulateKeystrokes("escape");
	await settle();
	click("close-workspace-2");
	await settle();
	expect(root.renderer.findByTestId("workspace-2")).toBeDefined();
	pendingRemoval.resolve({
		ok: false,
		error: {
			code: "conflict",
			operation: "remove-worktree",
			retryable: false,
			message: "Worktree contains untracked files",
		},
	});
	await settle();
	await menu();
	expect(root.renderer.getAllText()).toContain(
		"Worktree contains untracked files"
	);
	expect(root.renderer.findByTestId("workspace-2")).toBeDefined();
});

it("renames through the native context menu only after confirming the form", async () => {
	const nativeMenu = spyOn(NativeFileMenu, "show").mockReturnValue(0);

	await open();
	await menu();
	const box = bounds("branch-main");

	root.renderer.nativeSimulateClick(box.x + 8, box.y + 8, 2);
	await settle();
	expect(nativeMenu).toHaveBeenCalledWith(
		expect.anything(),
		["Rename branch…", "Delete branch…"],
		[true, false],
		expect.any(Number),
		expect.any(Number)
	);
	expect(writeBranch).not.toHaveBeenCalled();
	click("branch-name");
	root.renderer.simulateKeystrokes("cmd-a r e n a m e d");
	click("create-branch");
	await settle();
	expect(writeBranch).toHaveBeenCalledWith(
		"/test/project",
		expect.objectContaining({
			kind: "rename",
			name: "main",
			newName: "renamed",
			expectedTarget: "1234567890abcdef",
		})
	);
});

it("confirms deletion and supports cancelling without a branch write", async () => {
	spyOn(NativeFileMenu, "show").mockReturnValue(1);
	await open();
	await menu();
	const box = bounds("branch-feature/ui");

	root.renderer.nativeSimulateClick(box.x + 8, box.y + 8, 0, "ctrl");
	await settle();
	expect(root.renderer.getAllText()).toContain("Delete branch?");
	expect(writeBranch).not.toHaveBeenCalled();
	click("cancel-create-branch");
	await settle();
	expect(writeBranch).not.toHaveBeenCalled();
	root.renderer.nativeSimulateKeyDown(
		element("branch-feature/ui").id,
		"shift-f10"
	);
	await settle();
	click("create-branch");
	await settle();
	expect(writeBranch).toHaveBeenCalledWith(
		"/test/project",
		expect.objectContaining({
			kind: "delete",
			name: "feature/ui",
			expectedTarget: "1234567890abcdef",
		})
	);
});

it("omits tracked remote branches from both pickers but keeps another remote visible", async () => {
	snapshot = {
		...snapshot,
		head: { ...snapshot.head, upstream: "origin/main" },
	};
	remoteBranches = ["origin", "other"].map((remote) => ({
		...branch(`${remote}/main`),
		type: "remote",
		remote,
		fullName: `refs/remotes/${remote}/main`,
	}));
	await open();
	await menu();
	click("more-branches");
	await settle();
	expect(
		root.renderer.findByTestId("branch-refs/remotes/origin/main")
	).toBeUndefined();
	expect(
		root.renderer.findByTestId("branch-refs/remotes/other/main")
	).toBeDefined();
	click("create-worktree");
	await settle();
	click("worktree-branch-name");
	await settle();
	expect(
		root.renderer.findByTestId("worktree-option-origin/main")
	).toBeUndefined();
	expect(
		root.renderer.findByTestId("worktree-option-other/main")
	).toBeDefined();
});

it("confirms remote checkout and explains a colliding local branch", async () => {
	remoteBranches = ["topic", "main"].map((name) => ({
		...branch(`origin/${name}`),
		type: "remote",
		remote: "origin",
		fullName: `refs/remotes/origin/${name}`,
	}));
	await open();
	await menu();
	click("more-branches");
	await settle();
	expect(root.renderer.getAllText()).toContain("Local branch exists");
	click("branch-refs/remotes/origin/main");
	await settle();
	expect(writeBranch).not.toHaveBeenCalled();
	click("branch-refs/remotes/origin/topic");
	await settle();
	expect(writeBranch).not.toHaveBeenCalled();
	expect(root.renderer.getAllText()).toContain(
		"Tracks origin/topic in this workspace."
	);
	click("create-branch");
	await settle();
	expect(writeBranch).toHaveBeenCalledWith(
		"/test/project",
		expect.objectContaining({
			kind: "remote",
			name: "refs/remotes/origin/topic",
		})
	);
});

it("confirms a remote tracking branch in a new worktree", async () => {
	remoteBranches = [
		{
			...branch("origin/topic"),
			type: "remote",
			remote: "origin",
			fullName: "refs/remotes/origin/topic",
		},
	];
	await open();
	await menu();
	click("create-worktree");
	await settle();
	click("worktree-branch-name");
	await settle();
	click("worktree-option-origin/topic");
	await settle();
	expect(writeWorktree).not.toHaveBeenCalled();
	expect(root.renderer.getAllText()).toContain(
		"Creates “topic” tracking origin/topic."
	);
	click("confirm-create-worktree");
	await settle();
	expect(writeWorktree).toHaveBeenCalledWith(
		"/test/project",
		expect.objectContaining({
			kind: "remote",
			branch: "refs/remotes/origin/topic",
		})
	);
});

it("creates a worktree from a dirty workspace, opens its tab, and preserves the original draft", async () => {
	snapshot = { ...snapshot, files: [changedFile("file.txt")] };
	readRepository.mockImplementation(async (path) => ({
		ok: true,
		value:
			path === "/test/project"
				? snapshot
				: {
						...snapshot,
						files: [],
						repository: { ...snapshot.repository, root: path },
						head: { ...snapshot.head, branch: "topic" },
					},
	}));
	await open();
	click("commit-message");
	root.renderer.simulateKeystrokes("d r a f t");
	await menu();
	click("create-worktree");
	await settle();
	root.renderer.simulateKeystrokes("t o p i c");
	await settle();
	expect(root.renderer.getAllText()).toContain("project-topic");
	expect(root.renderer.findByTestId("worktree-folder-name")).toBeUndefined();
	click("confirm-create-worktree");
	await settle();
	expect(writeWorktree).toHaveBeenCalledWith("/test/project", {
		kind: "new",
		branch: "topic",
		path: "/test/project-topic",
		expectedHead: snapshot.head.oid,
		expectedBranch: "main",
	});
	expect(root.renderer.findByTestId("workspace-2")).toBeDefined();
	expect(root.renderer.getAllText()).toContain(" / topic");
	click("workspace-1");
	await settle();
	expect(element("commit-message").customProps?.value).toBe("draft");
	expect(writeBranch).not.toHaveBeenCalled();
});

it("explains occupied branches and chooses an unused branch and destination folder", async () => {
	await open();
	await menu();
	click("create-worktree");
	await settle();
	const initialSubmitBounds = bounds("confirm-create-worktree");
	const initialMenuBounds = bounds("workspace-menu");

	expect(
		initialMenuBounds.y +
			initialMenuBounds.height -
			(initialSubmitBounds.y + initialSubmitBounds.height)
	).toBeGreaterThanOrEqual(12);
	click("worktree-branch-name");
	await settle();
	expect(root.renderer.getAllText()).toContain("feature/ui");
	expect(root.renderer.getAllText()).toContain("This workspace");
	expect(root.renderer.getAllText()).toContain("Another worktree");
	click("worktree-option-feature/ui");
	await settle();
	expect(root.renderer.getAllText()).toContain("Uses existing branch.");
	spyOn(root.renderer, "promptForPaths").mockResolvedValueOnce(["/test/other"]);
	click("worktree-change-location");
	await settle();
	expect(root.renderer.getAllText()).toContain("other");
	expect(root.renderer.findByTestId("worktree-folder-icon")).toBeDefined();
	const submitBounds = bounds("confirm-create-worktree");
	const menuBounds = bounds("workspace-menu");

	expect(submitBounds.y + submitBounds.height).toBeLessThanOrEqual(
		menuBounds.y + menuBounds.height
	);
	click("confirm-create-worktree");
	await settle();
	expect(writeWorktree).toHaveBeenCalledWith(
		"/test/project",
		expect.objectContaining({
			kind: "existing",
			branch: "feature/ui",
			path: "/test/other",
		})
	);
});

it("keeps a failed worktree creation visible and allows cancelling the form without writing", async () => {
	await open();
	await menu();
	click("create-worktree");
	await settle();
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(writeWorktree).not.toHaveBeenCalled();
	click("create-worktree");
	await settle();
	root.renderer.simulateKeystrokes("t o p i c");
	writeWorktree.mockResolvedValueOnce({
		ok: false,
		error: {
			code: "conflict",
			operation: "create-worktree",
			retryable: false,
			message: "Destination already exists",
		},
	});
	click("confirm-create-worktree");
	await settle();
	expect(root.renderer.getAllText()).toContain("Destination already exists");
	expect(root.renderer.findByTestId("workspace-2")).toBeUndefined();
});

it("protects related tabs during creation and retains the result when the menu is dismissed", async () => {
	let closeBlocked = false;

	Object.assign(root.renderer, {
		setCloseBlocked(value: boolean) {
			closeBlocked = value;
		},
		takeCloseRequested() {
			return false;
		},
	});
	const pending =
		Promise.withResolvers<
			Awaited<ReturnType<typeof RepositoryWorktrees.create>>
		>();

	writeWorktree.mockImplementationOnce(() => {
		expect(closeBlocked).toBe(true);

		return pending.promise;
	});
	await open();
	await menu();
	await worktrees();
	click("worktree-/test/linked");
	await settle();
	click("workspace-1");
	await settle();
	await menu();
	click("create-worktree");
	await settle();
	root.renderer.simulateKeystrokes("t o p i c");
	click("confirm-create-worktree");
	await settle();
	root.renderer.simulateKeystrokes("escape");
	await settle();
	click("close-workspace-1");
	expect(element("workspace-1")).toBeTruthy();
	click("workspace-2");
	await settle();
	click("close-workspace-2");
	expect(element("workspace-2")).toBeTruthy();
	click("workspace-2");
	await settle();
	click("create-worktree");
	expect(root.renderer.findByTestId("worktree-branch-name")).toBeUndefined();
	pending.resolve({
		ok: false,
		error: {
			code: "conflict",
			operation: "create-worktree",
			retryable: false,
			message: "Creation failed safely",
		},
	});
	await settle();
	root.renderer.nativeSimulateClick(900, 600);
	await settle();
	click("workspace-1");
	await settle();
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Creation failed safely"
	);
	expect(writeWorktree).toHaveBeenCalledTimes(1);
	expect(closeBlocked).toBe(false);
});

it("reports an already-created worktree when its first read fails, without creating it twice", async () => {
	await open();
	await menu();
	click("create-worktree");
	await settle();
	root.renderer.simulateKeystrokes("t o p i c");
	readRepository.mockResolvedValueOnce({
		ok: false,
		error: {
			code: "conflict",
			operation: "open-repository",
			retryable: false,
			message: "Read failed",
		},
	});
	click("confirm-create-worktree");
	await settle();
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Worktree created at /test/project-topic"
	);
	await settle();
	expect(writeWorktree).toHaveBeenCalledTimes(1);
});

it("keeps the chosen destination when the picker is cancelled or the branch changes", async () => {
	await open();
	await menu();
	click("create-worktree");
	await settle();
	root.renderer.simulateKeystrokes("t o p i c");
	const picker = spyOn(root.renderer, "promptForPaths")
		.mockResolvedValueOnce(["/test/custom"])
		.mockResolvedValueOnce(null);

	click("worktree-change-location");
	await settle();
	expect(picker).toHaveBeenCalledWith({
		directories: true,
		files: false,
		multiple: false,
		prompt: "Choose worktree folder",
	});
	click("worktree-change-location");
	await settle();
	expect(root.renderer.findByTestId("worktree-folder-name")).toBeUndefined();
	click("worktree-branch-name");
	root.renderer.simulateKeystrokes("cmd-a n e x t");
	await settle();
	expect(root.renderer.getAllText()).toContain("custom");
	click("confirm-create-worktree");
	await settle();
	expect(writeWorktree).toHaveBeenCalledWith(
		"/test/project",
		expect.objectContaining({ branch: "next", path: "/test/custom" })
	);
});

it("infers exact existing names, rejects occupied or invalid branches, and never creates on suggestion selection", async () => {
	await open();
	await menu();
	click("create-worktree");
	await settle();
	root.renderer.simulateKeystrokes("m a i n");
	await settle();
	expect(root.renderer.getAllText()).toContain(
		"Already used by this workspace."
	);
	click("confirm-create-worktree");
	expect(writeWorktree).not.toHaveBeenCalled();
	click("worktree-branch-name");
	root.renderer.simulateKeystrokes("cmd-a f e a t u r e / l i n k e d");
	await settle();
	expect(root.renderer.getAllText()).toContain(
		"Already open in another worktree."
	);
	click("confirm-create-worktree");
	expect(writeWorktree).not.toHaveBeenCalled();
	click("worktree-branch-name");
	root.renderer.simulateKeystrokes("cmd-a b a d space n a m e");
	await settle();
	expect(root.renderer.getAllText()).toContain(
		"Enter a valid Git branch name."
	);
	click("confirm-create-worktree");
	expect(writeWorktree).not.toHaveBeenCalled();
	click("worktree-branch-name");
	root.renderer.simulateKeystrokes("cmd-a f e a t");
	await settle();
	root.renderer.simulateKeystrokes("down enter");
	await settle();
	expect(root.renderer.getAllText()).toContain("Uses existing branch.");
	expect(writeWorktree).not.toHaveBeenCalled();
	click("confirm-create-worktree");
	await settle();
	expect(writeWorktree).toHaveBeenCalledWith(
		"/test/project",
		expect.objectContaining({ kind: "existing", branch: "feature/ui" })
	);
});

it("accepts a new-name suggestion without writing until confirmed", async () => {
	await open();
	await menu();
	click("create-worktree");
	await settle();
	root.renderer.simulateKeystrokes("t o p i c");
	await settle();
	click("worktree-option-topic");
	await settle();
	expect(root.renderer.getAllText()).toContain(
		"Creates a new branch from main."
	);
	expect(writeWorktree).not.toHaveBeenCalled();
	click("confirm-create-worktree");
	await settle();
	expect(writeWorktree).toHaveBeenCalledWith(
		"/test/project",
		expect.objectContaining({ kind: "new", branch: "topic" })
	);
});

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
			remotes: [],
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
	root.renderer.simulateKeystrokes("up up");
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
		value: {
			branches: { branches: [], current: null },
			worktrees: [],
			remotes: [],
		},
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
	await worktrees();
	click("worktree-/test/linked");
	await settle();
	expect(element("workspace-2").customProps?.["aria-selected"]).toBe(true);
	expect(root.renderer.getAllText()).toContain(" / feature/linked");
	click("workspace-1");
	await settle();
	await menu();
	await worktrees();
	click("worktree-/test/linked");
	await settle();
	expect(root.renderer.findByTestId("workspace-3")).toBeUndefined();
	expect(element("workspace-2").customProps?.["aria-selected"]).toBe(true);
	expect(writeBranch).not.toHaveBeenCalled();
});

it("keeps unsafe actions disabled without a persistent explanation or empty footer", async () => {
	snapshot = repositorySnapshot([changedFile("a.txt")]);
	await open();
	await menu();
	click("branch-feature/ui");
	click("branch-feature/linked");
	click("create-branch");
	expect(writeBranch).not.toHaveBeenCalled();
	expect(root.renderer.findByTestId("branch-name")).toBeUndefined();
	expect(root.renderer.findByTestId("branch-notice")).toBeUndefined();
	expect(root.renderer.getAllText().join(" ")).not.toContain(
		"Commit or stash changes"
	);
	const menuBox = bounds("workspace-menu");
	const action = bounds("push-repository");

	expect(
		menuBox.y + menuBox.height - action.y - action.height
	).toBeLessThanOrEqual(6);
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
	expect(root.renderer.getFocusedElementId()).toBe(
		element("create-worktree").id
	);
	root.renderer.simulateKeystrokes("tab");
	await settle();
	expect(root.renderer.findByTestId("workspace-menu")).toBeUndefined();
	expect(root.renderer.getFocusedElementId()).toBe(
		element("close-workspace-1").id
	);
});

it("does not fetch on open and disables Fetch when no remote is configured", async () => {
	await open();
	await menu();
	expect(root.renderer.getAllText()).toContain("No remote");
	click("fetch-repository");
	await settle();
	expect(fetchRepository).not.toHaveBeenCalled();
});

it("fetches a dirty repository explicitly and refreshes tracking without losing drafts or inclusion", async () => {
	remotes = [origin];
	snapshot = repositorySnapshot([changedFile("a.ts"), changedFile("b.ts")]);
	fetchRepository.mockImplementationOnce(async () => {
		snapshot = {
			...snapshot,
			head: { ...snapshot.head, upstream: "origin/main", ahead: 2, behind: 3 },
		};

		return {
			ok: true,
			value: { operation: "fetch", remote: null, branch: "main", snapshot },
		};
	});
	await open();
	click("include-b.ts");
	click("entry-b.ts");
	click("commit-message");
	root.renderer.simulateKeystrokes("d r a f t");
	await menu();
	expect(fetchRepository).not.toHaveBeenCalled();
	root.renderer.simulateKeystrokes("up");
	await settle();
	root.renderer.simulateKeystrokes("up");
	await settle();
	expect(root.renderer.getFocusedElementId()).toBe(
		element("fetch-repository").id
	);
	root.renderer.simulateKeystrokes("enter");
	await settle();
	await settle();
	expect(fetchRepository).toHaveBeenCalledTimes(1);
	expect(fetchRepository.mock.calls[0]?.[0]).toBe("/test/project");
	expect(readRepository).toHaveBeenCalledTimes(2);
	expect(root.renderer.getAllText()).toContain(
		"origin/main · 2 ahead · 3 behind"
	);
	expect(root.renderer.getAllText()).toContain("Fetched just now");
	expect(element("workspace-menu")).toBeTruthy();
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(element("commit-message").customProps?.value).toBe("draft");
	expect(element("include-b.ts").customProps?.["aria-checked"]).toBe(false);
	expect(element("entry-b.ts").customProps?.["aria-selected"]).toBe(true);
	expect(root.renderer.getAllText()).toContain(" / main");
	expect(writeBranch).not.toHaveBeenCalled();
});

it("keeps fetch alive across menu dismissal, locks related worktrees and cancels from either tab", async () => {
	remotes = [origin];
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositorySync.fetch>>>();

	fetchRepository.mockImplementationOnce(() => pending.promise);
	await open();
	await menu();
	await worktrees();
	click("worktree-/test/linked");
	await settle();
	click("workspace-1");
	await settle();
	await menu();
	click("fetch-repository");
	await settle();
	expect(root.renderer.getAllText()).toContain("Fetching…");
	const signal = fetchRepository.mock.calls[0]?.[1];

	expect(signal?.aborted).toBe(false);
	root.renderer.simulateKeystrokes("escape");
	await settle();
	click("close-workspace-1");
	await settle();
	expect(element("workspace-1")).toBeTruthy();
	click("workspace-2");
	await settle();
	click("close-workspace-2");
	await settle();
	expect(element("workspace-2")).toBeTruthy();
	click("workspace-2");
	await settle();
	expect(root.renderer.getAllText()).toContain("Fetching…");
	click("create-branch");
	expect(root.renderer.findByTestId("branch-name")).toBeUndefined();
	click("fetch-repository");
	expect(signal?.aborted).toBe(true);
	expect(fetchRepository).toHaveBeenCalledTimes(1);
	pending.resolve({
		ok: false,
		error: {
			code: "aborted",
			operation: "fetch",
			message: "Aborted",
			retryable: true,
		},
	});
	await settle();
	await settle();
	expect(root.renderer.getAllText()).toContain("Fetch cancelled.");
	expect(root.renderer.getAllText()).not.toContain("Fetched just now");
	expect(readRepository.mock.calls.map(([path]) => path)).toEqual(
		expect.arrayContaining(["/test/project", "/test/linked"])
	);
	root.renderer.simulateKeystrokes("escape");
	await settle();
	click("workspace-1");
	await settle();
	await menu();
	expect(root.renderer.getAllText()).toContain("Fetch cancelled.");
	click("fetch-repository");
	await settle();
	await settle();
	expect(fetchRepository).toHaveBeenCalledTimes(2);
	expect(root.renderer.getAllText()).toContain("Fetched just now");
});

it("retains fetch failures on reopen, refreshes partial results and permits an explicit retry", async () => {
	remotes = [origin];
	fetchRepository.mockImplementationOnce(async () => {
		snapshot = {
			...snapshot,
			head: { ...snapshot.head, upstream: "origin/main", behind: 1 },
		};

		return {
			ok: false,
			error: {
				code: "authentication-required",
				operation: "fetch",
				message: "Authentication required for one remote.",
				retryable: true,
			},
		};
	});
	await open();
	await menu();
	click("fetch-repository");
	await settle();
	await settle();
	expect(root.renderer.getAllText()).toContain(
		"Authentication required for one remote."
	);
	expect(root.renderer.getAllText()).toContain("origin/main · 1 behind");
	expect(root.renderer.getAllText()).not.toContain("Fetched just now");
	root.renderer.simulateKeystrokes("escape");
	await settle();
	await menu();
	expect(root.renderer.getAllText()).toContain(
		"Authentication required for one remote."
	);
	expect(fetchRepository).toHaveBeenCalledTimes(1);
	click("fetch-repository");
	await settle();
	await settle();
	expect(fetchRepository).toHaveBeenCalledTimes(2);
	expect(root.renderer.findByTestId("branch-notice")).toBeUndefined();
	expect(root.renderer.getAllText()).toContain("Fetched just now");
});

it("aborts a pending fetch when its window unmounts", async () => {
	remotes = [origin];
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositorySync.fetch>>>();

	fetchRepository.mockImplementationOnce(() => pending.promise);
	await open();
	await menu();
	click("fetch-repository");
	await settle();
	const signal = fetchRepository.mock.calls[0]?.[1];

	root.unmount();
	expect(signal?.aborted).toBe(true);
	pending.resolve({
		ok: false,
		error: {
			code: "aborted",
			operation: "fetch",
			message: "Aborted",
			retryable: true,
		},
	});
	await Bun.sleep(0);
	expect(readRepository).toHaveBeenCalledTimes(1);
});

it("reports a failed post-fetch refresh without treating the successful fetch as a failure or enabling branch writes", async () => {
	remotes = [origin];
	await open();
	await menu();
	readRepository.mockImplementationOnce(async () => ({
		ok: false,
		error: {
			code: "command-failed",
			operation: "get-snapshot",
			message: "Status could not be refreshed.",
			retryable: true,
		},
	}));
	click("fetch-repository");
	await settle();
	await settle();
	expect(root.renderer.getAllText()).toContain(
		"Status could not be refreshed."
	);
	expect(root.renderer.getAllText()).toContain("Fetched just now");
	click("branch-feature/ui");
	expect(writeBranch).not.toHaveBeenCalled();
	root.renderer.simulateKeystrokes("escape");
	await settle();
	click("refresh-repository");
	await settle();
	await menu();
	expect(root.renderer.findByTestId("branch-notice")).toBeUndefined();
	expect(root.renderer.getAllText()).toContain("Fetched just now");
});

it("pulls from the displayed upstream, refreshes HEAD and preserves the commit draft", async () => {
	remotes = [origin];
	const previousHead = "a".repeat(40);

	snapshot = {
		...snapshot,
		head: {
			...snapshot.head,
			oid: previousHead,
			upstream: "origin/main",
			behind: 2,
		},
	};

	writeSyncRepository.mockImplementationOnce(async (_root, input) => {
		snapshot = {
			...snapshot,
			head: { ...snapshot.head, oid: "b".repeat(40), behind: 0 },
		};

		return {
			ok: true,
			value: {
				operation: "pull",
				remote: input.remote,
				branch: "main",
				snapshot,
			},
		};
	});
	await open();
	click("commit-message");
	root.renderer.simulateKeystrokes("d r a f t");
	await menu();
	expect(root.renderer.getAllText()).toContain("2 behind");
	click("pull-repository");
	await settle();
	await settle();
	expect(writeSyncRepository.mock.calls[0]?.slice(0, 2)).toEqual([
		"/test/project",
		{
			kind: "pull",
			remote: "origin",
			remoteRef: "refs/heads/main",
			expectedHead: previousHead,
			expectedBranch: "main",
		},
	]);
	expect(root.renderer.getAllText()).toContain("Pull complete.");
	expect(root.renderer.getAllText()).not.toContain("2 behind");
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(element("commit-message").customProps?.value).toBe("draft");
});

it("allows Push with dirty files while Pull stays disabled and file inclusion is preserved", async () => {
	remotes = [origin];
	snapshot = repositorySnapshot([changedFile("a.ts"), changedFile("b.ts")]);
	snapshot = {
		...snapshot,
		head: { ...snapshot.head, upstream: "origin/main", ahead: 2 },
	};
	await open();
	click("include-b.ts");
	await menu();
	click("pull-repository");
	expect(writeSyncRepository).not.toHaveBeenCalled();
	root.renderer.simulateKeystrokes("up");
	await settle();
	expect(root.renderer.getFocusedElementId()).toBe(
		element("push-repository").id
	);
	root.renderer.simulateKeystrokes("enter");
	await settle();
	await settle();
	expect(writeSyncRepository.mock.calls[0]?.[1]).toMatchObject({
		kind: "push",
		remote: "origin",
		remoteRef: "refs/heads/main",
	});
	expect(root.renderer.getAllText()).toContain("Push complete.");
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(element("include-b.ts").customProps?.["aria-checked"]).toBe(false);
});

it("requires choosing and confirming a remote before publishing and supports Escape without writing", async () => {
	remotes = [origin, { ...origin, name: "upstream" }];
	await open();
	await menu();
	click("push-repository");
	await settle();
	expect(element("publish-remotes")).toBeTruthy();
	click("confirm-publish");
	expect(writeSyncRepository).not.toHaveBeenCalled();
	root.renderer.simulateKeystrokes("down");
	await settle();
	root.renderer.simulateKeystrokes("down");
	await settle();
	root.renderer.simulateKeystrokes("enter");
	await settle();
	expect(root.renderer.getAllText()).toContain("Publish to upstream");
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(root.renderer.findByTestId("publish-remotes")).toBeUndefined();
	expect(writeSyncRepository).not.toHaveBeenCalled();
	click("push-repository");
	await settle();
	click("publish-remote-upstream");
	click("confirm-publish");
	await settle();
	await settle();
	expect(writeSyncRepository).toHaveBeenCalledTimes(1);
	expect(writeSyncRepository.mock.calls[0]?.[1]).toMatchObject({
		kind: "publish",
		remote: "upstream",
		remoteRef: "refs/heads/main",
		expectedBranch: "main",
	});
	expect(root.renderer.getAllText()).toContain("Branch published.");
});

it("blocks diverged pulls and detached publication without issuing a write", async () => {
	remotes = [origin];
	snapshot = {
		...snapshot,
		head: { ...snapshot.head, upstream: "origin/main", ahead: 1, behind: 1 },
	};
	await open();
	await menu();
	click("pull-repository");
	expect(root.renderer.getAllText()).toContain("Diverged");
	expect(writeSyncRepository).not.toHaveBeenCalled();
	root.renderer.simulateKeystrokes("escape");
	await settle();
	snapshot = {
		...snapshot,
		head: { ...snapshot.head, branch: null, detached: true, upstream: null },
	};
	click("refresh-repository");
	await settle();
	await menu();
	click("push-repository");
	click("pull-repository");
	expect(root.renderer.findByTestId("publish-remotes")).toBeUndefined();
	expect(writeSyncRepository).not.toHaveBeenCalled();
});

it("keeps a pending push locked across menu closure and reports uncertain cancellation without automatic retry", async () => {
	remotes = [origin];
	snapshot = {
		...snapshot,
		head: { ...snapshot.head, upstream: "origin/main", ahead: 1 },
	};
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositorySync.write>>>();

	writeSyncRepository.mockImplementationOnce(() => pending.promise);
	await open();
	await menu();
	click("push-repository");
	await settle();
	expect(root.renderer.getAllText()).toContain("Pushing…");
	root.renderer.simulateKeystrokes("escape");
	await settle();
	click("close-workspace-1");
	expect(element("workspace-1")).toBeTruthy();
	await menu();
	click("fetch-repository");
	click("pull-repository");
	click("create-branch");
	expect(fetchRepository).not.toHaveBeenCalled();
	expect(root.renderer.findByTestId("branch-name")).toBeUndefined();
	click("push-repository");
	expect(writeSyncRepository.mock.calls[0]?.[2].aborted).toBe(true);
	pending.resolve({
		ok: false,
		error: {
			code: "aborted",
			operation: "push",
			message: "Aborted",
			retryable: false,
		},
	});
	await settle();
	await settle();
	expect(root.renderer.getAllText().join(" ")).toContain("may have completed");
	expect(writeSyncRepository).toHaveBeenCalledTimes(1);
	expect(readRepository).toHaveBeenCalledTimes(2);
});
