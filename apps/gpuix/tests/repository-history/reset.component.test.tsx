/**
 * Covers: History reset review/cancel/confirm, eligibility/stale/error states, duplicate writes and linked-tab refresh protection.
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
	ResetCommitResult,
} from "@1git/git";
import { App } from "../../src/app";
import { windowOptions } from "../../src/window-options";
import { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import {
	RepositoryHistoryReset,
	type HistoryResetReview,
} from "../../src/feature/repository-workspace/components/repository-history-reset";
import { RepositoryWorkspaceModel } from "../../src/feature/repository-workspace/lib/repository-workspace-model";
import {
	repositorySnapshot,
	changedFile,
} from "../_shared/repository-snapshot";
import { commitInfo } from "../_shared/history-page";

let root: TestRoot;
let snapshot: RepositorySnapshot;
let commits: readonly CommitInfo[];
let labels: string[];
let enabled: boolean[];
let blocked: boolean;

beforeEach(() => {
	root = createTestRoot({
		width: 1100,
		height: 760,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	commits = [0, 1, 2].map((index) => ({
		...commitInfo(index),
		parentOids: index < 2 ? [commitInfo(index + 1).oid] : [],
	}));
	snapshot = {
		...repositorySnapshot(),
		head: { ...repositorySnapshot().head, oid: commitInfo(0).oid },
	};
	labels = [];
	enabled = [];
	blocked = false;
	spyOn(RepositoryHistory, "readCommitLink").mockResolvedValue(null);
	Object.assign(root.renderer, {
		showContextMenuItems(nextLabels: string[], nextEnabled: boolean[]) {
			labels = nextLabels;
			enabled = nextEnabled;

			return labels.indexOf("Reset to commit…");
		},
		setCloseBlocked(value: boolean) {
			blocked = value;
		},
		takeCloseRequested() {
			return false;
		},
	});
});
afterEach(() => {
	root.unmount();
	mock.restore();
});

function renderApp(props: ComponentProps<typeof App> = {}) {
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
			readReset={async (_root, input) => ({
				ok: true,
				value: {
					target:
						commits.find((commit) => commit.oid === input.target) ??
						commitInfo(2),
					commitCount: 2,
				},
			})}
			resetCommit={async () => {
				throw new Error("Unexpected reset");
			}}
			{...props}
		/>
	);
}

async function settle() {
	for (let index = 0; index < 5; index++) {
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
function text(id: string): string {
	const visit = (nodeId: number): string => {
		const node = root.renderer.getElement(nodeId);

		return node ? (node.text ?? "") + node.children.map(visit).join("") : "";
	};

	return visit(element(id).id);
}
function click(id: string, button = 0) {
	const bounds = root.renderer.getElementBounds(element(id).id);

	if (!bounds) throw new Error(`Missing bounds ${id}`);

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2,
		button
	);
	root.renderer.flush();
}
async function history() {
	await settle();
	click("view-history");
	await settle();
}
async function menu(index = 2) {
	click(`entry-${commitInfo(index).oid}`, 2);
	await settle();
}

it("reviews the clicked target and cancels without a write", async () => {
	const write = mock<typeof RepositoryHistory.reset>();

	const read = mock<typeof RepositoryHistory.readReset>(async () => ({
		ok: true,
		value: { target: commitInfo(2), commitCount: 2 },
	}));

	renderApp({ resetCommit: write, readReset: read });
	await history();
	await menu();
	expect(read.mock.calls[0]?.[1]).toMatchObject({
		target: commitInfo(2).oid,
		expectedHead: commitInfo(0).oid,
		expectedBranch: "main",
	});
	expect(text("reset-count")).toContain("Undo 2 later commits");
	expect(text("reset-dialog")).toContain("Files stay unchanged");
	expect(write).not.toHaveBeenCalled();

	if (process.env.GPUIX_RESET_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_RESET_SCREENSHOT);

	click("reset-cancel");
	await settle();
	expect(root.renderer.findByTestId("reset-dialog")).toBeUndefined();
	expect(write).not.toHaveBeenCalled();
});

it("confirms once, shows restored Changes, refreshes History and retains the existing commit draft", async () => {
	const write = mock<typeof RepositoryHistory.reset>(async () => {
		snapshot = {
			...snapshot,
			head: { ...snapshot.head, oid: commitInfo(2).oid },
			files: [changedFile("restored.txt")],
		};
		commits = [commitInfo(2)];

		return {
			ok: true,
			value: { snapshot, recoveryRef: "refs/1git/reset/test", warning: null },
		};
	});

	renderApp({ resetCommit: write });
	await history();
	await menu();
	click("reset-confirm");
	await settle();
	expect(write).toHaveBeenCalledTimes(1);
	expect(write.mock.calls[0]?.[1]).toMatchObject({
		target: commitInfo(2).oid,
		expectedHead: commitInfo(0).oid,
		expectedBranch: "main",
	});
	expect(root.renderer.findByTestId("reset-dialog")).toBeUndefined();
	expect(text("repository-view-title")).toBe("Changes");
	expect(text("operation-result")).toContain("Branch reset. Changes kept");
	expect(element("commit-message").customProps?.value).toBe("Keep draft");
	expect(root.renderer.findByTestId("entry-restored.txt")).toBeDefined();
	click("view-history");
	await settle();
	expect(
		root.renderer.findByTestId(`entry-${commitInfo(0).oid}`)
	).toBeUndefined();
	expect(
		root.renderer.findByTestId(`entry-${commitInfo(2).oid}`)
	).toBeDefined();
});

it("disables the current tip and dirty work, and explains published history before allowing any write", async () => {
	const write = mock<typeof RepositoryHistory.reset>();

	renderApp({
		resetCommit: write,
		readReset: async () => ({
			ok: false,
			error: {
				operation: "reset",
				code: "invalid-input",
				retryable: false,
				message: "Later commits are published. Fetch and review again.",
			},
		}),
	});
	await history();
	await menu(0);
	expect(enabled[labels.indexOf("Reset to commit…")]).toBe(false);
	await menu();
	expect(text("reset-error")).toContain("published");
	click("reset-confirm");
	await settle();
	expect(write).not.toHaveBeenCalled();
	click("reset-cancel");
	await settle();
	snapshot = { ...snapshot, files: [changedFile("dirty.txt")] };
	click("view-changes");
	await settle();
	click("refresh-repository");
	await settle();
	click("view-history");
	await settle();
	await menu();
	expect(enabled[labels.indexOf("Reset to commit…")]).toBe(false);
	expect(write).not.toHaveBeenCalled();
});

it("invalidates a review after the branch tip changes", async () => {
	const state = RepositoryWorkspaceModel.reduce(
		RepositoryWorkspaceModel.create(),
		{ type: "loaded", snapshot }
	);

	const review: HistoryResetReview = {
		root: snapshot.repository.root,
		commit: commitInfo(2),
		input: {
			target: commitInfo(2).oid,
			expectedHead: commitInfo(0).oid,
			expectedBranch: "main",
		},
	};

	const read = mock<typeof RepositoryHistory.readReset>(async () => ({
		ok: true,
		value: { target: commitInfo(2), commitCount: 2 },
	}));

	const write = mock(async () => null);
	const cancel = mock(() => {});
	const finished = mock(() => {});

	root.render(
		<RepositoryHistoryReset
			state={state}
			review={review}
			read={read}
			onWrite={write}
			onCancel={cancel}
			onFinished={finished}
		/>
	);
	await settle();
	expect(text("reset-count")).toContain("Undo 2");
	const changed = RepositoryWorkspaceModel.reduce(state, {
		type: "loaded",
		snapshot: { ...snapshot, head: { ...snapshot.head, oid: "f".repeat(40) } },
	});

	root.render(
		<RepositoryHistoryReset
			state={changed}
			review={review}
			read={read}
			onWrite={write}
			onCancel={cancel}
			onFinished={finished}
		/>
	);
	await settle();
	expect(text("reset-error")).toContain("repository changed");
	click("reset-confirm");
	await settle();
	expect(write).not.toHaveBeenCalled();
	expect(finished).not.toHaveBeenCalled();
});

it("prevents duplicate writes, dismissal and close until linked worktree refresh completes", async () => {
	const pending = Promise.withResolvers<{
		ok: true;
		value: ResetCommitResult;
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

	const write = mock<typeof RepositoryHistory.reset>(
		async () => await pending.promise
	);

	renderApp({
		initialSession: {
			version: 1,
			activeId: "workspace-1",
			tabs: [
				{ id: "workspace-1", path: "/test/project", draft: "Keep draft" },
				{ id: "workspace-2", path: "/test/linked", draft: "Linked draft" },
			],
		},
		readRepository: read,
		resetCommit: write,
	});
	await history();
	await menu();
	click("reset-confirm");
	await settle();
	expect(blocked).toBe(true);
	click("reset-confirm");
	click("reset-cancel");
	root.renderer.nativeSimulateKeyDown(element("reset-confirm").id, "escape");
	await settle();
	expect(write).toHaveBeenCalledTimes(1);
	expect(root.renderer.findByTestId("reset-dialog")).toBeDefined();
	finished = true;
	snapshot = {
		...snapshot,
		head: { ...snapshot.head, oid: commitInfo(2).oid },
		files: [changedFile("restored.txt")],
	};
	pending.resolve({
		ok: true,
		value: { snapshot, recoveryRef: "refs/1git/reset/test", warning: null },
	});
	await settle();
	expect(blocked).toBe(true);
	refreshed.resolve({ ok: true, value: linked });
	await settle();
	expect(blocked).toBe(false);
	expect(root.renderer.findByTestId("reset-dialog")).toBeUndefined();
	expect(
		read.mock.calls.filter(([path]) => path === "/test/linked")
	).toHaveLength(2);
});

it("explains a failed or uncertain reset and refuses resubmission until a new review", async () => {
	const write = mock<typeof RepositoryHistory.reset>(async () => ({
		ok: true,
		value: {
			snapshot: null,
			recoveryRef: "refs/1git/reset/test",
			warning:
				"Reset completed; refresh failed. Inspect History before retrying.",
		},
	}));

	renderApp({ resetCommit: write });
	await history();
	await menu();
	click("reset-confirm");
	await settle();
	expect(text("reset-error")).toContain("Inspect History");
	click("reset-confirm");
	await settle();
	expect(write).toHaveBeenCalledTimes(1);
	expect(blocked).toBe(false);
});

it("aborts a pending review when cancelled and never enables a write from its late result", async () => {
	const pending =
		Promise.withResolvers<
			Awaited<ReturnType<typeof RepositoryHistory.readReset>>
		>();

	let signal: AbortSignal | undefined;

	const read = mock<typeof RepositoryHistory.readReset>(
		async (_root, input) => {
			signal = input.signal;

			return await pending.promise;
		}
	);

	const write = mock<typeof RepositoryHistory.reset>();

	renderApp({ readReset: read, resetCommit: write });
	await history();
	await menu();
	click("reset-confirm");
	await settle();
	expect(write).not.toHaveBeenCalled();
	click("reset-cancel");
	await settle();
	expect(signal?.aborted).toBe(true);
	pending.resolve({
		ok: true,
		value: { target: commitInfo(2), commitCount: 2 },
	});
	await settle();
	expect(root.renderer.findByTestId("reset-dialog")).toBeUndefined();
	expect(write).not.toHaveBeenCalled();
});
