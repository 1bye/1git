/**
 * Covers: range review, order controls/keyboard, confirmation, eligibility/failure guards, draft retention and shared-worktree protection.
 * Real: App, reducers, window-owned mutations and native GPUIX controls/focus/layout.
 * Doubles: Git reads/writes and AppKit menu selection; no repository or network writes.
 * Requires: patched GPUIX/macOS graphics.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import type { ComponentProps } from "react";
import type {
	CommitInfo,
	RepositorySnapshot,
	ReorderCommitsResult,
	ReorderPlan,
} from "@1git/git";
import { App } from "../../src/app";
import { windowOptions } from "../../src/window-options";
import { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import {
	RepositoryHistoryReorder,
	type HistoryReorderReview,
} from "../../src/feature/repository-workspace/components/repository-history-reorder";
import { RepositoryWorkspaceModel } from "../../src/feature/repository-workspace/lib/repository-workspace-model";
import {
	repositorySnapshot,
	changedFile,
} from "../_shared/repository-snapshot";
import { commitInfo } from "../_shared/history-page";

let root: TestRoot;
let snapshot: RepositorySnapshot;
let commits: readonly CommitInfo[];
const choice = "Reorder selected commits…";

beforeEach(() => {
	root = createTestRoot({
		width: 1100,
		height: 760,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	commits = [0, 1, 2, 3].map((index) => ({
		...commitInfo(index),
		parentOids: index < 3 ? [commitInfo(index + 1).oid] : [],
	}));
	snapshot = {
		...repositorySnapshot(),
		head: { ...repositorySnapshot().head, oid: commitInfo(0).oid },
	};
	spyOn(RepositoryHistory, "readCommitLink").mockResolvedValue(null);
});
afterEach(() => {
	root.unmount();
	mock.restore();
});

function renderApp(props: ComponentProps<typeof App> = {}) {
	const menuState: { labels: string[]; enabled: boolean[]; blocked: boolean } =
		{ labels: [], enabled: [], blocked: false };

	Object.assign(root.renderer, {
		showContextMenuItems(labels: string[], enabled: boolean[]) {
			menuState.labels = labels;
			menuState.enabled = enabled;

			return labels.indexOf(choice);
		},
		setCloseBlocked(value: boolean) {
			menuState.blocked = value;
		},
		takeCloseRequested() {
			return false;
		},
	});
	root.render(
		<App
			initialSession={{
				version: 1,
				activeId: "workspace-1",
				tabs: [
					{ id: "workspace-1", path: "/test/project", draft: "Keep draft" },
				],
			}}
			readRepository={async () => ({ ok: true, value: snapshot })}
			readHistory={async () => ({
				ok: true,
				value: { commits, hasMore: false, nextOffset: null },
			})}
			readCommitFiles={async () => ({ ok: true, value: [] })}
			readTags={async () => ({ ok: true, value: [] })}
			readLastCommit={async () => ({
				ok: true,
				value: { commit: commitInfo(0), undoUnavailableReason: null },
			})}
			readReorder={async (_root, input) => ({
				ok: true,
				value: {
					commits: commits.filter((commit) =>
						input.commits.includes(commit.oid)
					),
					replay: [commits[0] ?? commitInfo(0)],
				},
			})}
			reorderCommits={async () => {
				throw new Error("Unexpected reorder");
			}}
			{...props}
		/>
	);

	return menuState;
}
async function settle() {
	for (let i = 0; i < 5; i++) {
		await Bun.sleep(10);
		root.renderer.flush();
	}

	root.renderer.clockFastForward(250);
	root.renderer.flush();
	root.renderer.advanceTime(1);
	root.renderer.flush();
}
function element(id: string) {
	const node = root.renderer.findByTestId(id);

	if (!node) throw new Error(`Missing ${id}`);

	return node;
}
function text(id: string) {
	const visit = (nodeId: number): string => {
		const node = root.renderer.getElement(nodeId);

		return node ? (node.text ?? "") + node.children.map(visit).join("") : "";
	};

	return visit(element(id).id);
}
function click(id: string, button = 0, modifiers?: string) {
	const bounds = root.renderer.getElementBounds(element(id).id);

	if (!bounds) throw new Error(`Missing bounds ${id}`);

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2,
		button,
		modifiers
	);
	root.renderer.flush();
}
async function history() {
	await settle();
	click("view-history");
	await settle();
}
async function selectRange(first = 1, last = 2) {
	click(`entry-${commitInfo(first).oid}`);
	click(`entry-${commitInfo(last).oid}`, 0, "shift");
	await settle();
}
async function menu(index = 2) {
	click(`entry-${commitInfo(index).oid}`, 2);
	await settle();
}

it("reviews a consecutive keyboard selection, keeps original order until moved and cancels without writes", async () => {
	const write = mock<typeof RepositoryHistory.reorder>();

	renderApp({ reorderCommits: write });
	await history();
	click(`entry-${commitInfo(1).oid}`);
	root.renderer.simulateKeystrokes("shift-down");
	await settle();
	await menu();
	expect(text("reorder-dialog")).toContain("Reorder 2 commits");
	expect(text("reorder-replay")).toContain("1 later commit");
	click("reorder-confirm");
	await settle();
	expect(write).not.toHaveBeenCalled();
	click("reorder-later");
	await settle();
	expect(text("reorder-list").indexOf("Commit 1")).toBeLessThan(
		text("reorder-list").indexOf("Commit 2")
	);
	click("reorder-earlier");
	await settle();
	expect(text("reorder-list").indexOf("Commit 2")).toBeLessThan(
		text("reorder-list").indexOf("Commit 1")
	);

	if (process.env.GPUIX_REORDER_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_REORDER_SCREENSHOT);

	click("reorder-cancel");
	await settle();
	expect(root.renderer.findByTestId("reorder-dialog")).toBeUndefined();
	expect(write).not.toHaveBeenCalled();
});

it("confirms exactly the captured range and new oldest-first order, preserving the draft and History view", async () => {
	const write = mock<typeof RepositoryHistory.reorder>(async () => {
		const oid = "e".repeat(40);

		snapshot = { ...snapshot, head: { ...snapshot.head, oid } };
		commits = [{ ...commitInfo(0), oid, summary: "Replayed tip" }];

		return {
			ok: true,
			value: {
				oid,
				snapshot,
				recoveryRef: "refs/1git/reorder/test",
				warning: null,
			},
		};
	});

	renderApp({ reorderCommits: write });
	await history();
	await selectRange();
	await menu();
	click("reorder-later");
	await settle();
	click("reorder-confirm");
	await settle();
	expect(write).toHaveBeenCalledTimes(1);
	expect(write.mock.calls[0]?.[1]).toMatchObject({
		commits: [commitInfo(1).oid, commitInfo(2).oid],
		order: [commitInfo(1).oid, commitInfo(2).oid],
		expectedHead: commitInfo(0).oid,
		expectedBranch: "main",
	});
	expect(root.renderer.findByTestId("reorder-dialog")).toBeUndefined();
	expect(text("repository-view-title")).toBe("History");
	expect(text("operation-result")).toContain("Reordered 2 commits");
	click("view-changes");
	await settle();
	expect(element("commit-message").customProps?.value).toBe("Keep draft");
});

it("disables single/nonconsecutive ranges and dirty work and explains published review failures", async () => {
	const write = mock<typeof RepositoryHistory.reorder>();

	const read = mock<typeof RepositoryHistory.readReorder>(async () => ({
		ok: false,
		error: {
			operation: "reorder-commits",
			code: "invalid-input",
			retryable: false,
			message: "These commits are published. Fetch and review again.",
		},
	}));

	const menuState = renderApp({ reorderCommits: write, readReorder: read });

	await history();
	await menu(1);
	expect(menuState.enabled[menuState.labels.indexOf(choice)]).toBe(false);
	click(`entry-${commitInfo(0).oid}`);
	click(`entry-${commitInfo(2).oid}`, 0, "cmd");
	await settle();
	await menu();
	expect(menuState.enabled[menuState.labels.indexOf(choice)]).toBe(false);
	await selectRange();
	await menu();
	expect(text("reorder-error")).toContain("published");
	click("reorder-later");
	click("reorder-confirm");
	await settle();
	expect(write).not.toHaveBeenCalled();
	click("reorder-cancel");
	await settle();
	snapshot = { ...snapshot, files: [changedFile("dirty.txt")] };
	click("view-changes");
	await settle();
	click("refresh-repository");
	await settle();
	click("view-history");
	await settle();
	await selectRange();
	await menu();
	expect(menuState.enabled[menuState.labels.indexOf(choice)]).toBe(false);
});

it("blocks duplicate submission and closing through the write and linked-worktree refresh", async () => {
	const pending = Promise.withResolvers<{
		ok: true;
		value: ReorderCommitsResult;
	}>();

	const refreshed = Promise.withResolvers<{
		ok: true;
		value: RepositorySnapshot;
	}>();

	const linked = {
		...snapshot,
		repository: { ...snapshot.repository, root: "/test/linked" },
		head: { ...snapshot.head, branch: "linked" },
	};

	let finished = false;

	const read = mock(async (path: string) =>
		path === "/test/linked"
			? finished
				? await refreshed.promise
				: { ok: true as const, value: linked }
			: { ok: true as const, value: snapshot }
	);

	const write = mock<typeof RepositoryHistory.reorder>(
		async () => await pending.promise
	);

	const menuState = renderApp({
		initialSession: {
			version: 1,
			activeId: "workspace-1",
			tabs: [
				{ id: "workspace-1", path: "/test/project", draft: "Keep draft" },
				{ id: "workspace-2", path: "/test/linked", draft: "Linked draft" },
			],
		},
		readRepository: read,
		reorderCommits: write,
	});

	await history();
	await selectRange();
	await menu();
	click("reorder-later");
	await settle();
	click("reorder-confirm");
	await settle();
	expect(menuState.blocked).toBe(true);
	click("reorder-confirm");
	click("reorder-cancel");
	root.renderer.nativeSimulateKeyDown(element("reorder-confirm").id, "escape");
	await settle();
	expect(write).toHaveBeenCalledTimes(1);
	expect(root.renderer.findByTestId("reorder-dialog")).toBeDefined();
	finished = true;
	pending.resolve({
		ok: true,
		value: {
			oid: snapshot.head.oid ?? "",
			snapshot,
			recoveryRef: "refs/1git/reorder/test",
			warning: null,
		},
	});
	await settle();
	expect(menuState.blocked).toBe(true);
	refreshed.resolve({ ok: true, value: linked });
	await settle();
	expect(root.renderer.findByTestId("reorder-dialog")).toBeUndefined();
	expect(menuState.blocked).toBe(false);
	expect(
		read.mock.calls.filter(([path]) => path === "/test/linked")
	).toHaveLength(2);
});

it("retains a failed order, explains replay conflicts and requires a fresh review before another write", async () => {
	const write = mock<typeof RepositoryHistory.reorder>(async () => ({
		ok: false,
		error: {
			code: "conflict",
			operation: "reorder-commits",
			retryable: false,
			message:
				"Reordering caused a replay conflict. Original branch unchanged.",
		},
	}));

	const menuState = renderApp({ reorderCommits: write });

	await history();
	await selectRange();
	await menu();
	click("reorder-later");
	await settle();
	click("reorder-confirm");
	await settle();
	expect(text("reorder-error")).toContain("replay conflict");
	expect(text("reorder-list").indexOf("Commit 1")).toBeLessThan(
		text("reorder-list").indexOf("Commit 2")
	);
	click("reorder-confirm");
	await settle();
	expect(write).toHaveBeenCalledTimes(1);
	expect(menuState.blocked).toBe(false);
});

it("keeps a selected root first while allowing its following commits to move", async () => {
	const state = RepositoryWorkspaceModel.reduce(
		RepositoryWorkspaceModel.create(),
		{ type: "loaded", snapshot }
	);

	const review: HistoryReorderReview = {
		root: snapshot.repository.root,
		commits: commits.slice(1),
		input: {
			expectedHead: commitInfo(0).oid,
			expectedBranch: "main",
			commits: commits.slice(1).map((commit) => commit.oid),
			order: commits
				.slice(1)
				.reverse()
				.map((commit) => commit.oid),
		},
	};

	const read = mock<typeof RepositoryHistory.readReorder>(async () => ({
		ok: true,
		value: { commits: review.commits, replay: [commitInfo(0)] },
	}));

	const write = mock(async () => null);

	root.render(
		<RepositoryHistoryReorder
			state={state}
			review={review}
			read={read}
			onWrite={write}
			onCancel={() => {}}
			onFinished={() => {}}
		/>
	);
	await settle();
	click(`entry-${commitInfo(3).oid}`);
	click("reorder-later");
	await settle();
	expect(text("reorder-list").indexOf("Commit 3")).toBeLessThan(
		text("reorder-list").indexOf("Commit 2")
	);
	click(`entry-${commitInfo(3).oid}`);
	root.renderer.simulateKeystrokes("down");
	await settle();
	expect(
		element(`entry-${commitInfo(2).oid}`).customProps?.["aria-selected"]
	).toBe(true);
	click("reorder-earlier");
	await settle();
	expect(text("reorder-list").indexOf("Commit 3")).toBeLessThan(
		text("reorder-list").indexOf("Commit 2")
	);
	click("reorder-later");
	await settle();
	expect(text("reorder-list").indexOf("Commit 1")).toBeLessThan(
		text("reorder-list").indexOf("Commit 2")
	);
	expect(write).not.toHaveBeenCalled();
});

it("invalidates captured reviews when root, HEAD or branch changes or work becomes dirty", async () => {
	const state = RepositoryWorkspaceModel.reduce(
		RepositoryWorkspaceModel.create(),
		{ type: "loaded", snapshot }
	);

	const review: HistoryReorderReview = {
		root: snapshot.repository.root,
		commits: commits.slice(1, 3),
		input: {
			expectedHead: commitInfo(0).oid,
			expectedBranch: "main",
			commits: [commitInfo(1).oid, commitInfo(2).oid],
			order: [commitInfo(2).oid, commitInfo(1).oid],
		},
	};

	const read = mock<typeof RepositoryHistory.readReorder>(async () => ({
		ok: true,
		value: { commits: review.commits, replay: [commitInfo(0)] },
	}));

	const write = mock(async () => null);
	const finished = mock(() => {});

	const render = (current: typeof state) =>
		root.render(
			<RepositoryHistoryReorder
				state={current}
				review={review}
				read={read}
				onWrite={write}
				onCancel={() => {}}
				onFinished={finished}
			/>
		);

	render(state);
	await settle();
	click("reorder-later");
	await settle();

	for (const changed of [
		{ ...snapshot, head: { ...snapshot.head, oid: "f".repeat(40) } },
		{ ...snapshot, head: { ...snapshot.head, branch: "other" } },
		{
			...snapshot,
			repository: { ...snapshot.repository, root: "/test/other" },
		},
		{ ...snapshot, files: [changedFile("dirty.txt")] },
	]) {
		render(
			RepositoryWorkspaceModel.reduce(state, {
				type: "loaded",
				snapshot: changed,
			})
		);
		await settle();
		expect(text("reorder-error")).toContain("repository changed");
		click("reorder-confirm");
		await settle();
	}

	expect(write).not.toHaveBeenCalled();
	expect(finished).not.toHaveBeenCalled();
});

it("aborts cancelled reviews and ignores their late results", async () => {
	const pending = Promise.withResolvers<{ ok: true; value: ReorderPlan }>();
	let signal: AbortSignal | undefined;

	const read = mock<typeof RepositoryHistory.readReorder>(
		async (_root, input) => {
			signal = input.signal;

			return await pending.promise;
		}
	);

	const write = mock<typeof RepositoryHistory.reorder>();

	renderApp({ readReorder: read, reorderCommits: write });
	await history();
	await selectRange();
	await menu();
	click("reorder-later");
	click("reorder-confirm");
	await settle();
	expect(write).not.toHaveBeenCalled();
	click("reorder-cancel");
	await settle();
	expect(signal?.aborted).toBe(true);
	pending.resolve({
		ok: true,
		value: { commits: commits.slice(1, 3), replay: [commitInfo(0)] },
	});
	await settle();
	expect(root.renderer.findByTestId("reorder-dialog")).toBeUndefined();
	expect(write).not.toHaveBeenCalled();
});

it("requires inspection after a successful rewrite with a warning instead of retrying", async () => {
	const write = mock<typeof RepositoryHistory.reorder>(async () => ({
		ok: true,
		value: {
			oid: "e".repeat(40),
			recoveryRef: "refs/1git/reorder/test",
			snapshot: null,
			warning:
				"Reorder completed; refresh failed. Inspect History before retrying.",
		},
	}));

	renderApp({ reorderCommits: write });
	await history();
	await selectRange();
	await menu();
	click("reorder-later");
	await settle();
	click("reorder-confirm");
	await settle();
	expect(text("reorder-error")).toContain("Reorder completed");
	click("reorder-confirm");
	await settle();
	expect(write).toHaveBeenCalledTimes(1);
});
