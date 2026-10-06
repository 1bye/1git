/**
 * Covers: native History menu, exact commit confirmation, cancellation, eligibility, linked-tab locks and conflict/failure UI.
 * Real: App, reducers, mutations and native GPUIX rendering/events.
 * Doubles: Git readers/writers, AppKit menu choice and close notifications; no actual Git writes.
 * Requires: patched GPUIX/macOS graphics.
 */
import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import type { RepositorySnapshot } from "@1git/git";
import { App } from "../../src/app";
import { windowOptions } from "../../src/window-options";
import { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import { RepositoryOperation } from "../../src/feature/repository-workspace/lib/repository-operation";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";
import { commitInfo, historyPage } from "../_shared/history-page";

let root: TestRoot;
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
	menuLabels = [];
	menuEnabled = [];
	blocked = false;
	Object.assign(root.renderer, {
		showContextMenu(labels: string[], enabled: boolean[]) {
			menuLabels = labels;
			menuEnabled = enabled;

			return 0;
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

const readHistory: typeof RepositoryHistory.read = async () => ({
	ok: true,
	value: historyPage(0, 3),
});

const readCommitFiles: typeof RepositoryHistory.readFiles = async () => ({
	ok: true,
	value: [],
});

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

const openHistory = async () => {
	await settle();
	click("view-history");
	await settle();
};

const openMenu = async (index = 1) => {
	click(`entry-${commitInfo(index).oid}`, 2);
	await settle();
};

it("confirms the clicked commit, not the selected one, and supports cancel, Control-click and keyboard menus", async () => {
	let finished = false;

	const write = mock<typeof RepositoryHistory.revert>(async () => {
		finished = true;

		return { ok: true, value: repositorySnapshot() };
	});

	const pages = mock(readHistory);

	root.render(
		<App
			initialSession={session}
			readRepository={async () => ({
				ok: true,
				value: {
					...repositorySnapshot(),
					head: {
						...repositorySnapshot().head,
						oid: finished ? "f".repeat(40) : "1234567890abcdef",
					},
				},
			})}
			readHistory={pages}
			readCommitFiles={readCommitFiles}
			revertCommit={write}
		/>
	);
	await openHistory();
	click(`entry-${commitInfo(2).oid}`);
	await openMenu();
	expect(menuLabels).toEqual(["Revert commit…"]);
	expect(
		element("revert-commit")
			.children.map((id) => root.renderer.getElement(id)?.text)
			.join("")
	).toBe("Commit 1");
	expect(write).not.toHaveBeenCalled();

	if (process.env.GPUIX_REVERT_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_REVERT_SCREENSHOT);

	click("revert-cancel");
	await settle();
	expect(root.renderer.findByTestId("revert-dialog")).toBeUndefined();
	click(`entry-${commitInfo(1).oid}`, 0, "ctrl");
	await settle();
	expect(element("revert-dialog")).toBeDefined();
	click("revert-cancel");
	await settle();
	const entry = element(`entry-${commitInfo(1).oid}`);

	root.renderer.focusElement(entry.id);
	root.renderer.nativeSimulateKeyDown(entry.id, "shift-f10");
	await settle();
	click("revert-confirm");
	await settle();
	expect(write).toHaveBeenCalledTimes(1);
	expect(write.mock.calls[0]?.[1]).toMatchObject({
		commit: commitInfo(1).oid,
		expectedHead: "1234567890abcdef",
		expectedBranch: "main",
	});
	expect(element("operation-result")).toBeDefined();
	expect(element("commit-message").customProps?.value).toBe("Keep draft");
	click("view-history");
	await settle();
	expect(pages.mock.calls.some((call) => call[1] === "f".repeat(40))).toBe(
		true
	);
});

for (const reason of ["dirty", "merge", "detached", "operation"] as const) {
	it(`does not offer a writable revert for ${reason} state`, async () => {
		const write = mock<typeof RepositoryHistory.revert>(async () => ({
			ok: true,
			value: repositorySnapshot(),
		}));

		const snapshot = repositorySnapshot(
			reason === "dirty" ? [changedFile("a.txt")] : []
		);

		root.render(
			<App
				initialSession={session}
				readRepository={async () => ({
					ok: true,
					value: {
						...snapshot,
						head: {
							...snapshot.head,
							detached: reason === "detached",
							branch: reason === "detached" ? null : "main",
						},
						operationState: reason === "operation" ? "merge" : "normal",
					},
				})}
				readHistory={async () => ({
					ok: true,
					value: {
						...historyPage(0, 3),
						commits: [
							commitInfo(0),
							{
								...commitInfo(1),
								parentOids: reason === "merge" ? ["a", "b"] : [],
							},
						],
					},
				})}
				readCommitFiles={readCommitFiles}
				revertCommit={write}
			/>
		);
		await openHistory();
		await openMenu();
		expect(menuEnabled[0]).toBe(false);
		expect(menuLabels.length).toBe(2);
		expect(root.renderer.findByTestId("revert-dialog")).toBeUndefined();
		expect(write).not.toHaveBeenCalled();
	});
}

it("keeps all linked tabs and window close locked through the write and every refresh", async () => {
	const pending =
		Promise.withResolvers<
			Awaited<ReturnType<typeof RepositoryHistory.revert>>
		>();

	const refreshed = Promise.withResolvers<{
		ok: true;
		value: RepositorySnapshot;
	}>();

	let finished = false;
	const write = mock<typeof RepositoryHistory.revert>(() => pending.promise);

	const linked = {
		...repositorySnapshot(),
		repository: {
			...repositorySnapshot().repository,
			root: "/test/linked",
			gitDirectory: "/test/project/.git/worktrees/linked",
		},
	};

	root.render(
		<App
			initialSession={{
				...session,
				tabs: [
					...session.tabs,
					{ id: "workspace-2", path: "/test/linked", draft: "Other draft" },
				],
			}}
			readRepository={async (path) =>
				path === "/test/linked"
					? finished
						? await refreshed.promise
						: { ok: true, value: linked }
					: { ok: true, value: repositorySnapshot() }
			}
			readHistory={readHistory}
			readCommitFiles={readCommitFiles}
			revertCommit={write}
		/>
	);
	await openHistory();
	await openMenu();
	click("revert-confirm");
	await settle();
	expect(blocked).toBe(true);
	root.renderer.nativeSimulateKeyDown(element("revert-confirm").id, "escape");
	await settle();
	expect(element("revert-dialog")).toBeDefined();
	click("revert-confirm");
	expect(write).toHaveBeenCalledTimes(1);
	finished = true;
	pending.resolve({ ok: true, value: repositorySnapshot() });
	await settle();
	expect(blocked).toBe(true);
	refreshed.resolve({ ok: true, value: linked });
	await settle();
	expect(blocked).toBe(false);
	expect(root.renderer.findByTestId("revert-dialog")).toBeUndefined();
	expect(element("operation-result")).toBeDefined();
});

it("shows conflicts in Changes and offers captured Abort instead of retrying the revert", async () => {
	let conflicted = false;

	const write = mock<typeof RepositoryHistory.revert>(async () => {
		conflicted = true;

		return {
			ok: false,
			error: {
				code: "conflict",
				operation: "revert",
				message: "Revert paused with conflicts.",
				retryable: false,
			},
		};
	});

	const finish = mock<typeof RepositoryOperation.write>(async () => {
		conflicted = false;

		return { ok: true, value: repositorySnapshot() };
	});

	root.render(
		<App
			initialSession={session}
			readRepository={async () => ({
				ok: true,
				value: conflicted
					? {
							...repositorySnapshot([
								changedFile("a.txt", {
									recordType: "unmerged",
									worktreeStatus: "unmerged",
								}),
							]),
							operationState: "revert",
							operationToken: "reviewed-revert",
						}
					: repositorySnapshot(),
			})}
			readHistory={readHistory}
			readCommitFiles={readCommitFiles}
			revertCommit={write}
			writeOperation={finish}
		/>
	);
	await openHistory();
	await openMenu();
	click("revert-confirm");
	await settle();
	expect(element("operation-status")).toBeDefined();
	click("operation-continue");
	expect(finish).not.toHaveBeenCalled();
	click("operation-abort");
	await settle();
	click("operation-abort-confirm");
	await settle();
	expect(finish.mock.calls[0]?.[1]).toMatchObject({
		kind: "abort",
		expectedOperation: "revert",
		expectedToken: "reviewed-revert",
	});
	expect(write).toHaveBeenCalledTimes(1);
	expect(root.renderer.findByTestId("operation-continue")).toBeUndefined();
});

it("requires a fresh read after an indeterminate outcome instead of allowing a second write", async () => {
	let finished = false;

	const failure = {
		ok: false as const,
		error: {
			code: "command-failed" as const,
			operation: "revert" as const,
			message: "Could not read repository",
			retryable: false,
		},
	};

	const write = mock<typeof RepositoryHistory.revert>(async () => {
		finished = true;

		throw new Error("Process outcome unknown");
	});

	root.render(
		<App
			initialSession={session}
			readRepository={async () =>
				finished ? failure : { ok: true, value: repositorySnapshot() }
			}
			readHistory={readHistory}
			readCommitFiles={readCommitFiles}
			revertCommit={write}
		/>
	);
	await openHistory();
	await openMenu();
	click("revert-confirm");
	await settle();
	expect(element("repository-notice")).toBeDefined();
	click("view-history");
	await settle();
	await openMenu();
	expect(menuEnabled[0]).toBe(false);
	expect(write).toHaveBeenCalledTimes(1);
});
