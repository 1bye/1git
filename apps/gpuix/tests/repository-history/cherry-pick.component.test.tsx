/**
 * Covers: clicked-commit destination selection, cancellation, filtering/keyboard input, eligibility, shared locks and conflict recovery.
 * Real: App, reducers, mutation coordination and native GPUIX rendering/events.
 * Doubles: Git readers/writers, AppKit menu choice and native close notifications; no actual Git writes.
 * Requires: patched GPUIX/macOS graphics.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import type { BranchInfo, RepositorySnapshot } from "@1git/git";
import { App } from "../../src/app";
import { windowOptions } from "../../src/window-options";
import { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import { RepositoryOperation } from "../../src/feature/repository-workspace/lib/repository-operation";
import { RepositoryBranches } from "../../src/feature/workspace-tabs/lib/repository-branches";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";
import { commitInfo, historyPage } from "../_shared/history-page";

let root: TestRoot;
let snapshot: RepositorySnapshot;
let menuLabels: string[];
let menuEnabled: boolean[];
let blocked: boolean;

beforeEach(() => {
	root = createTestRoot({
		width: 1100,
		height: 760,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	snapshot = repositorySnapshot();
	menuLabels = [];
	menuEnabled = [];
	blocked = false;
	spyOn(RepositoryHistory, "readCommitLink").mockResolvedValue(null);
	Object.assign(root.renderer, {
		showContextMenuItems(labels: string[], enabled: boolean[]) {
			menuLabels = labels;
			menuEnabled = enabled;

			return labels.indexOf("Cherry-pick commit…");
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

const session = {
	version: 1 as const,
	activeId: "workspace-1",
	tabs: [{ id: "workspace-1", path: "/test/project", draft: "Keep draft" }],
};

const branch = (
	name: string,
	worktreePath: string | null = null
): BranchInfo => ({
	name,
	fullName: `refs/heads/${name}`,
	oid: "b".repeat(40),
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

const readBranches: typeof RepositoryBranches.read = async () => ({
	ok: true,
	value: {
		branches: {
			current: "main",
			branches: [
				branch("main", "/test/project"),
				branch("destination"),
				branch("linked", "/test/linked"),
				{ ...branch("origin/remote"), type: "remote" },
			],
		},
		worktrees: [],
		remotes: [],
	},
});

const readHistory: typeof RepositoryHistory.read = async () => ({
	ok: true,
	value: historyPage(0, 3),
});

const readCommitFiles: typeof RepositoryHistory.readFiles = async () => ({
	ok: true,
	value: [],
});

const readRepository = async () => ({ ok: true as const, value: snapshot });

const settle = async () => {
	for (let i = 0; i < 5; i++) {
		await Bun.sleep(10);
		root.renderer.flush();
	}

	root.renderer.clockFastForward(250);
	root.renderer.flush();
	root.renderer.advanceTime(1);
	root.renderer.flush();
};

const element = (id: string) => {
	const node = root.renderer.findByTestId(id);

	if (!node) throw new Error(`Missing ${id}`);

	return node;
};

const click = (id: string, button = 0, modifiers = "") => {
	const bounds = root.renderer.getElementBounds(element(id).id);

	if (!bounds) throw new Error(`Missing bounds for ${id}`);

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2,
		button,
		modifiers
	);
	root.renderer.flush();
};

const open = async () => {
	await settle();
	click("view-history");
	await settle();
	click(`entry-${commitInfo(2).oid}`);
	click(`entry-${commitInfo(1).oid}`, 2);
	await settle();
};

const text = (id: string) =>
	element(id)
		.children.map((id) => root.renderer.getElement(id)?.text)
		.join("");

it("reviews the clicked commit, requires an available destination, cancels safely, then submits exact tips", async () => {
	const write = mock<typeof RepositoryHistory.cherryPick>(
		async (_root, input) => {
			snapshot = {
				...repositorySnapshot(),
				head: {
					...repositorySnapshot().head,
					branch: input.targetBranch,
					oid: "c".repeat(40),
				},
			};

			return { ok: true, value: snapshot };
		}
	);

	root.render(
		<App
			initialSession={session}
			readRepository={readRepository}
			readHistory={readHistory}
			readCommitFiles={readCommitFiles}
			readBranches={readBranches}
			cherryPickCommit={write}
		/>
	);
	await open();

	expect(text("cherry-pick-commit")).toBe("Commit 1");

	for (const excluded of ["main", "linked", "origin/remote"])
		expect(
			root.renderer.findByTestId(`entry-cherry-pick-refs/heads/${excluded}`)
		).toBeUndefined();

	click("cherry-pick-confirm");
	expect(write).not.toHaveBeenCalled();
	click("cherry-pick-cancel");
	await settle();
	expect(root.renderer.findByTestId("cherry-pick-dialog")).toBeUndefined();
	expect(
		element(`entry-${commitInfo(2).oid}`).customProps?.["aria-selected"]
	).toBe(true);
	click(`entry-${commitInfo(1).oid}`, 0, "ctrl");
	await settle();
	click("entry-cherry-pick-refs/heads/destination");
	await settle();
	expect(text("cherry-pick-summary")).toContain("Switch to destination");

	if (process.env.GPUIX_CHERRY_PICK_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_CHERRY_PICK_SCREENSHOT);

	click("cherry-pick-confirm");
	await settle();

	expect(write).toHaveBeenCalledTimes(1);
	expect(write.mock.calls[0]).toMatchObject([
		"/test/project",
		{
			commit: commitInfo(1).oid,
			expectedHead: "1234567890abcdef",
			expectedBranch: "main",
			targetBranch: "destination",
			expectedTarget: "b".repeat(40),
		},
	]);
	expect(root.renderer.findByTestId("cherry-pick-dialog")).toBeUndefined();
	expect(text("operation-result")).toContain("cherry-picked onto destination");
	expect(element("commit-message").customProps?.value).toBe("Keep draft");
});

it("supports filtering and keyboard selection without retaining a hidden destination", async () => {
	const write = mock<typeof RepositoryHistory.cherryPick>(async () => ({
		ok: true,
		value: repositorySnapshot(),
	}));

	root.render(
		<App
			initialSession={session}
			readRepository={readRepository}
			readHistory={readHistory}
			readCommitFiles={readCommitFiles}
			readBranches={readBranches}
			cherryPickCommit={write}
		/>
	);
	await open();
	click("entry-cherry-pick-refs/heads/destination");
	await settle();
	const search = element("cherry-pick-search");

	root.renderer.focusElement(search.id);
	root.renderer.simulateKeystrokes("m i s s i n g");
	await settle();
	click("cherry-pick-confirm");
	expect(write).not.toHaveBeenCalled();
	root.renderer.focusElement(search.id);
	root.renderer.simulateKeystrokes("cmd-a d e s t");
	await settle();
	root.renderer.nativeSimulateKeyDown(search.id, "down");
	await settle();
	const destination = element("entry-cherry-pick-refs/heads/destination");

	root.renderer.nativeSimulateKeyDown(destination.id, "enter");
	await settle();
	expect(write).toHaveBeenCalledTimes(1);
});

for (const unavailable of [
	"dirty",
	"detached",
	"operation",
	"merge",
] as const) {
	it(`disables cherry-pick for ${unavailable} History without a write`, async () => {
		if (unavailable === "dirty")
			snapshot = repositorySnapshot([changedFile("a.txt")]);

		if (unavailable === "detached")
			snapshot = {
				...snapshot,
				head: { ...snapshot.head, branch: null, detached: true },
			};

		if (unavailable === "operation")
			snapshot = {
				...snapshot,
				operationState: "cherry-pick",
				operationToken: "paused",
			};

		const write = mock<typeof RepositoryHistory.cherryPick>();

		root.render(
			<App
				initialSession={session}
				readRepository={readRepository}
				readHistory={async () => {
					const page = historyPage(0, 3);

					return {
						ok: true,
						value: {
							...page,
							commits: page.commits.map((commit) => ({
								...commit,
								parentOids: unavailable === "merge" ? ["a", "b"] : [],
							})),
						},
					};
				}}
				readCommitFiles={readCommitFiles}
				readBranches={readBranches}
				cherryPickCommit={write}
			/>
		);
		await open();

		expect(menuEnabled[menuLabels.indexOf("Cherry-pick commit…")]).toBe(false);
		expect(root.renderer.findByTestId("cherry-pick-dialog")).toBeUndefined();
		expect(write).not.toHaveBeenCalled();
	});
}

it("protects every linked tab through the write and refresh, then exposes Continue/Abort on conflict", async () => {
	let finished = false;

	const pending =
		Promise.withResolvers<
			Awaited<ReturnType<typeof RepositoryHistory.cherryPick>>
		>();

	const refresh = Promise.withResolvers<{
		ok: true;
		value: RepositorySnapshot;
	}>();

	const write = mock<typeof RepositoryHistory.cherryPick>(
		() => pending.promise
	);

	const finish = mock<typeof RepositoryOperation.write>(async () => {
		snapshot = repositorySnapshot();

		return { ok: true, value: snapshot };
	});

	root.render(
		<App
			initialSession={{
				...session,
				tabs: [
					...session.tabs,
					{ id: "workspace-2", path: "/test/linked", draft: "Linked draft" },
				],
			}}
			readRepository={async (path) => {
				if (finished && path === "/test/project") return await refresh.promise;

				return {
					ok: true,
					value:
						path === "/test/linked"
							? {
									...snapshot,
									repository: { ...snapshot.repository, root: path },
									head: { ...snapshot.head, branch: "linked" },
								}
							: snapshot,
				};
			}}
			readHistory={readHistory}
			readCommitFiles={readCommitFiles}
			readBranches={readBranches}
			cherryPickCommit={write}
			writeOperation={finish}
		/>
	);
	await open();
	click("entry-cherry-pick-refs/heads/destination");
	await settle();
	click("cherry-pick-confirm");
	await settle();
	expect(blocked).toBe(true);
	click("cherry-pick-confirm");
	click("cherry-pick-cancel");
	await settle();
	expect(write).toHaveBeenCalledTimes(1);
	expect(element("cherry-pick-dialog")).toBeDefined();
	finished = true;
	pending.resolve({
		ok: false,
		error: {
			code: "conflict",
			operation: "cherry-pick",
			message: "Cherry-pick paused with conflicts.",
			retryable: false,
		},
	});
	await settle();
	expect(blocked).toBe(true);
	snapshot = {
		...repositorySnapshot([
			changedFile("a.txt", {
				recordType: "unmerged",
				worktreeStatus: "unmerged",
			}),
		]),
		head: { ...snapshot.head, branch: "destination" },
		operationState: "cherry-pick",
		operationToken: "reviewed-cherry-pick",
	};
	refresh.resolve({ ok: true, value: snapshot });
	await settle();
	expect(blocked).toBe(false);
	expect(text("operation-status")).toBe(
		"Cherry-pick paused · 1 unresolved file"
	);
	click("operation-continue");
	expect(finish).not.toHaveBeenCalled();
	click("operation-abort");
	await settle();
	click("operation-abort-confirm");
	await settle();
	expect(finish.mock.calls[0]?.[1]).toMatchObject({
		kind: "abort",
		expectedOperation: "cherry-pick",
		expectedToken: "reviewed-cherry-pick",
		expectedBranch: "destination",
	});
});

it("keeps confirmation disabled when destination branches cannot be loaded", async () => {
	const write = mock<typeof RepositoryHistory.cherryPick>();

	root.render(
		<App
			initialSession={session}
			readRepository={readRepository}
			readHistory={readHistory}
			readCommitFiles={readCommitFiles}
			readBranches={async () => {
				throw new Error("Read failed");
			}}
			cherryPickCommit={write}
		/>
	);
	await open();
	click("cherry-pick-confirm");
	expect(text("cherry-pick-error")).toContain("Could not load branches");
	expect(write).not.toHaveBeenCalled();
});

it("blocks a second attempt after an indeterminate write and failed refresh", async () => {
	let finished = false;

	const failure = {
		ok: false as const,
		error: {
			code: "command-failed" as const,
			operation: "cherry-pick" as const,
			message: "Could not read repository",
			retryable: false,
		},
	};

	const write = mock<typeof RepositoryHistory.cherryPick>(async () => {
		finished = true;

		throw new Error("Outcome unknown");
	});

	root.render(
		<App
			initialSession={session}
			readRepository={async () =>
				finished ? failure : { ok: true, value: snapshot }
			}
			readHistory={readHistory}
			readCommitFiles={readCommitFiles}
			readBranches={readBranches}
			cherryPickCommit={write}
		/>
	);
	await open();
	click("entry-cherry-pick-refs/heads/destination");
	await settle();
	click("cherry-pick-confirm");
	await settle();

	expect(blocked).toBe(false);
	expect(element("repository-notice")).toBeDefined();
	click("view-history");
	await settle();
	click(`entry-${commitInfo(1).oid}`, 2);
	await settle();
	expect(menuEnabled[menuLabels.indexOf("Cherry-pick commit…")]).toBe(false);
	expect(write).toHaveBeenCalledTimes(1);
});
