/**
 * Covers: History range selection, review/cancel/confirm, message edits, eligibility errors, replay disclosure and shared-worktree write/refresh protection.
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
	SquashCommitsResult,
} from "@1git/git";
import { App } from "../../src/app";
import { windowOptions } from "../../src/window-options";
import { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import { RepositoryHistorySquash } from "../../src/feature/repository-workspace/lib/repository-history-squash";
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
let choice: string;

beforeEach(() => {
	root = createTestRoot({
		width: 1100,
		height: 760,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	commits = [0, 1, 2, 3].map((index) => ({
		...commitInfo(index),
		body: `Commit ${index}\n\nDetails ${index}`,
		parentOids: index < 3 ? [commitInfo(index + 1).oid] : [],
	}));
	snapshot = {
		...repositorySnapshot(),
		head: { ...repositorySnapshot().head, oid: commitInfo(0).oid },
	};
	labels = [];
	enabled = [];
	blocked = false;
	choice = "Squash selected commits…";
	spyOn(RepositoryHistory, "readCommitLink").mockResolvedValue(null);
	Object.assign(root.renderer, {
		showContextMenuItems(nextLabels: string[], nextEnabled: boolean[]) {
			labels = nextLabels;
			enabled = nextEnabled;

			return labels.indexOf(choice);
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
			readSquash={async (_root, input) => ({
				ok: true,
				value: {
					commits: commits.filter((commit) =>
						input.commits.includes(commit.oid)
					),
					replay: [commits[0] ?? commitInfo(0)],
				},
			})}
			squashCommits={async () => {
				throw new Error("Unexpected squash");
			}}
			{...props}
		/>
	);
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
async function selectRange() {
	click(`entry-${commitInfo(1).oid}`);
	click(`entry-${commitInfo(2).oid}`, 0, "shift");
	await settle();
}
async function menu(index = 2) {
	click(`entry-${commitInfo(index).oid}`, 2);
	await settle();
}

it("selects a consecutive range with Shift or keyboard, reviews it and cancels without writes", async () => {
	const write = mock<typeof RepositoryHistorySquash.write>();

	renderApp({ squashCommits: write });
	await history();
	click(`entry-${commitInfo(1).oid}`);
	root.renderer.simulateKeystrokes("shift-down");
	await settle();
	expect(
		element(`entry-${commitInfo(1).oid}`).customProps?.["aria-selected"]
	).toBe(true);
	expect(
		element(`entry-${commitInfo(2).oid}`).customProps?.["aria-selected"]
	).toBe(true);
	await menu();
	expect(text("squash-dialog")).toContain("Squash 2 commits");
	expect(text("squash-replay")).toContain("1 later commit");
	expect(write).not.toHaveBeenCalled();

	if (process.env.GPUIX_SQUASH_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_SQUASH_SCREENSHOT);

	click("squash-cancel");
	await settle();
	expect(root.renderer.findByTestId("squash-dialog")).toBeUndefined();
	expect(write).not.toHaveBeenCalled();
});

it("edits the message and squashes exactly the reviewed commits, retaining the ordinary draft and History view", async () => {
	const write = mock<typeof RepositoryHistorySquash.write>(async () => {
		const oid = "e".repeat(40);

		snapshot = { ...snapshot, head: { ...snapshot.head, oid } };
		commits = [{ ...commitInfo(0), oid, summary: "Combined" }];

		return {
			ok: true,
			value: {
				oid,
				snapshot,
				recoveryRef: "refs/1git/squash/test",
				warning: null,
			},
		};
	});

	renderApp({ squashCommits: write });
	await history();
	await selectRange();
	await menu();
	click("squash-summary");
	root.renderer.simulateKeystrokes("cmd-a");
	root.renderer.simulateKeystrokes("C o m b i n e d");
	await settle();
	click("squash-confirm");
	await settle();
	expect(write).toHaveBeenCalledTimes(1);
	expect(write.mock.calls[0]?.[1]).toMatchObject({
		commits: [commitInfo(1).oid, commitInfo(2).oid],
		expectedHead: commitInfo(0).oid,
		expectedBranch: "main",
		message: "Combined\n\nDetails 2\n\nCommit 1\n\nDetails 1",
	});
	expect(root.renderer.findByTestId("squash-dialog")).toBeUndefined();
	expect(text("repository-view-title")).toBe("History");
	expect(text("operation-result")).toContain("Squashed 2 commits");
	click("view-changes");
	await settle();
	expect(element("commit-message").customProps?.value).toBe("Keep draft");
});

it("disables a single/nonconsecutive selection and dirty work, while review failures explain publication without writing", async () => {
	const write = mock<typeof RepositoryHistorySquash.write>();

	const read = mock<typeof RepositoryHistorySquash.read>(async () => ({
		ok: false,
		error: {
			operation: "squash-commits",
			code: "invalid-input",
			retryable: false,
			message: "These commits are published. Fetch and review again.",
		},
	}));

	renderApp({ squashCommits: write, readSquash: read });
	await history();
	await menu(1);
	expect(enabled[labels.indexOf(choice)]).toBe(false);
	click(`entry-${commitInfo(0).oid}`);
	click(`entry-${commitInfo(2).oid}`, 0, "cmd");
	await settle();
	await menu();
	expect(enabled[labels.indexOf(choice)]).toBe(false);
	await selectRange();
	await menu();
	expect(text("squash-error")).toContain("published");
	click("squash-confirm");
	await settle();
	expect(write).not.toHaveBeenCalled();
	click("squash-cancel");
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
	expect(enabled[labels.indexOf(choice)]).toBe(false);
});

it("blocks duplicate submits, closing and cancellation until the write and refresh finish", async () => {
	const pending = Promise.withResolvers<{
		ok: true;
		value: SquashCommitsResult;
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

	const write = mock<typeof RepositoryHistorySquash.write>(
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
		squashCommits: write,
	});
	await history();
	await selectRange();
	await menu();
	click("squash-confirm");
	await settle();
	expect(blocked).toBe(true);
	click("squash-confirm");
	click("squash-cancel");
	root.renderer.nativeSimulateKeyDown(element("squash-confirm").id, "escape");
	await settle();
	expect(write).toHaveBeenCalledTimes(1);
	expect(root.renderer.findByTestId("squash-dialog")).toBeDefined();
	finished = true;
	pending.resolve({
		ok: true,
		value: {
			oid: snapshot.head.oid ?? "",
			snapshot,
			recoveryRef: "refs/1git/squash/test",
			warning: null,
		},
	});
	await settle();
	expect(blocked).toBe(true);
	refreshed.resolve({ ok: true, value: linked });
	await settle();
	expect(root.renderer.findByTestId("squash-dialog")).toBeUndefined();
	expect(blocked).toBe(false);
	expect(
		read.mock.calls.filter(([path]) => path === "/test/linked")
	).toHaveLength(2);
});

it("keeps failed messages and refuses a second write until a fresh review", async () => {
	const write = mock<typeof RepositoryHistorySquash.write>(async () => ({
		ok: false,
		error: {
			code: "command-failed",
			operation: "squash-commits",
			retryable: false,
			message: "Hook rejected the squash. Original branch unchanged.",
		},
	}));

	renderApp({ squashCommits: write });
	await history();
	await selectRange();
	await menu();
	click("squash-confirm");
	await settle();
	expect(text("squash-error")).toContain("Hook rejected");
	expect(element("squash-summary").customProps?.value).toBe("Commit 2");
	click("squash-confirm");
	await settle();
	expect(write).toHaveBeenCalledTimes(1);
	expect(blocked).toBe(false);
});
