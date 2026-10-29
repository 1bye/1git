/**
 * Covers: separate rail navigation, ref search/filtering, commit/file selection, cancellation, retries and native graph rendering.
 * Real: App, graph geometry, native GPUIX lists, keyboard input and diff preview.
 * Doubles: Git readers, folder picker and offscreen-window focus notifications; no repository or provider traffic.
 * Requires: patched GPUIX addon and macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { flushSync, handleGpuixEvent } from "@gpuix/react";
import type { ComponentProps } from "react";
import { App } from "../../src/app";
import { RepositoryGraph } from "../../src/feature/repository-graph/repository-graph";
import type {
	GraphReferences,
	RepositoryGraphReader,
} from "../../src/feature/repository-graph/repository-graph-reader";
import { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import type { RepositoryTags } from "../../src/feature/repository-workspace/lib/repository-tags";
import type { RepositorySync } from "../../src/feature/repository-workspace/lib/repository-sync";
import {
	commitInfo,
	committedFiles,
	historyPage,
} from "../_shared/history-page";
import { repositorySnapshot } from "../_shared/repository-snapshot";
import { changedFile } from "../_shared/repository-snapshot";
import { diffPatch } from "../_shared/diff-patch";
import type { RepositoryBranches } from "../../src/feature/workspace-tabs/lib/repository-branches";
import { NativeFileMenu } from "../../src/feature/repository-workspace/lib/native-file-menu";

let root: TestRoot;
let menuChoice: string;
let menuLabels: string[];
let menuEnabled: boolean[];

const commits = [
	{
		...commitInfo(30),
		summary: "Merge branch 'feature/search'",
		parentOids: [commitInfo(29).oid, commitInfo(28).oid],
	},
	{
		...commitInfo(29),
		summary: "Improve repository discovery",
		parentOids: [commitInfo(27).oid],
	},
	{
		...commitInfo(28),
		summary: "Add fast branch search",
		parentOids: [commitInfo(26).oid],
	},
	{
		...commitInfo(27),
		summary: "Keep cached results visible",
		parentOids: [commitInfo(25).oid],
	},
	{
		...commitInfo(26),
		summary: "Add native graph lanes",
		parentOids: [commitInfo(25).oid],
	},
	...Array.from({ length: 26 }, (_, index) => ({
		...commitInfo(25 - index),
		parentOids: index < 25 ? [commitInfo(24 - index).oid] : [],
	})),
];

const references: GraphReferences = {
	head: commitInfo(30).oid,
	tags: [],
	references: [
		{
			id: "refs/heads/main",
			name: "main",
			oid: commitInfo(30).oid,
			kind: "local",
			current: true,
		},
		{
			id: "refs/heads/feature/search",
			name: "feature/search",
			oid: commitInfo(28).oid,
			kind: "local",
			current: false,
		},
		{
			id: "refs/remotes/origin/main",
			name: "origin/main",
			oid: commitInfo(29).oid,
			kind: "remote",
			current: false,
		},
		{
			id: "refs/tags/v0.0.20",
			name: "v0.0.20",
			oid: commitInfo(25).oid,
			kind: "tag",
			current: false,
		},
	],
};

const readReferences = mock<typeof RepositoryGraphReader.references>(
	async () => ({ ok: true, value: references })
);

const readPage = mock<typeof RepositoryGraphReader.page>(async () => ({
	ok: true,
	value: { commits, hasMore: false, nextOffset: null },
}));

const readFiles = mock<typeof RepositoryHistory.readFiles>(
	async (_root, commit) => ({ ok: true, value: committedFiles(commit, 3) })
);

const writeBranch = mock<typeof RepositoryBranches.write>(async () => ({
	ok: true,
	value: {
		branches: { current: "main", branches: [] },
		snapshot: repositorySnapshot(),
	},
}));

beforeEach(() => {
	root = createTestRoot({ width: 1280, height: 800 });
	root.renderer.clockPause();
	spyOn(root.renderer, "promptForPaths").mockResolvedValue(["/test/project"]);
	readReferences.mockClear();
	readPage.mockClear();
	readFiles.mockClear();
	writeBranch.mockClear();
	menuChoice = "";
	menuLabels = [];
	menuEnabled = [];
	spyOn(RepositoryHistory, "readCommitLink").mockResolvedValue(null);
	Object.assign(root.renderer, {
		showContextMenuItems(labels: string[], enabled: boolean[]) {
			menuLabels = labels;
			menuEnabled = enabled;

			return labels.indexOf(menuChoice);
		},
	});
});
afterEach(() => {
	root.unmount();
	mock.restore();
});

function element(id: string) {
	const node = root.renderer.findByTestId(id);

	if (!node) throw new Error(`Missing ${id}`);

	return node;
}
function bounds(id: string) {
	const box = root.renderer.getElementBounds(element(id).id);

	if (!box) throw new Error(`Missing bounds ${id}`);

	return box;
}
function click(id: string): void {
	const box = bounds(id);

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2
	);
	root.renderer.flush();
}
async function settle(): Promise<void> {
	for (let index = 0; index < 4; index++) {
		await Bun.sleep(0);
		root.renderer.flush();
	}
}
function show(
	appearance: "light" | "dark" = "light",
	fontSize = 12,
	props: ComponentProps<typeof App> = {}
): void {
	root.render(
		<App
			initialSession={{
				version: 1,
				activeId: "workspace-1",
				appearance,
				typography: { fontSize, fontFamily: "", codeFontFamily: "Menlo" },
				tabs: [{ id: "workspace-1", path: null, draft: "" }],
			}}
			readRepository={async () => ({ ok: true, value: repositorySnapshot() })}
			readGraphReferences={readReferences}
			writeBranch={writeBranch}
			readGraphPage={readPage}
			readCommitFiles={readFiles}
			readDiff={async (_root, file) => ({
				ok: true,
				value: [
					{
						target: "commit",
						patch: diffPatch(file.path),
						stats: [],
						message: null,
					},
				],
			})}
			readHistory={async () => ({ ok: true, value: historyPage() })}
			readHistoryCount={async () => ({ ok: true, value: 12 })}
			readTags={async () => ({ ok: true, value: [] })}
			readUnpushedCommits={async () => ({ ok: true, value: [] })}
			readLastCommit={async () => ({
				ok: true,
				value: { commit: commitInfo(), undoUnavailableReason: null },
			})}
			{...props}
		/>
	);
}
async function open(): Promise<void> {
	click("open-repository");
	await settle();
	click("view-graph");
	await settle();
}

it("disables graph branch creation during an unfinished Git operation", async () => {
	show("light", 12, {
		readRepository: async () => ({
			ok: true,
			value: { ...repositorySnapshot(), operationState: "merge" },
		}),
	});
	await open();
	click(`entry-${commits[0]!.oid}`);
	await settle();

	expect(element("graph-new-branch").customProps?.tabIndex).toBeUndefined();
	click("graph-new-branch");
	expect(root.renderer.findByTestId("graph-branch-dialog")).toBeUndefined();
	expect(writeBranch).not.toHaveBeenCalled();
});

it("switches Graph file navigation to a read-only tree without changing commit navigation", async () => {
	show();
	await open();
	click(`entry-${commits[0]!.oid}`);
	await settle();
	click("graph-file-layout");
	expect(element("graph-files-viewport").customProps?.role).toBe("tree");
	expect(element("graph-commits-viewport").customProps?.role).toBe("listbox");
	expect(root.renderer.findByTestId("include-folder:src/")).toBeUndefined();
	click("entry-folder:src/");
	expect(root.renderer.findByTestId("entry-src/file-0.ts")).toBeUndefined();
	expect(element("diff-header")).toBeDefined();
	click("view-changes");
	expect(element("changes-file-layout").customProps?.["aria-label"]).toBe(
		"Switch to list view"
	);
});

it("resizes the branch sidebar with the mouse and keyboard and remembers its width after leaving Graph", async () => {
	show();
	await open();
	const divider = bounds("graph-sidebar-divider");
	const x = divider.x + divider.width / 2;
	const y = divider.y + 200;

	root.renderer.nativeSimulateMouseDown(x, y);
	root.renderer.nativeSimulateMouseMove(x + 70, y + 80, 0);
	root.renderer.nativeSimulateMouseUp(x + 70, y + 80);
	root.renderer.flush();
	expect(bounds("graph-sidebar").width).toBe(300);
	click("view-history");
	click("view-graph");
	await settle();
	expect(bounds("graph-sidebar").width).toBe(300);
	root.renderer.nativeSimulateKeyDown(
		element("graph-sidebar-divider").id,
		"home"
	);
	root.renderer.flush();
	expect(bounds("graph-sidebar").width).toBe(180);
	root.renderer.nativeSimulateKeyDown(
		element("graph-sidebar-divider").id,
		"end"
	);
	root.renderer.flush();
	expect(bounds("graph-sidebar").width).toBe(420);
});

for (const appearance of ["light", "dark"] as const) {
	it(`opens a separate ${appearance} Graph rail tab and inspects commit files without replacing History`, async () => {
		show(appearance);
		expect(readReferences).not.toHaveBeenCalled();
		await open();
		expect(element("view-graph").customProps?.["aria-selected"]).toBe(true);
		expect(root.renderer.findByTestId("repository-navigation")).toBeUndefined();
		expect(bounds("graph-sidebar").width).toBe(230);
		expect(bounds("graph-sidebar").x).toBe(bounds("workspace").x);
		expect(element(`graph-labels-${commits[0]!.oid}`)).toBeDefined();
		expect(readFiles).not.toHaveBeenCalled();

		if (process.env.GPUIX_GRAPH_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_GRAPH_SCREENSHOT}-${appearance}.png`
			);

		click(`entry-${commits[0]!.oid}`);
		await settle();
		expect(readFiles.mock.calls.at(-1)?.[1]).toBe(commits[0]!.oid);
		expect(element("commit-details")).toBeDefined();
		expect(element("graph-files")).toBeDefined();
		expect(element("diff-header")).toBeDefined();
		expect(bounds("graph-details-pane").height).toBeGreaterThan(200);
		root.renderer.nativeSimulateKeyDown(
			element(`entry-${commits[0]!.oid}`).id,
			"down"
		);
		root.renderer.flush();
		await settle();
		expect(readFiles.mock.calls.at(-1)?.[1]).toBe(commits[1]!.oid);

		if (process.env.GPUIX_GRAPH_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_GRAPH_SCREENSHOT}-${appearance}-details.png`
			);

		click("graph-close-details");
		expect(root.renderer.findByTestId("graph-details-pane")).toBeUndefined();
		click("view-history");
		await settle();
		expect(root.renderer.findByTestId("repository-graph")).toBeUndefined();
		expect(element("view-history").customProps?.["aria-selected"]).toBe(true);
		root.renderer.nativeSimulateKeyDown(element("view-stashes").id, "down");
		root.renderer.flush();
		await settle();
		expect(element("view-graph").customProps?.["aria-selected"]).toBe(true);
	});
}

it("resizes details and changed files without rereading Git and retains sizes across commit selection", async () => {
	show();
	await open();
	click(`entry-${commits[0]!.oid}`);
	await settle();
	const start = bounds("graph-details-pane").height;
	const divider = bounds("graph-details-divider");
	const x = divider.x + 40;
	const y = divider.y + divider.height / 2;
	const reads = [readPage.mock.calls.length, readFiles.mock.calls.length];

	root.renderer.nativeSimulateMouseDown(x, y);
	root.renderer.nativeSimulateMouseMove(x + 40, y - 90, 0);
	root.renderer.nativeSimulateMouseUp(x + 40, y - 90);
	root.renderer.flush();
	expect(bounds("graph-details-pane").height).toBeCloseTo(start + 90, 0);
	const files = bounds("graph-files-sidebar-divider");

	root.renderer.nativeSimulateMouseDown(files.x + 3, files.y + 30);
	root.renderer.nativeSimulateMouseMove(files.x + 63, files.y + 60, 0);
	root.renderer.nativeSimulateMouseUp(files.x + 63, files.y + 60);
	root.renderer.flush();
	expect(bounds("graph-files-sidebar").width).toBe(280);
	expect([readPage.mock.calls.length, readFiles.mock.calls.length]).toEqual(
		reads
	);
	const resized = bounds("graph-details-pane").height;

	click(`entry-${commits[1]!.oid}`);
	await settle();
	expect(bounds("graph-details-pane").height).toBeCloseTo(resized, 0);
	expect(bounds("graph-files-sidebar").width).toBe(280);
	click("graph-close-details");
	click(`entry-${commits[0]!.oid}`);
	await settle();
	expect(bounds("graph-details-pane").height).toBeCloseTo(resized, 0);
	expect(bounds("graph-files-sidebar").width).toBe(280);
	const handle = bounds("graph-details-divider");

	root.renderer.nativeSimulateMouseDown(handle.x + 30, handle.y + 4);
	root.renderer.nativeSimulateMouseMove(handle.x + 30, handle.y + 44, 0);
	root.renderer.nativeSimulateKeyDown(
		element("graph-details-divider").id,
		"escape"
	);
	root.renderer.nativeSimulateMouseUp(handle.x + 30, handle.y + 44);
	root.renderer.flush();
	expect(bounds("graph-details-pane").height).toBeCloseTo(resized, 0);
	root.renderer.nativeSimulateKeyDown(
		element("graph-details-divider").id,
		"up"
	);
	root.renderer.flush();
	expect(bounds("graph-details-pane").height).toBeGreaterThan(resized);
	root.renderer.nativeSimulateKeyDown(
		element("graph-files-sidebar-divider").id,
		"left"
	);
	root.renderer.flush();
	expect(bounds("graph-files-sidebar").width).toBe(270);
});

it("creates a branch at the reviewed graph commit without switching or altering files", async () => {
	show();
	await open();
	click(`entry-${commits[2]!.oid}`);
	await settle();
	click("graph-new-branch");
	await settle();
	root.renderer.clockFastForward(250);
	await settle();
	expect(element("graph-branch-dialog")).toBeDefined();
	expect(root.renderer.getFocusedElementId()).toBe(
		element("graph-branch-name").id
	);

	if (process.env.GPUIX_GRAPH_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_GRAPH_SCREENSHOT}-branch-dialog.png`
		);

	root.renderer.simulateKeystrokes("m a i n");
	await settle();
	expect(root.renderer.getAllText()).toContain(
		"This branch already exists. Choose another name."
	);
	click("graph-branch-create");
	expect(writeBranch).not.toHaveBeenCalled();
	click("graph-branch-name");
	root.renderer.simulateKeystrokes("cmd-a g r a p h / t o p i c");
	await settle();
	root.renderer.simulateKeystrokes("enter");
	await settle();
	expect(writeBranch).toHaveBeenCalledTimes(1);
	expect(writeBranch.mock.calls[0]?.[1]).toMatchObject({
		kind: "create-at",
		name: "graph/topic",
		expectedTarget: commits[2]!.oid,
	});
	expect(root.renderer.findByTestId("graph-branch-dialog")).toBeUndefined();
	expect(root.renderer.getAllText()).toContain(
		`Created graph/topic at ${commits[2]!.oid.slice(0, 7)}.`
	);
	expect(element("rail-branches").customProps?.["aria-label"]).toBe(
		"Branches · main"
	);
	expect(element("view-graph").customProps?.["aria-selected"]).toBe(true);
});

it("offers branch creation from a commit context menu and retains failures for correction", async () => {
	const menu = spyOn(NativeFileMenu, "showItems").mockReturnValue(
		"create-branch"
	);

	writeBranch.mockImplementationOnce(async () => ({
		ok: false,
		error: {
			code: "conflict",
			operation: "create-branch",
			retryable: false,
			message: "Branch already exists on disk.",
		},
	}));
	show();
	await open();
	root.renderer.nativeSimulateKeyDown(
		element(`entry-${commits[1]!.oid}`).id,
		"shift-f10"
	);
	await settle();
	expect(menu).toHaveBeenCalled();
	expect(element("graph-branch-dialog")).toBeDefined();
	root.renderer.simulateKeystrokes("t o p i c");
	await settle();
	click("graph-branch-create");
	await settle();
	expect(root.renderer.getAllText()).toContain(
		"Branch already exists on disk."
	);
	expect(element("graph-branch-dialog")).toBeDefined();
	click("graph-branch-cancel");
	await settle();
	expect(root.renderer.findByTestId("graph-branch-dialog")).toBeUndefined();
});

const graphActions = [
	{
		choice: "Revert commit…",
		dialog: "revert-dialog",
		cancel: "revert-cancel",
		confirm: "revert-confirm",
		kind: "revert",
	},
	{
		choice: "Cherry-pick commit…",
		dialog: "cherry-pick-dialog",
		cancel: "cherry-pick-cancel",
		confirm: "cherry-pick-confirm",
		kind: "cherry",
	},
	{
		choice: "Reset to commit…",
		dialog: "reset-dialog",
		cancel: "reset-cancel",
		confirm: "reset-confirm",
		kind: "reset",
	},
	{
		choice: "Create tag…",
		dialog: "tag-dialog",
		cancel: "tag-cancel",
		confirm: "tag-confirm",
		kind: "tag",
	},
] as const;

async function commitMenu(choice: string, index = 1): Promise<void> {
	menuChoice = choice;
	root.renderer.nativeSimulateKeyDown(
		element(`entry-${commits[index]!.oid}`).id,
		"shift-f10"
	);
	await settle();
	root.renderer.clockFastForward(250);
	await settle();
}

it.each([...graphActions])(
	"reviews, cancels, and confirms $kind using the clicked graph commit",
	async (action) => {
		const revert = mock<typeof RepositoryHistory.revert>(async () => ({
			ok: true,
			value: repositorySnapshot(),
		}));

		const cherry = mock<typeof RepositoryHistory.cherryPick>(async () => ({
			ok: true,
			value: repositorySnapshot(),
		}));

		const reset = mock<typeof RepositoryHistory.reset>(async () => ({
			ok: true,
			value: {
				snapshot: repositorySnapshot(),
				recoveryRef: "refs/1git/reset/test",
				warning: null,
			},
		}));

		const tag = mock<typeof RepositoryTags.create>(async () => ({
			ok: true,
			value: repositorySnapshot(),
		}));

		const writers = { revert, cherry, reset, tag };

		show("light", 12, {
			revertCommit: revert,
			cherryPickCommit: cherry,
			resetCommit: reset,
			createTag: tag,
			readReset: async () => ({
				ok: true,
				value: { target: commits[1]!, commitCount: 2 },
			}),
			readBranches: async () => ({
				ok: true,
				value: {
					branches: {
						current: "main",
						branches: [
							{
								name: "destination",
								fullName: "refs/heads/destination",
								oid: "b".repeat(40),
								checkedOut: false,
								type: "local",
								worktreePath: null,
								ahead: 0,
								behind: 0,
								committedAt: null,
								remote: null,
								summary: "",
								upstream: null,
							},
						],
					},
					worktrees: [],
					remotes: [],
				},
			}),
		});
		await open();
		click(`entry-${commits[2]!.oid}`);
		await settle();
		await commitMenu(action.choice);

		for (const item of graphActions) expect(menuLabels).toContain(item.choice);

		expect(menuLabels).toContain("Create branch here…");
		expect(menuEnabled[menuLabels.indexOf(action.choice)]).toBe(true);
		expect(element(action.dialog)).toBeDefined();

		if (process.env.GPUIX_GRAPH_ACTIONS_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_GRAPH_ACTIONS_SCREENSHOT}-${action.kind}.png`
			);

		for (const writer of Object.values(writers))
			expect(writer).not.toHaveBeenCalled();

		click(action.cancel);
		await settle();
		root.renderer.clockFastForward(250);
		await settle();
		root.renderer.advanceTime(1);
		await settle();
		expect(root.renderer.findByTestId(action.dialog)).toBeUndefined();
		expect(element("view-graph").customProps?.["aria-selected"]).toBe(true);
		await commitMenu(action.choice);

		if (action.kind === "tag") {
			click("tag-name");
			root.renderer.simulateKeystrokes("v 1 . 2 . 3");
			await settle();
		} else if (action.kind === "cherry") {
			click("entry-cherry-pick-refs/heads/destination");
			await settle();
		}

		click(action.confirm);
		await settle();
		expect(writers[action.kind]).toHaveBeenCalledTimes(1);
		expect(writers[action.kind].mock.calls[0]?.[1]).toMatchObject({
			[action.kind === "reset" ? "target" : "commit"]: commits[1]!.oid,
			expectedHead: repositorySnapshot().head.oid,
			expectedBranch: "main",
		});
		expect(root.renderer.findByTestId(action.dialog)).toBeUndefined();
		expect(
			element(action.kind === "tag" ? "view-graph" : "view-changes")
				.customProps?.["aria-selected"]
		).toBe(true);
	}
);

it("pushes a graph tag only after choosing and confirming its exact remote destination", async () => {
	const tag = {
		name: "v2.0.0",
		oid: "e".repeat(40),
		targetOid: commits[1]!.oid,
		type: "annotated" as const,
		createdAt: null,
		message: "Release",
	};

	const push = mock<typeof RepositorySync.pushTag>(async () => ({
		ok: true,
		value: {
			name: tag.name,
			oid: tag.oid,
			remote: "origin",
			snapshot: repositorySnapshot(),
		},
	}));

	readReferences.mockImplementationOnce(async () => ({
		ok: true,
		value: { ...references, tags: [tag] },
	}));
	show("light", 12, {
		pushTag: push,
		readBranches: async () => ({
			ok: true,
			value: {
				branches: { current: "main", branches: [] },
				worktrees: [],
				remotes: [
					{
						name: "origin",
						defaultBranch: null,
						fetchUrls: ["https://github.com/team/repo.git"],
						pushUrls: ["git@github.com:team/repo.git"],
					},
				],
			},
		}),
	});
	await open();
	await commitMenu(tag.name);
	expect(menuLabels).toContain("Push tag…");
	expect(element("tag-dialog")).toBeDefined();
	click("tag-confirm");
	expect(push).not.toHaveBeenCalled();
	click("tag-remote");
	await settle();
	click("tag-remote-origin");
	await settle();
	click("tag-confirm");
	await settle();
	expect(push).toHaveBeenCalledTimes(1);
	expect(push.mock.calls[0]?.[1]).toMatchObject({
		name: tag.name,
		expectedOid: tag.oid,
		expectedTarget: tag.targetOid,
		remote: "origin",
		expectedUrl: "git@github.com:team/repo.git",
		expectedHead: repositorySnapshot().head.oid,
		expectedBranch: "main",
	});
	expect(root.renderer.findByTestId("tag-dialog")).toBeUndefined();
	expect(element("view-graph").customProps?.["aria-selected"]).toBe(true);
});

it("retains History guards for dirty work and merge commits while allowing metadata actions", async () => {
	show("light", 12, {
		readRepository: async () => ({
			ok: true,
			value: repositorySnapshot([changedFile("dirty.txt")]),
		}),
	});
	await open();
	await commitMenu("Revert commit…");

	for (const choice of [
		"Revert commit…",
		"Cherry-pick commit…",
		"Reset to commit…",
	])
		expect(menuEnabled[menuLabels.indexOf(choice)]).toBe(false);

	for (const choice of ["Create tag…", "Create branch here…"])
		expect(menuEnabled[menuLabels.indexOf(choice)]).toBe(true);

	expect(root.renderer.findByTestId("revert-dialog")).toBeUndefined();
	root.render(<div />);
	await settle();
	show();
	await open();
	await commitMenu("Cherry-pick commit…", 0);
	expect(menuEnabled[menuLabels.indexOf("Cherry-pick commit…")]).toBe(false);
	expect(menuEnabled[menuLabels.indexOf("Revert commit…")]).toBe(false);
	expect(root.renderer.findByTestId("cherry-pick-dialog")).toBeUndefined();
});

it("searches branch/tag names and filters history by the exact selected ref tip", async () => {
	show();
	await open();
	expect(root.renderer.findByTestId("graph-all-refs")).toBeUndefined();
	click("graph-kind-remote");
	click("entry-refs/remotes/origin/main");
	await settle();
	expect(readPage.mock.calls.at(-1)?.[1]).toEqual([commitInfo(29).oid]);
	expect(root.renderer.getAllText()).toContain("Show full graph");
	expect(root.renderer.findByTestId("entry-refs/heads/main")).toBeUndefined();
	click("graph-all-refs");
	await settle();
	expect(readPage.mock.calls.at(-1)?.[1]).toHaveLength(4);
	expect(root.renderer.findByTestId("graph-all-refs")).toBeUndefined();
	expect(root.renderer.getFocusedElementId()).toBe(
		element("graph-ref-search").id
	);
	click("graph-kind-all");
	click("graph-ref-search");
	root.renderer.simulateKeystrokes("s e a r c h");
	root.renderer.flush();
	expect(element("entry-refs/heads/feature/search")).toBeDefined();
	expect(
		root.renderer.findByTestId("entry-refs/remotes/origin/main")
	).toBeUndefined();
	expect(readFiles).not.toHaveBeenCalled();
});

it("aborts and ignores a late page after the reference changes", async () => {
	const pending =
		Promise.withResolvers<
			Awaited<ReturnType<typeof RepositoryGraphReader.page>>
		>();

	let signal: AbortSignal | undefined;

	readPage.mockImplementationOnce(async (_root, _tips, _offset, active) => {
		signal = active;

		return await pending.promise;
	});
	show();
	await open();
	click("entry-refs/heads/feature/search");
	await settle();
	expect(signal?.aborted).toBe(true);
	pending.resolve({ ok: true, value: historyPage(999, 1) });
	await settle();
	expect(
		root.renderer.findByTestId(`entry-${commitInfo(999).oid}`)
	).toBeUndefined();
	expect(element(`entry-${commits[0]!.oid}`)).toBeDefined();
});

it("retries a failed page and handles a repository with no refs or commits", async () => {
	readPage.mockImplementationOnce(async () => {
		throw new Error("Read interrupted");
	});
	show();
	await open();
	expect(root.renderer.getAllText()).toContain("Read interrupted");
	click("retry-graph-page");
	await settle();
	expect(element(`entry-${commits[0]!.oid}`)).toBeDefined();
	root.render(
		<RepositoryGraph
			root="/empty"
			head={null}
			version={0}
			readReferences={async () => ({
				ok: true,
				value: { references: [], head: null, tags: [] },
			})}
			readPage={async () => ({ ok: true, value: historyPage(0, 0) })}
		/>
	);
	await settle();
	expect(root.renderer.getAllText()).toContain("No commits yet");
});

it("buffers large histories and loads older pages without rendering every row in React", async () => {
	const pages = mock<typeof RepositoryGraphReader.page>(
		async (_root, _tips, offset) => ({
			ok: true,
			value: historyPage(offset, offset ? 20 : 600, offset === 0),
		})
	);

	root.render(
		<RepositoryGraph
			root="/large"
			head={references.head}
			version={0}
			readReferences={readReferences}
			readPage={pages}
		/>
	);
	await settle();
	expect(element("graph-commits").children.length).toBeLessThan(200);
	click("graph-load-more");
	await settle();
	expect(pages.mock.calls.at(-1)?.[2]).toBe(600);
	expect(root.renderer.getAllText()).toContain("620 commits");
	root.renderer.scrollToItem(element("graph-commits").id, 619, 0);
	root.renderer.flush();
	await settle();
	expect(element(`entry-${commitInfo(619).oid}`)).toBeDefined();
	expect(element("graph-commits").children.length).toBeLessThan(200);
});

it("retries refs and files independently while keeping the graph available", async () => {
	readReferences.mockImplementationOnce(async () => {
		throw new Error("Refs interrupted");
	});
	readFiles.mockImplementationOnce(async () => {
		throw new Error("Files interrupted");
	});
	show();
	await open();
	expect(root.renderer.getAllText()).toContain("Refs interrupted");
	click("retry-graph-refs");
	await settle();
	click(`entry-${commits[0]!.oid}`);
	await settle();
	expect(root.renderer.getAllText()).toContain("Files interrupted");
	click("retry-graph-files");
	await settle();
	expect(element("diff-header")).toBeDefined();
	expect(element(`entry-${commits[0]!.oid}`)).toBeDefined();
});

it("keeps graph controls and file previews usable at the minimum window size with 18pt text", async () => {
	root.unmount();
	root = createTestRoot({ width: 640, height: 420 });
	root.renderer.clockPause();
	spyOn(root.renderer, "promptForPaths").mockResolvedValue(["/test/project"]);
	show("light", 18);
	await open();
	click(`entry-${commits[0]!.oid}`);
	await settle();
	const sidebar = bounds("graph-sidebar");
	const close = bounds("graph-close-details");
	const viewport = bounds("graph-files-viewport");

	expect(
		bounds("graph-kind-tag").x + bounds("graph-kind-tag").width
	).toBeLessThanOrEqual(sidebar.x + sidebar.width);
	expect(close.x + close.width).toBeLessThanOrEqual(640);
	expect(viewport.height).toBeGreaterThan(24);
	expect(bounds(`graph-hash-${commits[0]!.oid}`).height).toBeLessThan(36);
	expect(bounds("diff-header").y).toBeLessThan(400);

	if (process.env.GPUIX_GRAPH_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_GRAPH_SCREENSHOT}-minimum-details.png`
		);

	click("graph-close-details");
	expect(root.renderer.findByTestId("graph-details-pane")).toBeUndefined();

	if (process.env.GPUIX_GRAPH_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_GRAPH_SCREENSHOT}-minimum.png`
		);
});

it("scrolls dense branch lanes horizontally", async () => {
	const dense = [
		...Array.from({ length: 30 }, (_, index) => ({
			...commitInfo(index + 1),
			parentOids: [commitInfo(index + 101).oid],
		})),
		...Array.from({ length: 30 }, (_, index) => ({
			...commitInfo(index + 101),
			parentOids: [commitInfo(0).oid],
		})),
		commitInfo(0),
	];

	// A narrow viewport needs horizontal scrolling to expose all concurrent lanes.
	root.unmount();
	root = createTestRoot({ width: 640, height: 420 });
	root.render(
		<RepositoryGraph
			root="/dense"
			head={references.head}
			version={0}
			readReferences={readReferences}
			readPage={async () => ({
				ok: true,
				value: { commits: dense, hasMore: false, nextOffset: null },
			})}
		/>
	);
	await settle();
	const horizontal = element("graph-horizontal-viewport");

	root.renderer.scrollTo(horizontal.id, -600, 0);
	root.renderer.flush();
	expect(root.renderer.getScrollOffset(horizontal.id)?.[0]).toBeLessThan(-100);
	expect(element("graph-table-scrollbar-horizontal")).toBeDefined();
	expect(root.renderer.findByTestId("graph-details-pane")).toBeUndefined();
});

const labelledReferences: GraphReferences = {
	...references,
	references: [
		{
			id: "refs/remotes/origin/ace/integration",
			name: "origin/ace/integration-with-a-long-remote-branch-name",
			oid: commitInfo(30).oid,
			kind: "remote",
			current: false,
		},
		{
			id: "refs/tags/v1.0.0-release-candidate",
			name: "v1.0.0-release-candidate",
			oid: commitInfo(30).oid,
			kind: "tag",
			current: false,
		},
		{
			id: "refs/heads/ace/integration",
			name: "ace/integration",
			oid: commitInfo(30).oid,
			kind: "local",
			current: true,
		},
	],
};

it("keeps HEAD and the current branch readable and reveals additional full names on hover and keyboard focus", async () => {
	readReferences.mockImplementationOnce(async () => ({
		ok: true,
		value: labelledReferences,
	}));
	show();
	await open();
	const oid = commitInfo(30).oid;
	const labels = `graph-labels-${oid}`;
	const head = bounds(`graph-badge-${oid}-HEAD`);
	const branch = bounds(`graph-badge-${oid}-refs/heads/ace/integration`);

	expect(head.width).toBeGreaterThan(30);
	expect(branch.width).toBeGreaterThan(head.width);
	expect(head.x + head.width).toBeLessThanOrEqual(branch.x);
	expect(element(`graph-more-labels-${oid}`)).toBeDefined();
	expect(root.renderer.getAllText()).toContain("+2");
	click(labels);
	await settle();
	expect(readFiles.mock.calls.at(-1)?.[1]).toBe(oid);
	const box = bounds(labels);

	root.renderer.nativeSimulateMouseMove(1100, box.y + box.height / 2);
	root.renderer.flush();
	await Bun.sleep(100);

	root.renderer.nativeSimulateMouseMove(
		box.x + box.width / 2,
		box.y + box.height / 2
	);
	root.renderer.flush();
	await Bun.sleep(400);
	await settle();
	expect(element(`graph-labels-tooltip-${oid}`).customProps?.role).toBe(
		"tooltip"
	);
	expect(root.renderer.getAllText()).toContain(
		"Remote branch: origin/ace/integration-with-a-long-remote-branch-name"
	);
	expect(root.renderer.getAllText()).toContain("Tag: v1.0.0-release-candidate");

	if (process.env.GPUIX_GRAPH_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_GRAPH_SCREENSHOT}-labels-tooltip.png`
		);

	root.renderer.nativeSimulateKeyDown(element(labels).id, "escape");
	root.renderer.flush();
	expect(
		root.renderer.findByTestId(`graph-labels-tooltip-${oid}`)
	).toBeUndefined();
	root.renderer.focusElement(element(labels).id);
	flushSync(() =>
		handleGpuixEvent(
			{ elementId: element(labels).id, eventType: "focus" },
			root.renderer
		)
	);
	await settle();
	expect(element(`graph-labels-tooltip-${oid}`)).toBeDefined();
});

it("keeps HEAD and the additional-label count visible with large text in a compact window", async () => {
	root.unmount();
	root = createTestRoot({ width: 640, height: 420 });
	root.renderer.clockPause();
	spyOn(root.renderer, "promptForPaths").mockResolvedValue(["/test/project"]);
	readReferences.mockImplementationOnce(async () => ({
		ok: true,
		value: labelledReferences,
	}));
	show("light", 18);
	await open();
	const oid = commitInfo(30).oid;
	const head = bounds(`graph-badge-${oid}-HEAD`);
	const more = bounds(`graph-more-labels-${oid}`);
	const viewport = bounds("graph-commits-viewport");

	expect(head.width).toBeGreaterThan(40);
	expect(head.height).toBeLessThan(36);
	expect(head.x + head.width).toBeLessThanOrEqual(more.x);
	expect(more.x + more.width).toBeLessThanOrEqual(viewport.x + viewport.width);
	expect(more.height).toBeLessThan(36);
});
