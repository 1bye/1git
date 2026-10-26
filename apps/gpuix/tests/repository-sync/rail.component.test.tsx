/**
 * Covers: state-aware rail actions, count badges, publishing confirmation, operation locks and failures.
 * Real: App, workspace reducers/mutations and native layout, pointer and keyboard events.
 * Doubles: Git/account boundaries; no remote network or production preferences are written.
 * Requires: built GPUIX addon and macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { lightColors } from "@1git/design-tokens";
import { App } from "../../src/app";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import { RepositoryBranches } from "../../src/feature/workspace-tabs/lib/repository-branches";
import { RepositorySync } from "../../src/feature/repository-workspace/lib/repository-sync";
import { RepositoryComparison } from "../../src/feature/repository-comparison/lib/repository-comparison";
import { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import { RepositoryDiff } from "../../src/feature/repository-workspace/lib/repository-diff";
import { diffPatch } from "../_shared/diff-patch";
import { GitSettingsModel } from "../../src/feature/git-settings/git-settings-model";
import { appTokens } from "../../src/styles/tokens";
import {
	repositorySnapshot,
	changedFile,
} from "../_shared/repository-snapshot";
import { windowOptions } from "../../src/window-options";
import type { RepositoryReader } from "../../src/feature/repository-workspace/lib/repository-reader";
import type { RepositoryCommit } from "../../src/feature/repository-workspace/lib/repository-commit";

let root: TestRoot;
let accounts: Accounts;

let snapshot: ReturnType<typeof repositorySnapshot> & { remoteCount: number } =
	{ ...repositorySnapshot(), remoteCount: 1 };

const remote = {
	name: "origin",
	fetchUrls: ["/test/remote"],
	pushUrls: ["/test/remote"],
	defaultBranch: "main",
};

let remotes = [remote];

const readBranches = mock<typeof RepositoryBranches.read>(async () => ({
	ok: true,
	value: {
		branches: {
			current: snapshot.head.branch,
			branches: snapshot.head.branch
				? [
						{
							name: snapshot.head.branch,
							fullName: `refs/heads/${snapshot.head.branch}`,
							oid: snapshot.head.oid ?? "",
							checkedOut: true,
							type: "local",
							worktreePath: snapshot.repository.root,
							ahead: snapshot.head.ahead,
							behind: snapshot.head.behind,
							committedAt: null,
							remote: null,
							summary: "",
							upstream: snapshot.head.upstream,
							upstreamRemote: snapshot.head.upstream ? "origin" : null,
							upstreamRef: snapshot.head.upstream ? "refs/heads/main" : null,
						},
						...(snapshot.head.upstream
							? [
									{
										name: snapshot.head.upstream,
										fullName: `refs/remotes/${snapshot.head.upstream}`,
										oid: "remote-tip",
										checkedOut: false,
										type: "remote" as const,
										worktreePath: null,
										ahead: 0,
										behind: 0,
										committedAt: null,
										remote: "origin",
										summary: "Incoming work",
										upstream: null,
									},
								]
							: []),
					]
				: [],
		},
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
		remotes,
	},
}));

const readSnapshot = async (path: string) => ({
	ok: true as const,
	value:
		path === "/test/linked"
			? {
					...snapshot,
					repository: { ...snapshot.repository, root: path },
					head: { ...snapshot.head, branch: "feature/linked" },
				}
			: snapshot,
});

const readComparison = mock<typeof RepositoryComparison.read>(
	async (_root, base, head) => ({
		ok: true,
		value: { base, head, mergeBase: "ancestor", files: [] },
	})
);

const readHistory = mock<typeof RepositoryHistory.read>(async () => ({
	ok: true,
	value: { commits: [], hasMore: false, nextOffset: null },
}));

const readDiff = mock<typeof RepositoryDiff.read>(async () => ({
	ok: true,
	value: [],
}));

const writeBranch = mock<typeof RepositoryBranches.write>(async () => ({
	ok: true,
	value: {
		branches: { current: snapshot.head.branch, branches: [] },
		snapshot,
	},
}));

const read = mock<typeof RepositoryReader.read>(readSnapshot);

const commit = mock<typeof RepositoryCommit.write>(async () => {
	throw new Error("No commit expected");
});

const fetch = mock<typeof RepositorySync.fetch>(async () => ({
	ok: true,
	value: {
		operation: "fetch",
		remote: "origin",
		branch: snapshot.head.branch,
		snapshot,
	},
}));

const sync = mock<typeof RepositorySync.write>(async () => ({
	ok: true,
	value: {
		operation: "push",
		remote: "origin",
		branch: snapshot.head.branch,
		snapshot,
	},
}));

beforeEach(() => {
	root = createTestRoot({
		width: 980,
		height: 720,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	snapshot = { ...repositorySnapshot(), remoteCount: 1 };
	remotes = [remote];
	read.mockClear();
	read.mockImplementation(readSnapshot);
	commit.mockClear();
	readBranches.mockClear();
	readComparison.mockClear();
	readHistory.mockClear();
	readDiff.mockClear();
	writeBranch.mockClear();
	fetch.mockClear();
	sync.mockClear();
	accounts = new Accounts(new AccountStore("/unused/accounts.json"), {
		async read() {
			throw new Error("No credential access expected");
		},
		async write() {},
		async delete() {},
	});
	spyOn(accounts, "load").mockReturnValue([]);
	spyOn(root.renderer, "promptForPaths").mockResolvedValue(["/test/project"]);
});
afterEach(() => {
	root.unmount();
	mock.restore();
});

function node(id: string) {
	const element = root.renderer.findByTestId(id);

	if (!element) throw new Error(`Missing ${id}`);

	return element;
}
function bounds(id: string) {
	const box = root.renderer.getElementBounds(node(id).id);

	if (!box) throw new Error(`Missing bounds ${id}`);

	return box;
}
async function settle() {
	for (let index = 0; index < 5; index++) {
		await Bun.sleep(0);
		root.renderer.flush();
	}

	root.renderer.clockFastForward(250);
	root.renderer.advanceTime(1);
	root.renderer.flush();
}
function click(id: string) {
	const box = bounds(id);

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2
	);
	root.renderer.flush();
}
async function open() {
	root.render(
		<App
			accounts={accounts}
			readRepository={read}
			readBranches={readBranches}
			readComparison={readComparison}
			readHistory={readHistory}
			writeBranch={writeBranch}
			fetchRepository={fetch}
			writeSyncRepository={sync}
			writeCommit={commit}
			readGitSettings={async () => ({
				ok: true,
				value: {
					identity: { name: null, email: null },
					custom: false,
					remotes,
				},
			})}
			readLastCommit={async () => ({
				ok: false,
				error: {
					code: "not-found",
					operation: "get-commit",
					message: "No footer fixture",
					retryable: false,
				},
			})}
			readDiff={readDiff}
		/>
	);
	await settle();
	click("open-repository");
	await settle();
}

it("places separate incoming/outgoing badges above Changes and removes duplicate controls", async () => {
	snapshot = {
		...snapshot,
		head: { ...snapshot.head, upstream: "origin/main", ahead: 3, behind: 2 },
	};
	await open();

	expect(node("rail-sync").customProps?.["aria-label"]).toContain("2 incoming");
	expect(node("rail-sync").customProps?.["aria-label"]).toContain("3 outgoing");
	expect(bounds("rail-sync-incoming").y).toBeLessThan(
		bounds("rail-sync-outgoing").y
	);
	const button = bounds("rail-sync");
	const separator = bounds("rail-sync-separator");
	const changes = bounds("view-changes");
	const incoming = bounds("rail-sync-incoming");
	const outgoing = bounds("rail-sync-outgoing");

	expect(node("rail-sync-separator").style.backgroundColor).toBe(
		lightColors.editorHairlineStrong
	);
	expect(separator).toMatchObject({ width: 20, height: 1 });
	expect(separator.y - button.y - button.height).toBe(4);
	expect(changes.y - separator.y - separator.height).toBe(4);
	expect(incoming.y).toBeGreaterThanOrEqual(bounds("workspace-rail").y);
	expect(outgoing.y + outgoing.height).toBeLessThanOrEqual(separator.y);
	expect(button.width).toBe(32);
	expect(button.height).toBe(32);
	expect(root.renderer.findByTestId("commit-sync")).toBeUndefined();
	const screenshot = process.env.GPUIX_RAIL_SYNC_SCREENSHOT;

	if (screenshot) root.renderer.captureScreenshot(screenshot);

	click("workspace-1");
	await settle();
	expect(root.renderer.findByTestId("sync-actions")).toBeUndefined();
	expect(root.renderer.findByTestId("new-actions")).toBeDefined();
	expect(fetch).not.toHaveBeenCalled();
	expect(sync).not.toHaveBeenCalled();
});

it("replaces the busy icon with a labeled gauge and hides stale counts until confirmation", async () => {
	snapshot = {
		...snapshot,
		head: { ...snapshot.head, upstream: "origin/main", ahead: 12 },
	};
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositorySync.write>>>();

	sync.mockImplementationOnce(() => pending.promise);
	await open();
	click("rail-sync");
	await settle();

	expect(root.renderer.findByTestId("rail-sync-outgoing")).toBeUndefined();
	expect(root.renderer.findByTestId("rail-sync-icon")).toBeUndefined();
	expect(node("rail-sync-progress-gauge").type).toBe("svg");
	const onProgress = sync.mock.calls[0]?.[4];

	expect(onProgress).toBeDefined();
	onProgress?.({ phase: "sending", percent: 45 });
	await settle();

	expect(node("rail-sync-progress").customProps?.["aria-valuetext"]).toBe(
		"Sending objects — 45%"
	);
	expect(node("rail-sync").customProps?.["aria-label"]).toContain(
		"Sending objects — 45%"
	);
	expect(root.renderer.getPaintedText()).toContain("45%");
	const gauge = bounds("rail-sync-progress");
	const button = bounds("rail-sync");

	expect(gauge).toMatchObject(button);

	if (process.env.GPUIX_SYNC_RING_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_SYNC_RING_SCREENSHOT);

	onProgress?.({ phase: "sending", percent: 100 });
	await settle();

	expect(node("rail-sync-progress").customProps?.["aria-valuetext"]).toBe(
		"Waiting for remote confirmation…"
	);
	expect(root.renderer.getPaintedText()).toContain("100%");
	expect(node("rail-sync").customProps?.["aria-label"]).not.toContain(
		"complete"
	);
	snapshot = { ...snapshot, head: { ...snapshot.head, ahead: 0 } };
	pending.resolve({
		ok: true,
		value: { operation: "push", remote: "origin", branch: "main", snapshot },
	});
	await settle();

	expect(root.renderer.findByTestId("rail-sync-progress")).toBeUndefined();
	expect(root.renderer.findByTestId("rail-sync-outgoing")).toBeUndefined();
	expect(node("rail-sync").customProps?.["aria-label"]).toContain(
		"Sync complete"
	);
	onProgress?.({ phase: "sending", percent: 2 });
	await settle();

	expect(root.renderer.findByTestId("rail-sync-progress")).toBeUndefined();
});

it("fetches an up-to-date branch without extra branch reads or committing files", async () => {
	snapshot = {
		...snapshot,
		head: { ...snapshot.head, upstream: "origin/main" },
	};
	await open();
	expect(node("rail-sync").customProps?.["aria-label"]).toBe(
		"Fetch remote updates"
	);
	expect(root.renderer.findByTestId("rail-sync-incoming")).toBeUndefined();
	expect(root.renderer.findByTestId("rail-sync-outgoing")).toBeUndefined();
	const button = bounds("rail-sync");

	expect(bounds("rail-sync-separator").y - button.y - button.height).toBe(4);
	click("rail-sync");
	await settle();
	expect(fetch).toHaveBeenCalledTimes(1);
	expect(sync).not.toHaveBeenCalled();
	expect(readBranches).not.toHaveBeenCalled();
});

it("caps badge text without hiding exact counts from assistive labels", async () => {
	snapshot = {
		...snapshot,
		head: {
			...snapshot.head,
			upstream: "origin/main",
			ahead: 120,
			behind: 200,
		},
	};
	await open();

	expect(root.renderer.getAllText().join("")).toContain("↓ 99+");
	expect(root.renderer.getAllText().join("")).toContain("↑ 99+");
	expect(node("rail-sync").customProps?.["aria-label"]).toContain(
		"200 incoming, 120 outgoing"
	);
	expect(
		bounds("rail-sync-incoming").x + bounds("rail-sync-incoming").width
	).toBeLessThan(bounds("commit-composer").x);
	expect(fetch).not.toHaveBeenCalled();
});

it("fetches by keyboard and refreshes partial tracking while retaining draft, selection and inclusion", async () => {
	snapshot = {
		...snapshot,
		files: [changedFile("a.ts"), changedFile("b.ts")],
		head: { ...snapshot.head, upstream: "origin/main" },
	};
	fetch.mockImplementationOnce(async () => {
		snapshot = { ...snapshot, head: { ...snapshot.head, ahead: 2, behind: 3 } };

		return {
			ok: true,
			value: { operation: "fetch", remote: "origin", branch: "main", snapshot },
		};
	});
	await open();
	click("include-a.ts");
	click("entry-b.ts");
	click("commit-message");
	root.renderer.simulateKeystrokes("d r a f t");
	root.renderer.nativeSimulateKeyDown(node("rail-sync").id, "enter");
	await settle();

	expect(fetch).toHaveBeenCalledTimes(1);
	expect(read).toHaveBeenCalledTimes(2);
	expect(commit).not.toHaveBeenCalled();
	expect(readBranches).not.toHaveBeenCalled();
	expect(node("commit-message").customProps?.value).toBe("draft");
	expect(node("include-b.ts").customProps?.["aria-checked"]).toBe(false);
	expect(node("entry-b.ts").customProps?.["aria-selected"]).toBe(true);
	expect(node("rail-sync").customProps?.["aria-label"]).toContain("2 outgoing");
	click("workspace-1");
	await settle();
	expect(root.renderer.getAllText()).toContain(
		"origin/main · 2 ahead · 3 behind"
	);
});

it.each(["incoming", "outgoing"] as const)(
	"runs guarded combined sync for %s commits",
	async (direction) => {
		snapshot = {
			...snapshot,
			head: {
				...snapshot.head,
				upstream: "origin/main",
				ahead: direction === "outgoing" ? 2 : 0,
				behind: direction === "incoming" ? 2 : 0,
			},
		};
		await open();

		expect(node("rail-sync").customProps?.["aria-label"]).toContain(
			direction === "incoming" ? "Pull incoming" : "Push outgoing"
		);
		click("rail-sync");
		await settle();
		expect(sync).toHaveBeenCalledTimes(1);
		expect(sync.mock.calls[0]?.slice(0, 2)).toEqual([
			"/test/project",
			{
				kind: "sync",
				expectedHead: snapshot.head.oid ?? "",
				expectedBranch: "main",
			},
		]);
		expect(fetch).not.toHaveBeenCalled();
		expect(node("rail-sync").customProps?.["aria-label"]).toContain(
			"Sync complete"
		);
	}
);

it("opens the fetched upstream directly and reviews both directions without writing", async () => {
	snapshot = {
		...snapshot,
		head: { ...snapshot.head, upstream: "origin/main", ahead: 2, behind: 3 },
	};
	await open();

	for (const count of [3, 2, 3]) {
		readComparison.mockImplementationOnce(async (_root, base, head) => ({
			ok: true,
			value: {
				base,
				head,
				mergeBase: "ancestor",
				files: [
					{
						path: "sync.ts",
						status: "M",
						beforeOid: "before",
						afterOid: "after",
					},
				],
			},
		}));
		readHistory.mockImplementationOnce(async (_root, revision) => ({
			ok: true,
			value: {
				commits: Array.from({ length: count }, (_, index) => ({
					oid: `${revision}-${index}`,
					summary:
						[
							"Keep upstream changes visible",
							"Improve branch synchronization",
							"Preserve repository drafts",
						][index] ?? "Local changes",
					body: "",
					parentOids: ["ancestor"],
					authoredAt: "2026-10-26T10:00:00Z",
					committedAt: "2026-10-26T10:00:00Z",
					author: { name: "Developer", email: "developer@example.invalid" },
					committer: { name: "Developer", email: "developer@example.invalid" },
				})),
				hasMore: false,
				nextOffset: null,
			},
		}));
		readDiff.mockImplementationOnce(async () => ({
			ok: true,
			value: [
				{
					target: "commit",
					patch: diffPatch(
						"sync.ts",
						"const reviewUpstream = true;",
						"const reviewUpstream = false;"
					),
					stats: [],
					message: null,
				},
			],
		}));
	}

	click("rail-sync");
	await settle();

	expect(fetch).toHaveBeenCalledTimes(1);
	expect(readBranches).toHaveBeenCalledTimes(1);
	expect(sync).not.toHaveBeenCalled();
	expect(commit).not.toHaveBeenCalled();
	expect(root.renderer.getAllText()).not.toContain(
		"Review changes before syncing"
	);
	expect(root.renderer.findByTestId("sync-review-notice")).toBeUndefined();
	const toolbar = bounds("comparison-toolbar");

	for (const id of ["sync-review-merge", "sync-review-rebase"]) {
		const action = bounds(id);

		expect(action.y).toBeGreaterThanOrEqual(toolbar.y);
		expect(action.y + action.height).toBeLessThanOrEqual(
			toolbar.y + toolbar.height
		);
	}

	expect(node("sync-review")).toBeDefined();
	expect(root.renderer.findByTestId("rail-sync-dialog")).toBeUndefined();
	expect(root.renderer.findByTestId("comparison-branch")).toBeUndefined();
	expect(root.renderer.findByTestId("preview-pull-request")).toBeUndefined();
	expect(readComparison.mock.calls[0]?.slice(0, 3)).toEqual([
		"/test/project",
		snapshot.head.oid ?? "",
		"remote-tip",
	]);
	click("sync-review-outgoing");
	await settle();
	expect(readComparison.mock.calls.at(-1)?.slice(0, 3)).toEqual([
		"/test/project",
		"remote-tip",
		snapshot.head.oid ?? "",
	]);
	expect(readHistory.mock.calls.at(-1)?.[1]).toBe(
		`remote-tip..${snapshot.head.oid}`
	);
	expect(root.renderer.getAllText().join(" ")).toContain("Outgoing commits");
	click("sync-review-incoming");
	await settle();
	expect(root.renderer.getAllText()).toContain("sync.ts");
	expect(root.renderer.getAllText()).toContain("Keep upstream changes visible");
	click("sync-review-merge");
	await settle();
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(root.renderer.findByTestId("sync-review-confirm")).toBeUndefined();
	expect(writeBranch).not.toHaveBeenCalled();
	expect(root.renderer.findByTestId("rail-sync-tooltip")).toBeUndefined();
	const screenshot = process.env.GPUIX_RAIL_REVIEW_SCREENSHOT;

	if (screenshot) root.renderer.captureScreenshot(screenshot);

	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(root.renderer.findByTestId("sync-review")).toBeUndefined();
});

it.each(["merge", "rebase"] as const)(
	"confirms %s in a header popup, then returns to Changes without pushing",
	async (kind) => {
		snapshot = {
			...snapshot,
			head: { ...snapshot.head, upstream: "origin/main", ahead: 6, behind: 2 },
		};
		const reviewedHead = snapshot.head.oid;

		writeBranch.mockImplementationOnce(async () => {
			snapshot = {
				...snapshot,
				head: {
					...snapshot.head,
					oid: "integrated-tip",
					ahead: kind === "merge" ? 7 : 6,
					behind: 0,
				},
			};

			return {
				ok: true,
				value: { branches: { current: "main", branches: [] }, snapshot },
			};
		});
		await open();
		click("rail-sync");
		await settle();
		const comparisonBefore = bounds("comparison-body");

		click(`sync-review-${kind}`);
		await settle();
		expect(writeBranch).not.toHaveBeenCalled();
		expect(node(`sync-review-${kind}-confirmation`)).toBeDefined();
		expect(bounds("comparison-body")).toEqual(comparisonBefore);
		expect(root.renderer.getAllText().join(" ")).toContain(
			"Push separately when you’re ready."
		);
		click("sync-review-confirm");
		await settle();
		expect(writeBranch.mock.calls[0]).toEqual([
			"/test/project",
			{
				kind,
				name: "refs/remotes/origin/main",
				expectedTarget: "remote-tip",
				reviewedSource: { head: reviewedHead, branch: "main" },
				expectedHead: reviewedHead,
				expectedBranch: "main",
			},
		]);
		expect(sync).not.toHaveBeenCalled();
		expect(root.renderer.findByTestId("sync-review")).toBeUndefined();
		expect(node("repository-navigation")).toBeDefined();
		expect(node("view-changes").customProps?.["aria-selected"]).toBe(true);
		expect(root.renderer.findByTestId("sync-review-result")).toBeUndefined();
		expect(root.renderer.getAllText()).not.toContain("Ready to push");
		const screenshot = process.env.GPUIX_SYNC_RESULT_SCREENSHOT;

		if (screenshot && kind === "merge")
			root.renderer.captureScreenshot(screenshot);

		sync.mockImplementationOnce(async () => {
			snapshot = { ...snapshot, head: { ...snapshot.head, ahead: 0 } };

			return {
				ok: true,
				value: {
					operation: "push",
					remote: "origin",
					branch: "main",
					snapshot,
				},
			};
		});
		click("rail-sync");
		await settle();
		expect(sync.mock.calls[0]?.[1]).toMatchObject({
			kind: "sync",
			expectedHead: "integrated-tip",
		});
		expect(root.renderer.findByTestId("sync-review")).toBeUndefined();
	}
);

it("keeps a dirty tree reviewable while explaining why integration is disabled", async () => {
	snapshot = {
		...repositorySnapshot([changedFile("draft.txt")]),
		remoteCount: 1,
		head: { ...snapshot.head, upstream: "origin/main", ahead: 2, behind: 3 },
	};
	await open();
	click("rail-sync");
	await settle();
	expect(node("sync-review")).toBeDefined();
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Commit or stash your changes before merging or rebasing."
	);
	click("sync-review-merge");
	await settle();
	expect(root.renderer.findByTestId("sync-review-confirm")).toBeUndefined();
	expect(writeBranch).not.toHaveBeenCalled();
	click("sync-review-outgoing");
	await settle();
	expect(root.renderer.getAllText().join(" ")).toContain("Outgoing commits");
});

it("opens Changes when a confirmed merge stops with conflicts", async () => {
	snapshot = {
		...snapshot,
		head: { ...snapshot.head, upstream: "origin/main", ahead: 2, behind: 3 },
	};
	writeBranch.mockImplementationOnce(async () => {
		snapshot = {
			...snapshot,
			operationState: "merge",
			files: [changedFile("conflict.txt", { recordType: "unmerged" })],
		};

		return {
			ok: false,
			error: {
				code: "conflict",
				operation: "merge",
				message: "Resolve conflicts in Changes.",
				retryable: false,
			},
		};
	});
	await open();
	click("rail-sync");
	await settle();
	click("sync-review-merge");
	await settle();
	click("sync-review-confirm");
	await settle();
	expect(root.renderer.findByTestId("sync-review")).toBeUndefined();
	expect(root.renderer.getAllText().join(" ")).toContain("Abort");
	expect(root.renderer.findByTestId("operation-result")).toBeUndefined();
	click("operation-details");
	await settle();
	expect(root.renderer.findByTestId("operation-result")).toBeDefined();
	expect(sync).not.toHaveBeenCalled();
});

it("keeps rejected integration visible and allows returning to merge review", async () => {
	snapshot = {
		...snapshot,
		head: { ...snapshot.head, upstream: "origin/main", ahead: 2, behind: 3 },
	};
	writeBranch.mockImplementationOnce(async () => ({
		ok: false,
		error: {
			code: "conflict",
			operation: "rebase",
			message: "Published commits cannot be rebased.",
			retryable: false,
		},
	}));
	await open();
	click("rail-sync");
	await settle();
	click("sync-review-rebase");
	await settle();
	click("sync-review-confirm");
	await settle();
	expect(root.renderer.getAllText()).toContain(
		"Published commits cannot be rebased."
	);
	expect(node("sync-review")).toBeDefined();
	click("sync-review-cancel");
	await settle();
	click("sync-review-merge");
	await settle();
	expect(root.renderer.getAllText().join(" ")).toContain(
		"keeping both histories"
	);
	expect(writeBranch).toHaveBeenCalledTimes(1);
	expect(sync).not.toHaveBeenCalled();
});

it("keeps the review and its actions inside the minimum window with long branch names", async () => {
	root.unmount();
	root = createTestRoot({
		width: 640,
		height: 420,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	spyOn(root.renderer, "promptForPaths").mockResolvedValue(["/test/project"]);
	snapshot = {
		...snapshot,
		head: {
			...snapshot.head,
			branch: "feature/long-local-branch-name",
			upstream: "origin/feature/long-upstream-branch-name",
			ahead: 2,
			behind: 3,
		},
	};
	await open();
	click("rail-sync");
	await settle();

	for (const id of [
		"comparison-toolbar",
		"sync-review-branches",
		"sync-review-merge",
		"sync-review-rebase",
		"sync-review-outgoing",
	]) {
		const box = bounds(id);

		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(640);
		expect(box.y + box.height).toBeLessThanOrEqual(420);
	}

	click("sync-review-merge");
	await settle();
	const confirm = bounds("sync-review-confirm");

	expect(confirm.y + confirm.height).toBeLessThanOrEqual(420);
	expect(writeBranch).not.toHaveBeenCalled();
	const screenshot = process.env.GPUIX_SYNC_SMALL_SCREENSHOT;

	if (screenshot) root.renderer.captureScreenshot(screenshot);
});

it("preselects the only remote and publishes only after confirmation", async () => {
	await open();
	click("rail-sync");
	await settle();

	expect(node("publish-remote-origin").customProps?.["aria-label"]).toBe(
		"origin, selected"
	);
	expect(root.renderer.getAllText()).toContain("Publish to origin");
	expect(sync).not.toHaveBeenCalled();

	const screenshot = process.env.GPUIX_PUBLISH_BRANCH_SCREENSHOT;

	if (screenshot) root.renderer.captureScreenshot(screenshot);

	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(root.renderer.findByTestId("rail-sync-dialog")).toBeUndefined();
	expect(sync).not.toHaveBeenCalled();

	click("rail-sync");
	await settle();
	root.renderer.focusElement(node("confirm-publish").id);
	root.renderer.simulateKeystrokes("enter");
	await settle();
	expect(sync).toHaveBeenCalledTimes(1);
	expect(sync.mock.calls[0]?.[1]).toEqual({
		kind: "publish",
		remote: "origin",
		remoteRef: "refs/heads/main",
		expectedHead: snapshot.head.oid ?? "",
		expectedBranch: "main",
	});
});

it("requires selection with multiple remotes and confirmation, and Escape never publishes", async () => {
	remotes = [remote, { ...remote, name: "upstream" }];
	await open();
	click("rail-sync");
	await settle();
	expect(node("rail-sync").customProps?.["aria-label"]).toBe("Publish branch");
	expect(node("publish-remote-origin").customProps?.["aria-label"]).toBe(
		"origin"
	);
	expect(node("publish-remote-upstream").customProps?.["aria-label"]).toBe(
		"upstream"
	);
	click("confirm-publish");
	expect(sync).not.toHaveBeenCalled();
	click("publish-remote-upstream");
	await settle();
	expect(root.renderer.getAllText()).toContain("Publish to upstream");
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(root.renderer.findByTestId("rail-sync-dialog")).toBeUndefined();
	expect(sync).not.toHaveBeenCalled();

	click("rail-sync");
	await settle();
	click("publish-remote-upstream");
	click("confirm-publish");
	await settle();
	expect(sync).toHaveBeenCalledTimes(1);
	expect(sync.mock.calls[0]?.[1]).toEqual({
		kind: "publish",
		remote: "upstream",
		remoteRef: "refs/heads/main",
		expectedHead: snapshot.head.oid ?? "",
		expectedBranch: "main",
	});
});

it("rejects multiple push URLs and stale branch choices without writing", async () => {
	remotes = [{ ...remote, pushUrls: ["/test/one", "/test/two"] }];
	await open();
	click("rail-sync");
	await settle();
	expect(node("publish-remote-origin").customProps?.["aria-label"]).toBe(
		"origin"
	);
	click("publish-remote-origin");
	click("confirm-publish");
	expect(sync).not.toHaveBeenCalled();
	click("rail-sync-close");
	await settle();
	remotes = [remote];
	readBranches.mockImplementationOnce(async () => ({
		ok: true,
		value: {
			branches: { current: "different", branches: [] },
			worktrees: [],
			remotes,
		},
	}));
	click("rail-sync");
	await settle();
	expect(root.renderer.getAllText().join(" ")).toContain("The branch changed");
	click("confirm-publish");
	expect(sync).not.toHaveBeenCalled();
});

it("opens repository publishing when there are no configured remotes", async () => {
	snapshot = { ...snapshot, remoteCount: 0 };
	remotes = [];
	await open();
	click("rail-sync");
	await settle();

	expect(root.renderer.findByTestId("publish-repository-view")).toBeDefined();
	expect(fetch).not.toHaveBeenCalled();
	expect(sync).not.toHaveBeenCalled();
	expect(readBranches).not.toHaveBeenCalled();
});

it.each(["detached", "unborn", "merge"] as const)(
	"avoids branch writes for %s state",
	async (condition) => {
		snapshot = {
			...snapshot,
			head: {
				...snapshot.head,
				upstream: "origin/main",
				ahead: 1,
				branch: condition === "detached" ? null : "main",
				detached: condition === "detached",
				oid: condition === "unborn" ? null : snapshot.head.oid,
				unborn: condition === "unborn",
			},
			operationState: condition === "merge" ? "merge" : "normal",
		};
		await open();
		click("rail-sync");
		await settle();

		expect(sync).not.toHaveBeenCalled();

		if (condition === "merge") {
			expect(root.renderer.getAllText().join(" ")).toContain(
				"ongoing Git operation"
			);
			expect(fetch).not.toHaveBeenCalled();
		} else expect(fetch).toHaveBeenCalledTimes(1);
	}
);

it("retains failures on reopen and permits only an explicit retry", async () => {
	snapshot = {
		...snapshot,
		head: { ...snapshot.head, upstream: "origin/main" },
	};
	fetch.mockImplementationOnce(async () => ({
		ok: false,
		error: {
			code: "authentication-required",
			operation: "fetch",
			message: "Authentication required for one remote.",
			retryable: true,
		},
	}));
	await open();
	click("rail-sync");
	await settle();
	expect(root.renderer.getAllText()).toContain(
		"Authentication required for one remote."
	);
	click("rail-sync-close");
	await settle();
	click("rail-sync");
	await settle();
	expect(root.renderer.getAllText()).toContain(
		"Authentication required for one remote."
	);
	expect(fetch).toHaveBeenCalledTimes(1);

	click("rail-sync-retry");
	await settle();
	expect(fetch).toHaveBeenCalledTimes(2);
	expect(root.renderer.findByTestId("rail-sync-dialog")).toBeUndefined();
	expect(node("rail-sync").customProps?.["aria-label"]).toContain(
		"Fetch complete"
	);
	await Bun.sleep(3100);
	root.renderer.flush();
	expect(node("rail-sync").customProps?.["aria-label"]).toBe(
		"Fetch remote updates"
	);
});

it.each(["accounts", "remotes"] as const)(
	"opens %s settings from the quiet account-access error after Push fails during its initial fetch",
	async (destination) => {
		snapshot = {
			...snapshot,
			head: { ...snapshot.head, upstream: "origin/main", ahead: 1 },
		};
		const message =
			"Your GitHub account is connected without access to private repositories.";

		const account = {
			provider: "github",
			webUrl: "https://github.com/",
			id: "7",
			username: "fixture",
		} as const;

		const key = AccountStore.key(account);

		spyOn(accounts, "load").mockReturnValue([account]);
		spyOn(accounts, "registration").mockResolvedValue({
			clientId: "fixture-client",
		});
		spyOn(accounts, "repositoryAccess").mockResolvedValue(false);
		const authorize = spyOn(accounts, "connectBrowser");
		const config = spyOn(GitSettingsModel, "write");

		sync.mockResolvedValueOnce({
			ok: false,
			error: {
				code: "authentication-required",
				operation: "fetch",
				message,
				retryable: true,
			},
			accountAccess: { message, accountKey: key },
		});
		await open();
		click("rail-sync");
		await settle();

		expect(sync.mock.calls[0]?.[1].kind).toBe("sync");
		expect(root.renderer.getAllText()).toContain(message);
		expect(root.renderer.getAllText()).toContain("Repository access needed");
		expect(node("rail-sync-message").style.color).toBe(lightColors.editorMuted);
		expect(node("rail-sync-access-icon").style.color).toBe(
			appTokens.colors.danger
		);
		expect(root.renderer.findByTestId("rail-sync-retry")).toBeUndefined();
		expect(root.renderer.findByTestId("rail-sync-refresh")).toBeUndefined();
		expect(node("rail-sync-close")).toBeDefined();
		const dialog = bounds("rail-sync-dialog");

		for (const id of [
			"rail-sync-close",
			"rail-sync-remotes",
			"rail-sync-accounts",
		]) {
			const button = bounds(id);

			expect(button.x).toBeGreaterThanOrEqual(dialog.x);
			expect(button.x + button.width).toBeLessThanOrEqual(
				dialog.x + dialog.width
			);
		}

		expect(root.renderer.getAllText().join(" ")).not.toContain(
			"Authenticated HTTPS request failed"
		);

		if (
			process.env.GPUIX_SYNC_PERMISSION_SCREENSHOT &&
			destination === "accounts"
		)
			root.renderer.captureScreenshot(
				process.env.GPUIX_SYNC_PERMISSION_SCREENSHOT
			);

		click("rail-sync-close");
		await settle();
		click("rail-sync");
		await settle();
		expect(sync).toHaveBeenCalledTimes(1);

		if (destination === "accounts") {
			root.renderer.focusElement(node("rail-sync-accounts").id);
			root.renderer.simulateKeystrokes("enter");
		} else click("rail-sync-remotes");

		await settle();
		expect(root.renderer.findByTestId("rail-sync-dialog")).toBeUndefined();

		if (destination === "accounts") {
			expect(root.renderer.getAllText()).toContain("Reconnect account");
			expect(node("account-client-id").customProps?.value).toBe(
				"fixture-client"
			);
			expect(
				node("account-repository-access").customProps?.["aria-checked"]
			).toBe(false);
			root.renderer.simulateKeystrokes("escape");
			await settle();
			expect(node("accounts-settings")).toBeDefined();
			expect(root.renderer.findByTestId("account-connect")).toBeUndefined();
		} else {
			expect(root.renderer.getAllText()).toContain("Remotes");
			expect(node("remote-add")).toBeDefined();
		}

		expect(authorize).not.toHaveBeenCalled();
		expect(config).not.toHaveBeenCalled();
		expect(sync).toHaveBeenCalledTimes(1);
		click("view-changes");
		await settle();
		expect(root.renderer.findByTestId("accounts-settings")).toBeUndefined();
		click("rail-sync");
		await settle();
		expect(sync).toHaveBeenCalledTimes(2);
		expect(root.renderer.findByTestId("rail-sync-dialog")).toBeUndefined();
	}
);

it.each([undefined, "removed-account"])(
	"opens Accounts rather than an arbitrary reconnect form for recovery key %s",
	async (accountKey) => {
		fetch.mockResolvedValueOnce({
			ok: false,
			error: {
				code: "authentication-required",
				operation: "fetch",
				message: "Check account permissions.",
				retryable: true,
			},
			accountAccess: { message: "Check account permissions.", accountKey },
		});
		snapshot = {
			...snapshot,
			head: { ...snapshot.head, upstream: "origin/main" },
		};
		await open();
		click("rail-sync");
		await settle();
		expect(root.renderer.getAllText()).toContain(
			accountKey ? "Reconnect account…" : "Account settings…"
		);
		click("rail-sync-accounts");
		await settle();
		expect(node("accounts-settings")).toBeDefined();
		expect(root.renderer.getAllText()).toContain("No accounts connected.");
		expect(root.renderer.findByTestId("account-connect")).toBeUndefined();
	}
);

it("blocks further writes after a failed status refresh until a manual refresh succeeds", async () => {
	snapshot = {
		...snapshot,
		head: { ...snapshot.head, upstream: "origin/main" },
	};
	await open();
	read.mockImplementationOnce(async () => ({
		ok: false,
		error: {
			code: "command-failed",
			operation: "get-snapshot",
			message: "Status could not be refreshed.",
			retryable: true,
		},
	}));
	click("rail-sync");
	await settle();

	expect(root.renderer.getAllText()).toContain(
		"Status could not be refreshed."
	);
	expect(root.renderer.getAllText()).toContain("Fetched just now");
	expect(root.renderer.findByTestId("rail-sync-retry")).toBeUndefined();
	expect(sync).not.toHaveBeenCalled();
	click("rail-sync-refresh");
	await settle();
	expect(node("rail-sync").customProps?.["aria-label"]).toBe(
		"Fetch remote updates"
	);
});

it("keeps fetch alive across linked-tab changes, locks closure, and cancels explicitly from either tab", async () => {
	snapshot = {
		...snapshot,
		head: { ...snapshot.head, upstream: "origin/main" },
	};
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositorySync.fetch>>>();

	fetch.mockImplementationOnce(() => pending.promise);
	await open();
	click("workspace-1");
	await settle();
	click("worktrees");
	await settle();
	click("worktree-/test/linked");
	await settle();
	click("workspace-1");
	await settle();
	click("rail-sync");
	await settle();
	const signal = fetch.mock.calls[0]?.[1];

	expect(signal?.aborted).toBe(false);
	click("close-workspace-1");
	await settle();
	expect(node("workspace-1")).toBeDefined();
	click("workspace-2");
	await settle();
	expect(node("rail-sync").customProps?.["aria-label"]).toContain("Fetching");
	click("close-workspace-2");
	await settle();
	expect(node("workspace-2")).toBeDefined();
	click("rail-sync");
	await settle();
	expect(fetch).toHaveBeenCalledTimes(1);
	expect(signal?.aborted).toBe(false);
	click("rail-sync-close");
	await settle();
	expect(signal?.aborted).toBe(false);
	click("rail-sync");
	await settle();
	click("rail-sync-stop");
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
	await settle();

	expect(root.renderer.getAllText()).toContain("Fetch cancelled.");
	expect(read.mock.calls.map(([path]) => path)).toEqual(
		expect.arrayContaining(["/test/project", "/test/linked"])
	);
	expect(fetch).toHaveBeenCalledTimes(1);
	click("rail-sync-close");
	await settle();
	click("workspace-1");
	await settle();
	click("rail-sync");
	await settle();
	expect(root.renderer.getAllText()).toContain("Fetch cancelled.");
	click("rail-sync-retry");
	await settle();
	expect(fetch).toHaveBeenCalledTimes(2);
});

it("aborts a window-owned fetch when the window unmounts", async () => {
	snapshot = {
		...snapshot,
		head: { ...snapshot.head, upstream: "origin/main" },
	};
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositorySync.fetch>>>();

	fetch.mockImplementationOnce(() => pending.promise);
	await open();
	click("rail-sync");
	await settle();
	const signal = fetch.mock.calls[0]?.[1];

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
	expect(read).toHaveBeenCalledTimes(1);
});
