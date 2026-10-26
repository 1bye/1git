/**
 * Covers: rail/Compare entry points, preview layout, explicit publish/push, existing requests, stale branches, fetch failures and browser handoff.
 * Real: App, comparison, native rendering/events and shared Git mutation locks.
 * Doubles: Git/provider I/O, AppKit menu choice and browser; no real pushes or PR/MR creation.
 * Requires: patched GPUIX and macOS graphics.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import { windowOptions } from "../../src/window-options";
import { NativeBrowser } from "../../src/platform/browser";
import type {
	PullRequestPreview,
	RepositoryPullRequest,
} from "../../src/feature/repository-pull-request/repository-pull-request";
import { RepositorySync } from "../../src/feature/repository-workspace/lib/repository-sync";
import { RepositoryComparison } from "../../src/feature/repository-comparison/lib/repository-comparison";
import {
	repositorySnapshot,
	changedFile,
} from "../_shared/repository-snapshot";
import { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import type { RepositoryBranches } from "../../src/feature/workspace-tabs/lib/repository-branches";

let root: TestRoot;
let snapshot = repositorySnapshot();
let data: PullRequestPreview;
let menuChoice = "Preview pull request…";
let menuLabels: string[];
let menuEnabled: boolean[];

const head = "a".repeat(40);
const base = "b".repeat(40);
const read = mock<RepositoryPullRequest["read"]>(async () => data);

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

const compare = mock<typeof RepositoryComparison.read>(
	async (_root, baseOid, headOid) => ({
		ok: true,
		value: { base: baseOid, head: headOid, mergeBase: baseOid, files: [] },
	})
);

const history = mock<typeof RepositoryHistory.read>(async () => ({
	ok: true,
	value: { commits: [], hasMore: false, nextOffset: null },
}));

const browser = mock<typeof NativeBrowser.open>(async () => {});

function fixture(): PullRequestPreview {
	return {
		branch: "feature/ui",
		head,
		remote: "origin",
		remoteUrl: "https://github.com/team/app.git",
		remoteRef: "refs/heads/feature/ui",
		publishedHead: head,
		uploadKind: "push",
		identity: {
			providerId: "github",
			host: "github.com",
			repository: { owner: "team", name: "app" },
			browserUrl: "https://github.com/team/app",
		},
		comparison: {
			root: "/test/project",
			base,
			baseName: "main",
			incoming: "refs/heads/feature/ui",
			intent: "pull-request",
			branches: [
				{ value: "refs/remotes/origin/main", label: "main", oid: base },
				{ value: "refs/heads/feature/ui", label: "feature/ui", oid: head },
			],
		},
		requests: [],
		repositoryId: "7",
		notice: null,
	};
}

beforeEach(() => {
	root = createTestRoot({
		width: 980,
		height: 720,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	const initial = repositorySnapshot([changedFile("uncommitted.txt")]);

	snapshot = {
		...initial,
		head: {
			...initial.head,
			branch: "feature/ui",
			oid: head,
			upstream: "origin/feature/ui",
		},
	};
	data = fixture();
	menuChoice = "Preview pull request…";
	menuLabels = [];
	menuEnabled = [];
	read.mockReset();
	read.mockImplementation(async () => data);
	fetch.mockReset();
	fetch.mockImplementation(async () => ({
		ok: true,
		value: {
			operation: "fetch",
			remote: "origin",
			branch: snapshot.head.branch,
			snapshot,
		},
	}));
	sync.mockReset();
	sync.mockImplementation(async () => {
		data = { ...data, publishedHead: head };

		return {
			ok: true,
			value: {
				operation: "push",
				remote: "origin",
				branch: snapshot.head.branch,
				snapshot,
			},
		};
	});
	compare.mockClear();
	history.mockClear();
	browser.mockClear();
	spyOn(NativeBrowser, "open").mockImplementation(browser);
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

async function settle() {
	for (let index = 0; index < 5; index++) {
		await Bun.sleep(5);
		root.renderer.flush();
	}

	root.renderer.clockFastForward(250);
	root.renderer.advanceTime(1);
	root.renderer.flush();
}

function bounds(id: string) {
	const element = root.renderer.findByTestId(id);

	if (!element) throw new Error(`Missing ${id}`);

	const box = root.renderer.getElementBounds(element.id);

	if (!box) throw new Error(`No bounds for ${id}`);

	return box;
}

function click(id: string, button = 0, modifiers = "") {
	const box = bounds(id);

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2,
		button,
		modifiers
	);
	root.renderer.flush();
}

function show() {
	const accounts = new Accounts(new AccountStore("/unused/requests.json"), {
		async read() {
			throw new Error("No credentials expected");
		},
		async write() {},
		async delete() {},
	});

	spyOn(accounts, "load").mockReturnValue([]);
	const branches: typeof RepositoryBranches.read = async () => ({
		ok: true,
		value: {
			branches: { current: snapshot.head.branch, branches: [] },
			worktrees: [],
			remotes: [],
		},
	});

	root.render(
		<App
			accounts={accounts}
			initialSession={{
				version: 1,
				activeId: "workspace-1",
				tabs: [
					{ id: "workspace-1", path: "/test/project", draft: "Keep draft" },
				],
			}}
			readRepository={async () => ({
				ok: true,
				value: { ...snapshot, remoteCount: 1 },
			})}
			readBranches={branches}
			readPullRequest={read}
			readComparison={compare}
			readHistory={history}
			fetchRepository={fetch}
			writeSyncRepository={sync}
		/>
	);
}

async function open() {
	show();
	await settle();
	click("rail-sync", 2);
	await settle();
}

it("opens a read-only preview from the rail and fits the minimum window width", async () => {
	await open();

	expect(menuLabels).toContain("Preview pull request…");
	expect(menuEnabled[menuLabels.indexOf("Preview pull request…")]).toBe(true);
	expect(compare).toHaveBeenCalledWith(
		"/test/project",
		base,
		head,
		expect.any(AbortSignal)
	);
	expect(fetch).not.toHaveBeenCalled();
	expect(sync).not.toHaveBeenCalled();
	expect(browser).not.toHaveBeenCalled();
	expect(root.renderer.findByTestId("pull-request-source")).toBeTruthy();
	expect(root.renderer.findByTestId("swap-comparison")).toBeUndefined();
	expect(
		bounds("refresh-pull-request").x -
			bounds("close-comparison").x -
			bounds("close-comparison").width
	).toBeCloseTo(4, 0);
	expect(root.renderer.findByTestId("pull-request-notice")).toBeUndefined();
	expect(root.renderer.getAllText().join(" ")).not.toContain(
		"Only committed changes are included"
	);
	expect(bounds("refresh-pull-request").y).toBeCloseTo(
		bounds("close-comparison").y,
		0
	);
	expect(bounds("continue-pull-request").x).toBeGreaterThanOrEqual(
		bounds("comparison-branch-pair").x + bounds("comparison-branch-pair").width
	);
	expect(
		bounds("continue-pull-request").x + bounds("continue-pull-request").width
	).toBeLessThanOrEqual(980);

	click("close-comparison");
	await settle();
	expect(root.renderer.findByTestId("branch-comparison")).toBeUndefined();
	expect(root.renderer.findByTestId("commit-message")?.customProps?.value).toBe(
		"Keep draft"
	);
});

it("refreshes the preview from the Back toolbar without uploading or opening the browser", async () => {
	await open();
	click("refresh-pull-request");
	await settle();
	expect(fetch).toHaveBeenCalledTimes(1);
	expect(read).toHaveBeenCalledTimes(2);
	expect(sync).not.toHaveBeenCalled();
	expect(browser).not.toHaveBeenCalled();
});

it("keeps actionable notices without the default informational strip", async () => {
	data = { ...data, notice: "Sign in to preview existing pull requests." };
	await open();

	expect(root.renderer.findByTestId("pull-request-notice")).toBeTruthy();
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Sign in to preview existing pull requests."
	);
});

it("supports Control-click and the Compare toolbar without triggering normal sync", async () => {
	menuChoice = "Compare branches…";
	show();
	await settle();
	click("rail-sync", 0, "ctrl");
	await settle();
	expect(
		bounds("preview-pull-request").x + bounds("preview-pull-request").width
	).toBeLessThanOrEqual(980);
	click("preview-pull-request");
	await settle();

	expect(root.renderer.findByTestId("continue-pull-request")).toBeTruthy();
	expect(fetch).not.toHaveBeenCalled();
	expect(sync).not.toHaveBeenCalled();
});

it("checks remote status then opens the creation page without committing or pushing", async () => {
	await open();
	click("continue-pull-request");
	await settle();

	expect(fetch).toHaveBeenCalledTimes(1);
	expect(read).toHaveBeenCalledTimes(2);
	expect(browser).toHaveBeenCalledWith(
		"https://github.com/team/app/compare/main...feature%2Fui?expand=1"
	);
	expect(sync).not.toHaveBeenCalled();
	expect(root.renderer.getPaintedText().join(" ")).toContain(
		"Nothing was submitted"
	);
});

it.each(["publish", "push"] as const)(
	"requires a separate explicit %s before browser handoff",
	async (kind) => {
		data = {
			...data,
			publishedHead: kind === "publish" ? null : "old-head",
			uploadKind: kind,
		};
		await open();
		click("continue-pull-request");
		await settle();

		expect(sync).toHaveBeenCalledWith(
			"/test/project",
			expect.objectContaining({
				kind,
				remote: "origin",
				remoteRef: "refs/heads/feature/ui",
				expectedHead: head,
				expectedBranch: "feature/ui",
			}),
			expect.any(AbortSignal),
			undefined,
			expect.any(Function)
		);
		expect(browser).not.toHaveBeenCalled();
		expect(root.renderer.getPaintedText().join(" ")).toContain(
			"Continue on GitHub"
		);
		click("continue-pull-request");
		await settle();
		expect(browser).toHaveBeenCalledTimes(1);
	}
);

it("does not open the browser or push after a failed fetch", async () => {
	fetch.mockImplementation(async () => ({
		ok: false,
		error: {
			code: "command-failed",
			operation: "fetch",
			message: "Reconnect your account.",
			retryable: true,
		},
	}));
	await open();
	click("continue-pull-request");
	await settle();

	expect(browser).not.toHaveBeenCalled();
	expect(sync).not.toHaveBeenCalled();
	expect(read).toHaveBeenCalledTimes(1);
	expect(root.renderer.getPaintedText().join(" ")).toContain(
		"Reconnect your account"
	);
});

it("requires another review when the destination branch changes during fetch", async () => {
	await open();
	data = {
		...data,
		comparison: {
			...data.comparison,
			base: "c".repeat(40),
			branches: data.comparison.branches.map((item) =>
				item.label === "main" ? { ...item, oid: "c".repeat(40) } : item
			),
		},
	};
	click("continue-pull-request");
	await settle();

	expect(browser).not.toHaveBeenCalled();
	expect(root.renderer.getPaintedText().join(" ")).toContain(
		"Branches changed"
	);
	expect(compare).toHaveBeenLastCalledWith(
		"/test/project",
		"c".repeat(40),
		head,
		expect.any(AbortSignal)
	);
	click("continue-pull-request");
	await settle();
	expect(browser).toHaveBeenCalledTimes(1);
});

it("uses GitLab terminology and opens an existing matching merge request", async () => {
	data = {
		...data,
		identity: {
			...data.identity,
			providerId: "gitlab",
			browserUrl: "https://gitlab.com/group/sub/app",
		},
		requests: [
			{
				id: "2",
				number: 34,
				title: "UI",
				description: null,
				state: "open",
				draft: true,
				sourceBranch: "feature/ui",
				targetBranch: "main",
				sourceRepositoryId: "7",
				browserUrl: "https://untrusted.invalid/",
			},
		],
	};
	await open();

	expect(root.renderer.getPaintedText().join(" ")).toContain(
		"View merge request #34"
	);
	click("continue-pull-request");
	await settle();
	expect(browser).toHaveBeenCalledWith(
		"https://gitlab.com/group/sub/app/-/merge_requests/34"
	);
});

it("ignores a late read after leaving the preview", async () => {
	let finish: ((value: PullRequestPreview) => void) | undefined;
	let signal: AbortSignal | undefined;

	read.mockImplementation(async (_root, requestSignal) => {
		signal = requestSignal;

		return new Promise((resolve) => {
			finish = resolve;
		});
	});
	await open();
	root.render(<div>Other view</div>);
	await settle();
	finish?.(data);
	await settle();

	expect(signal?.aborted).toBe(true);
	expect(browser).not.toHaveBeenCalled();
	expect(root.renderer.findByTestId("continue-pull-request")).toBeUndefined();
});
