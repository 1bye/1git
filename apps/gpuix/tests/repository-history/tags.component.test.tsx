/**
 * Covers: compact History tag labels, explicit create/push confirmation, destination choice, metadata refresh, errors and linked-tab locks.
 * Real: App, reducers, window-owned mutations, GPUIX controls/layout/focus.
 * Doubles: Git reads/writes, AppKit menu selection and window close callbacks; no repository/account/network writes.
 * Requires: patched GPUIX/macOS graphics.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import type { ComponentProps } from "react";
import type { RemoteInfo, RepositorySnapshot, TagInfo } from "@1git/git";
import { App } from "../../src/app";
import { windowOptions } from "../../src/window-options";
import { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import { RepositoryTags } from "../../src/feature/repository-workspace/lib/repository-tags";
import { RepositorySync } from "../../src/feature/repository-workspace/lib/repository-sync";
import {
	repositorySnapshot,
	changedFile,
} from "../_shared/repository-snapshot";
import { commitInfo, historyPage } from "../_shared/history-page";

let root: TestRoot;
let snapshot: RepositorySnapshot;
let tags: readonly TagInfo[];
let labels: string[];
let enabled: boolean[];
let parents: number[];
let choice: string;
let blocked: boolean;

const session = {
	version: 1 as const,
	activeId: "workspace-1",
	tabs: [{ id: "workspace-1", path: "/test/project", draft: "Keep draft" }],
};

const release = (name = "v1.0.0", target = commitInfo(1).oid): TagInfo => ({
	name,
	targetOid: target,
	oid: "e".repeat(40),
	type: "annotated",
	createdAt: null,
	message: "Release",
});

const origin: RemoteInfo = {
	name: "origin",
	defaultBranch: null,
	fetchUrls: ["https://github.com/team/repo.git"],
	pushUrls: ["git@github.com:team/repo.git"],
};

beforeEach(() => {
	root = createTestRoot({
		width: 1100,
		height: 760,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	snapshot = {
		...repositorySnapshot([changedFile("dirty.txt")]),
		head: { ...repositorySnapshot().head, oid: commitInfo(0).oid },
	};
	tags = [];
	labels = [];
	enabled = [];
	parents = [];
	choice = "Create tag…";
	blocked = false;
	spyOn(RepositoryHistory, "readCommitLink").mockResolvedValue(null);
	Object.assign(root.renderer, {
		showContextMenuItems(
			nextLabels: string[],
			nextEnabled: boolean[],
			nextParents: number[]
		) {
			labels = nextLabels;
			enabled = nextEnabled;
			parents = nextParents;

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

const readBranches: NonNullable<
	ComponentProps<typeof App>["readBranches"]
> = async () => ({
	ok: true,
	value: {
		branches: { current: "main", branches: [] },
		worktrees: [],
		remotes: [origin],
	},
});

function renderApp(props: ComponentProps<typeof App> = {}) {
	root.render(
		<App
			initialSession={session}
			readRepository={async () => ({ ok: true, value: snapshot })}
			readHistory={async () => ({ ok: true, value: historyPage(0, 3) })}
			readCommitFiles={async () => ({ ok: true, value: [] })}
			readTags={async () => ({ ok: true, value: tags })}
			readLastCommit={async () => ({
				ok: true,
				value: { commit: commitInfo(0), undoUnavailableReason: null },
			})}
			readBranches={readBranches}
			createTag={async () => {
				throw new Error("Unexpected tag creation");
			}}
			pushTag={async () => {
				throw new Error("Unexpected tag push");
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
async function type(id: string, value: string) {
	click(id);
	root.renderer.simulateKeystrokes("cmd-a");
	root.renderer.simulateKeystrokes(
		[...value]
			.map((character) => (character === " " ? "space" : character))
			.join(" ")
	);
	await settle();
}
async function openHistory() {
	await settle();
	click("view-history");
	await settle();
}
async function openMenu(index = 1) {
	click(`entry-${commitInfo(index).oid}`, 2);
	await settle();
}

it("shows compact tag labels, all names in accessibility and a tag-specific Push submenu", async () => {
	tags = [release(), { ...release("preview"), type: "lightweight" }];
	choice = "none";
	renderApp();
	await openHistory();
	expect(text(`tags-${commitInfo(1).oid}`)).toBe("v1.0.0 +1");
	expect(
		element(`entry-${commitInfo(1).oid}`).customProps?.["aria-description"]
	).toContain("v1.0.0, preview");
	await openMenu();
	expect(enabled[labels.indexOf("Create tag…")]).toBe(true); // Dirty work does not prevent tagging.
	expect(parents[labels.indexOf("v1.0.0")]).toBe(labels.indexOf("Push tag…"));
	expect(parents[labels.indexOf("preview")]).toBe(labels.indexOf("Push tag…"));
	await openMenu(2);
	expect(labels).not.toContain("Push tag…");
});

it("confirms the clicked historical commit, cancels without writing, and refreshes labels even with the same HEAD", async () => {
	const pages = mock(async () => ({
		ok: true as const,
		value: historyPage(0, 3),
	}));

	const create = mock<typeof RepositoryTags.create>(async (_root, input) => {
		tags = [release(input.name, input.commit)];

		return { ok: true, value: snapshot };
	});

	const push = mock<typeof RepositorySync.pushTag>();

	renderApp({ readHistory: pages, createTag: create, pushTag: push });
	await settle();
	click("include-dirty.txt");
	await openHistory();
	click(`entry-${commitInfo(2).oid}`);
	await openMenu();
	expect(create).not.toHaveBeenCalled();
	click("tag-cancel");
	await settle();
	expect(root.renderer.findByTestId("tag-dialog")).toBeUndefined();
	await openMenu();
	await type("tag-name", "v1.0.0");
	await type("tag-message", "Reviewed release");

	if (process.env.GPUIX_TAG_CREATE_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_TAG_CREATE_SCREENSHOT);

	click("tag-confirm");
	await settle();
	expect(create.mock.calls[0]?.[1]).toMatchObject({
		name: "v1.0.0",
		message: "Reviewed release",
		commit: commitInfo(1).oid,
		expectedHead: commitInfo(0).oid,
		expectedBranch: "main",
	});
	expect(create).toHaveBeenCalledTimes(1);
	expect(push).not.toHaveBeenCalled();
	expect(root.renderer.findByTestId("tag-dialog")).toBeUndefined();
	expect(text(`tags-${commitInfo(1).oid}`)).toBe("v1.0.0");
	expect(pages).toHaveBeenCalledTimes(1);
	expect(text("operation-result")).toContain("created locally");
	expect(text("repository-view-title")).toBe("History");
	click("view-changes");
	await settle();
	expect(element("commit-message").customProps?.value).toBe("Keep draft");
	expect(text("repository-heading")).toBe("1 of 1 selected");
});

it("pushes only after choosing a destination and confirming the exact selected tag, without auto-retry on failure", async () => {
	tags = [release()];
	choice = "v1.0.0";
	const push = mock<typeof RepositorySync.pushTag>(async () => ({
		ok: false,
		error: {
			operation: "push-tag",
			code: "command-failed",
			retryable: false,
			message: "Tag push outcome unknown. Inspect the remote before retrying.",
		},
	}));

	renderApp({ pushTag: push });
	await openHistory();
	await openMenu();
	expect(push).not.toHaveBeenCalled();
	click("tag-confirm");
	await settle();
	expect(push).not.toHaveBeenCalled();
	click("tag-remote");
	await settle();
	click("tag-remote-origin");
	await settle();
	expect(text("tag-destination")).toBe(origin.pushUrls[0] ?? "");

	if (process.env.GPUIX_TAG_PUSH_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_TAG_PUSH_SCREENSHOT);

	click("tag-confirm");
	await settle();
	expect(push.mock.calls[0]?.[1]).toMatchObject({
		name: tags[0]?.name,
		expectedOid: tags[0]?.oid,
		expectedTarget: tags[0]?.targetOid,
		remote: "origin",
		expectedUrl: origin.pushUrls[0],
		expectedHead: commitInfo(0).oid,
		expectedBranch: "main",
	});
	expect(text("tag-error")).toContain("Inspect the remote");
	expect(element("tag-dialog")).toBeDefined();
	await settle();
	expect(push).toHaveBeenCalledTimes(1);
	click("tag-cancel");
	await settle();
	expect(root.renderer.findByTestId("tag-dialog")).toBeUndefined();
});

it("keeps all related tabs and the window protected until tag creation and every refresh finish", async () => {
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryTags.create>>>();

	const refreshed = Promise.withResolvers<{
		ok: true;
		value: RepositorySnapshot;
	}>();

	let finished = false;

	const linked = {
		...snapshot,
		repository: { ...snapshot.repository, root: "/test/linked" },
		head: { ...snapshot.head, branch: "linked" },
	};

	const read = mock(async (path: string) =>
		path === "/test/linked"
			? finished
				? await refreshed.promise
				: { ok: true as const, value: linked }
			: { ok: true as const, value: snapshot }
	);

	const create = mock<typeof RepositoryTags.create>(() => pending.promise);

	renderApp({
		initialSession: {
			...session,
			tabs: [
				...session.tabs,
				{ id: "workspace-2", path: "/test/linked", draft: "Linked draft" },
			],
		},
		readRepository: read,
		createTag: create,
	});
	await openHistory();
	await openMenu();
	await type("tag-name", "v2");
	click("tag-confirm");
	await settle();
	expect(blocked).toBe(true);
	click("tag-confirm");
	click("tag-cancel");
	root.renderer.nativeSimulateKeyDown(element("tag-confirm").id, "escape");
	await settle();
	expect(element("tag-dialog")).toBeDefined();
	expect(create).toHaveBeenCalledTimes(1);
	expect(create.mock.calls[0]?.[1].message).toBe("Release v2");
	finished = true;
	tags = [release("v2")];
	pending.resolve({ ok: true, value: snapshot });
	await settle();
	expect(blocked).toBe(true);
	refreshed.resolve({ ok: true, value: linked });
	await settle();
	expect(blocked).toBe(false);
	expect(
		read.mock.calls.filter(([path]) => path === "/test/linked")
	).toHaveLength(2);
	expect(root.renderer.findByTestId("tag-dialog")).toBeUndefined();
	expect(text(`tags-${commitInfo(1).oid}`)).toBe("v2");
});

it("disables multi-destination remote choices and tag writes while a Git operation is active", async () => {
	tags = [release()];
	choice = "v1.0.0";
	const push = mock<typeof RepositorySync.pushTag>();

	renderApp({
		pushTag: push,
		readBranches: async () => ({
			ok: true,
			value: {
				branches: { current: "main", branches: [] },
				worktrees: [],
				remotes: [{ ...origin, pushUrls: ["/tmp/a", "/tmp/b"] }],
			},
		}),
	});
	await openHistory();
	await openMenu();
	click("tag-remote");
	await settle();
	click("tag-remote-origin");
	await settle();
	click("tag-confirm");
	await settle();
	expect(push).not.toHaveBeenCalled();
	root.renderer.nativeSimulateKeyDown(element("tag-remote").id, "escape");
	await settle();

	if (root.renderer.findByTestId("tag-cancel")) {
		click("tag-cancel");
		await settle();
	}

	snapshot = { ...snapshot, operationState: "merge", operationToken: "active" };
	click("refresh-repository");
	await settle();
	await openMenu();
	expect(enabled[labels.indexOf("Create tag…")]).toBe(false);
	expect(enabled[labels.indexOf("Push tag…")]).toBe(false);
});

it("reports failed tag reads without hiding History, retries and ignores late results after refresh", async () => {
	const late =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryTags.read>>>();

	const read = mock<typeof RepositoryTags.read>();

	read.mockResolvedValueOnce({
		ok: false,
		error: {
			operation: "get-tags",
			code: "command-failed",
			retryable: true,
			message: "Cannot read tags",
		},
	});
	read.mockImplementationOnce(() => late.promise);
	read.mockResolvedValue({ ok: true, value: [release()] });
	renderApp({ readTags: read });
	await openHistory();
	expect(element(`entry-${commitInfo(1).oid}`)).toBeDefined();
	expect(element("retry-tags")).toBeDefined();
	click("retry-tags");
	await settle();
	click("refresh-repository");
	await settle();
	expect(read.mock.calls[1]?.[1].aborted).toBe(true);
	late.resolve({ ok: true, value: [release("obsolete")] });
	await settle();
	expect(text(`tags-${commitInfo(1).oid}`)).toBe("v1.0.0");
	expect(root.renderer.findByTestId("retry-tags")).toBeUndefined();
});
