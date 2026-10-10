/**
 * Covers: native History clipboard/browser actions, exact revert confirmation, cancellation, eligibility, linked-tab locks and conflict/failure UI.
 * Real: App, reducers, mutations and native GPUIX rendering/events.
 * Doubles: Git readers/writers, browser/clipboard actions, AppKit menu choice and close notifications; no actual Git writes.
 * Requires: patched GPUIX/macOS graphics.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import type { RepositorySnapshot } from "@1git/git";
import { App } from "../../src/app";
import { windowOptions } from "../../src/window-options";
import { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import type { RepositoryCommit } from "../../src/feature/repository-workspace/lib/repository-commit";
import { RepositoryOperation } from "../../src/feature/repository-workspace/lib/repository-operation";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";
import { commitInfo, historyPage } from "../_shared/history-page";
import { NativeClipboard } from "../../src/platform/clipboard";
import { NativeBrowser } from "../../src/platform/browser";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { GitLabProvider } from "@1git/hosting/providers/gitlab";

let root: TestRoot;
let menuLabels: string[];
let menuEnabled: boolean[];
let blocked: boolean;
let menuChoice: string;

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
	menuChoice = "Revert commit…";
	spyOn(RepositoryHistory, "readCommitLink").mockResolvedValue(null);
	Object.assign(root.renderer, {
		showContextMenuItems(labels: string[], enabled: boolean[]) {
			menuLabels = labels;
			menuEnabled = enabled;

			return labels.indexOf(menuChoice);
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

it.each([false, true])(
	"opens Amend from History only for its unpublished tip (published: %s)",
	async (published) => {
		const tip = commitInfo(0);

		const readLast = mock<typeof RepositoryCommit.readLast>(async () => ({
			ok: true,
			value: {
				commit: tip,
				undoUnavailableReason: published ? "Already published" : null,
			},
		}));

		menuChoice = "Amend last commit…";
		root.render(
			<App
				initialSession={session}
				readRepository={async () => ({
					ok: true,
					value: {
						...repositorySnapshot([changedFile("dirty.txt")]),
						head: { ...repositorySnapshot().head, oid: tip.oid },
					},
				})}
				readLastCommit={readLast}
				readHistory={readHistory}
				readCommitFiles={readCommitFiles}
			/>
		);
		await openHistory();
		await openMenu(1);
		expect(menuEnabled[menuLabels.indexOf(menuChoice)]).toBe(false);
		expect(root.renderer.findByTestId("amend-header")).toBeUndefined();
		await openMenu(0);
		expect(menuEnabled[menuLabels.indexOf(menuChoice)]).toBe(!published);

		if (published) {
			expect(root.renderer.findByTestId("amend-header")).toBeUndefined();

			return;
		}

		expect(element("amend-header")).toBeDefined();
		expect(element("commit-message").customProps?.value).toBe(tip.body);
		click("amend-cancel");
		await settle();
		expect(element("commit-message").customProps?.value).toBe("Keep draft");
	}
);

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
	expect(menuLabels).toEqual([
		"Copy SHA",
		"Copy Message",
		"View on GitHub/GitLab",
		"",
		"Amend last commit…",
		"Squash selected commits…",
		"Cherry-pick commit…",
		"Revert commit…",
		"",
		"Create tag…",
	]);
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
		expect(menuEnabled[menuLabels.indexOf("Revert commit…")]).toBe(false);
		expect(menuEnabled.slice(0, 3)).toEqual([true, true, false]);
		expect(menuLabels.length).toBe(11);
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
	expect(menuEnabled[menuLabels.indexOf("Revert commit…")]).toBe(false);
	expect(write).toHaveBeenCalledTimes(1);
});

it("copies the clicked commit's full SHA and message without changing the selected commit or draft", async () => {
	const copy = spyOn(NativeClipboard, "write").mockResolvedValue();
	const browse = spyOn(NativeBrowser, "open").mockResolvedValue();
	const write = mock<typeof RepositoryHistory.revert>();
	const message = "Commit 1\n\nFirst paragraph.\n\nSecond paragraph.";
	const page = historyPage(0, 3);

	root.render(
		<App
			initialSession={session}
			readRepository={async () => ({
				ok: true,
				value: repositorySnapshot([changedFile("a.txt")]),
			})}
			readHistory={async () => ({
				ok: true,
				value: {
					...page,
					commits: page.commits.map((commit, index) => ({
						...commit,
						body: index === 1 ? message : "",
					})),
				},
			})}
			readCommitFiles={readCommitFiles}
			revertCommit={write}
		/>
	);
	await openHistory();
	click(`entry-${commitInfo(2).oid}`);
	menuChoice = "Copy SHA";
	await openMenu();
	expect(copy).toHaveBeenLastCalledWith(commitInfo(1).oid);
	expect(menuEnabled[menuLabels.indexOf("Revert commit…")]).toBe(false);
	expect(
		element(`entry-${commitInfo(2).oid}`).customProps?.["aria-selected"]
	).toBe(true);

	menuChoice = "Copy Message";
	click(`entry-${commitInfo(1).oid}`, 0, "ctrl");
	await settle();
	expect(copy).toHaveBeenLastCalledWith(message);
	const entry = element(`entry-${commitInfo(0).oid}`);

	root.renderer.focusElement(entry.id);
	root.renderer.nativeSimulateKeyDown(entry.id, "shift-f10");
	await settle();
	expect(copy).toHaveBeenLastCalledWith("Commit 0");
	expect(root.renderer.findByTestId("revert-dialog")).toBeUndefined();
	expect(write).not.toHaveBeenCalled();
	expect(browse).not.toHaveBeenCalled();
	click("view-changes");
	await settle();
	expect(element("commit-message").customProps?.value).toBe("Keep draft");
});

it.each(["GitHub", "GitLab"] as const)(
	"opens the clicked commit on %s without a Git write, and surfaces browser failure",
	async (provider) => {
		const configured = new GitLabProvider({
			webUrl: "https://gitlab.example.invalid",
		});

		spyOn(Accounts.prototype, "hostProviders").mockResolvedValue([configured]);
		const url = `https://${provider.toLowerCase()}.com/test/project/${provider === "GitHub" ? "commit" : "-/commit"}/${commitInfo(1).oid}`;

		const read = spyOn(RepositoryHistory, "readCommitLink").mockResolvedValue({
			label: `View on ${provider}`,
			url,
		});

		const browse = spyOn(NativeBrowser, "open").mockResolvedValue();
		const copy = spyOn(NativeClipboard, "write").mockResolvedValue();
		const write = mock<typeof RepositoryHistory.revert>();

		root.render(
			<App
				initialSession={session}
				readRepository={async () => ({ ok: true, value: repositorySnapshot() })}
				readHistory={readHistory}
				readCommitFiles={readCommitFiles}
				revertCommit={write}
			/>
		);
		await openHistory();
		click(`entry-${commitInfo(2).oid}`);
		menuChoice = `View on ${provider}`;
		await openMenu();
		expect(read.mock.calls[0]?.slice(0, 2)).toEqual([
			"/test/project",
			commitInfo(1).oid,
		]);
		expect(read.mock.calls[0]?.[3]).toEqual([configured]);
		expect(browse).toHaveBeenCalledWith(url);
		expect(copy).not.toHaveBeenCalled();
		expect(write).not.toHaveBeenCalled();
		expect(root.renderer.findByTestId("revert-dialog")).toBeUndefined();

		browse.mockRejectedValue(
			new Error("Could not open the browser. Try again.")
		);
		await openMenu();
		expect(
			element("history-menu-error")
				.children.map((id) => root.renderer.getElement(id)?.text)
				.join("")
		).toBe("Could not open the browser. Try again.");
	}
);

it("disables unsupported browser viewing, keeps copying after lookup failure, and reports clipboard errors", async () => {
	const read = spyOn(RepositoryHistory, "readCommitLink");
	const copy = spyOn(NativeClipboard, "write").mockResolvedValue();
	const browse = spyOn(NativeBrowser, "open").mockResolvedValue();

	root.render(
		<App
			initialSession={session}
			readRepository={async () => ({ ok: true, value: repositorySnapshot() })}
			readHistory={readHistory}
			readCommitFiles={readCommitFiles}
		/>
	);
	await openHistory();
	menuChoice = "View on GitHub/GitLab";
	await openMenu();
	expect(menuEnabled[menuLabels.indexOf(menuChoice)]).toBe(false);
	expect(browse).not.toHaveBeenCalled();

	read.mockRejectedValue(new Error("Remote metadata unavailable"));
	menuChoice = "Copy SHA";
	await openMenu();
	expect(copy).toHaveBeenCalledWith(commitInfo(1).oid);
	expect(element("history-menu-error")).toBeDefined();
	copy.mockRejectedValue(new Error("Could not copy to the clipboard."));
	await openMenu();
	expect(
		element("history-menu-error")
			.children.map((id) => root.renderer.getElement(id)?.text)
			.join("")
	).toBe("Could not copy to the clipboard.");
});

it("does not open a delayed menu after leaving History", async () => {
	const lookup =
		Promise.withResolvers<
			Awaited<ReturnType<typeof RepositoryHistory.readCommitLink>>
		>();

	const read = spyOn(RepositoryHistory, "readCommitLink").mockImplementation(
		() => lookup.promise
	);

	const copy = spyOn(NativeClipboard, "write").mockResolvedValue();

	root.render(
		<App
			initialSession={session}
			readRepository={async () => ({ ok: true, value: repositorySnapshot() })}
			readHistory={readHistory}
			readCommitFiles={readCommitFiles}
		/>
	);
	await openHistory();
	menuChoice = "Copy SHA";
	click(`entry-${commitInfo(1).oid}`, 2);
	await settle();
	click("view-changes");
	await settle();
	lookup.resolve(null);
	await settle();
	expect(read.mock.calls[0]?.[2].aborted).toBe(true);
	expect(menuLabels).toEqual([]);
	expect(copy).not.toHaveBeenCalled();
});
