/**
 * Covers: Command P, focused search, navigation, dismissal, local/SSH opening, discovery and bounded rendering.
 * Real: App, switcher, session/tab models and GPUIX layout/input.
 * Doubles: repository reads, scans, account/machine catalogs and artwork; no user data or network.
 * Requires: patched GPUIX addon with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import type { ComponentProps } from "react";
import type { RepositorySnapshot } from "@1git/git";
import { App } from "../../src/app";
import { windowOptions } from "../../src/window-options";
import { appThemes } from "../../src/styles/theme";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import { Machines } from "../../src/feature/machines/machines";
import { MachineStore } from "../../src/feature/machines/machine-store";
import { MachineLocation } from "../../src/feature/machines/machine-location";
import { RepositoryDiscovery } from "../../src/feature/repository-discovery/repository-discovery";
import { RepositoryQuickSwitcher } from "../../src/feature/repository-discovery/repository-quick-switcher";
import { RepositoryQuickSwitcherModel } from "../../src/feature/repository-discovery/repository-quick-switcher-model";
import { RepositoryOverviews } from "../../src/feature/repository-discovery/repository-overviews";
import { repositoryPaletteActions } from "../../src/feature/repository-discovery/repository-palette-actions";
import { RepositoryAvatars } from "../../src/feature/repository-workspace/lib/repository-avatars";
import { RepositoryBranches } from "../../src/feature/workspace-tabs/lib/repository-branches";
import { RepositorySync } from "../../src/feature/repository-workspace/lib/repository-sync";
import { commitInfo } from "../_shared/history-page";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";
import type { WorkspaceSessionDocument } from "../../src/feature/workspace-tabs/lib/workspace-session";

let root: TestRoot;
let avatars: RepositoryAvatars;

const machineId = "00000000-0000-4000-8000-000000000001";
const remote = MachineLocation.encode(machineId, "/test/remote-project");

beforeEach(() => {
	root = createTestRoot({
		width: 1100,
		height: 800,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	avatars = new RepositoryAvatars(
		async () => [],
		async () => []
	);
	spyOn(RepositoryDiscovery, "resolveFolder").mockImplementation(
		async (path) => path
	);
});

afterEach(() => {
	root.unmount();
	avatars.dispose();
	mock.restore();
});

const element = (id: string) => {
	const node = root.renderer.findByTestId(id);

	if (!node) throw new Error(`Missing ${id}`);

	return node;
};

async function settle(): Promise<void> {
	for (let step = 0; step < 5; step += 1) {
		await Bun.sleep(0);
		root.renderer.clockFastForward(200);
		root.renderer.advanceTime(1);
		root.renderer.flush();
	}
}

async function key(keys: string): Promise<void> {
	root.renderer.simulateKeystrokes(keys);
	await settle();
}

async function click(id: string): Promise<void> {
	const bounds = root.renderer.getElementBounds(element(id).id);

	if (!bounds) throw new Error(`Missing bounds for ${id}`);

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	await settle();
}

async function render(
	session: Partial<WorkspaceSessionDocument> = {},
	discovered: readonly string[] = [],
	overrides: Partial<ComponentProps<typeof App>> = {},
	baseSnapshot: RepositorySnapshot & {
		readonly remoteCount?: number;
	} = repositorySnapshot()
) {
	const accounts = new Accounts(
		new AccountStore("/unused/quick-switcher-accounts.json"),
		{
			async read() {
				return null;
			},
			async write() {},
			async delete() {},
		}
	);

	const machines = new Machines(
		new MachineStore("/unused/quick-switcher-machines.json")
	);

	spyOn(accounts, "load").mockReturnValue([]);
	spyOn(machines, "list").mockReturnValue([
		{
			id: machineId,
			name: "Devbox",
			host: "devbox",
			username: "",
			port: null,
			identityFile: "",
			folders: [],
		},
	]);
	const snapshot = baseSnapshot;

	const read = mock(async (path: string) => ({
		ok: true as const,
		value: {
			...snapshot,
			repository: {
				...snapshot.repository,
				root: path,
				commonDirectory: `${path}/.git`,
			},
		},
	}));

	const scan = mock(async () => ({
		paths: discovered,
		scanned: discovered.length + 1,
		skipped: 0,
		limited: false,
	}));

	root.render(
		<App
			accounts={accounts}
			machines={machines}
			avatars={avatars}
			initialSession={{
				version: 1,
				tabs: [],
				activeId: null,
				recentRepositories: ["/test/recent", remote, "/test/older"],
				...session,
			}}
			readRepository={read}
			discoverRepositories={scan}
			readDiff={async () => ({ ok: true, value: [] })}
			readLastCommit={async () => ({
				ok: true,
				value: { commit: commitInfo(), undoUnavailableReason: "No commits" },
			})}
			{...overrides}
		/>
	);
	await settle();

	return { read, scan, snapshot };
}

function branchReview(snapshot: RepositorySnapshot) {
	const head = snapshot.head.oid ?? "1234567890abcdef";

	return {
		branches: {
			current: "main",
			branches: [
				{
					name: "main",
					fullName: "refs/heads/main",
					oid: head,
					checkedOut: true,
					type: "local" as const,
					worktreePath: "/test/project",
					ahead: snapshot.head.ahead,
					behind: snapshot.head.behind,
					committedAt: null,
					remote: null,
					summary: "",
					upstream: "origin/main",
					upstreamRemote: "origin",
					upstreamRef: "refs/heads/main",
				},
			],
		},
		remotes: [
			{
				name: "origin",
				defaultBranch: "main",
				fetchUrls: ["https://example.test/repo.git"],
				pushUrls: ["https://example.test/repo.git"],
			},
		],
		worktrees: [],
		savedChanges: [],
	};
}

it("opens with Command P, keeps search focused, wraps selection and restores focus on Escape", async () => {
	await render();
	await click("welcome-search");
	const focused = root.renderer.getFocusedElementId();

	await key("cmd-p");
	expect(element("quick-switcher")).toBeDefined();
	expect(root.renderer.getFocusedElementId()).toBe(
		element("quick-switcher-search").id
	);
	expect(element("quick-action-settings").customProps?.["aria-selected"]).toBe(
		true
	);
	await key("up");
	expect(
		element("quick-repository-/test/older").customProps?.["aria-selected"]
	).toBe(true);
	await key("down");
	expect(element("quick-action-settings").customProps?.["aria-selected"]).toBe(
		true
	);
	await key("escape");
	expect(root.renderer.findByTestId("quick-switcher")).toBeUndefined();
	expect(root.renderer.getFocusedElementId()).toBe(focused);
});

it("searches machine names, opens an SSH result, and preserves the current tab and draft", async () => {
	const { read } = await render({
		tabs: [
			{ id: "workspace-1", path: "/test/project", draft: "Keep this draft" },
		],
		activeId: "workspace-1",
	});

	await key("cmd-p");
	await key("D e v b o x");
	expect(element(`quick-repository-${remote}`)).toBeDefined();
	expect(
		root.renderer.findByTestId("quick-repository-/test/recent")
	).toBeUndefined();
	await key("enter");
	expect(root.renderer.findByTestId("quick-switcher")).toBeUndefined();
	expect(read.mock.calls.some(([path]) => path === remote)).toBe(true);
	expect(element("workspace-1")).toBeDefined();
	expect(element("workspace-2")).toBeDefined();
	await click("workspace-1");
	expect(element("commit-message").customProps?.value).toBe("Keep this draft");
});

it("handles native arrow key presses directly in the focused search field", async () => {
	await render();
	await key("cmd-p");
	const input = element("quick-switcher-search").id;

	root.renderer.nativeSimulateKeyDown(input, "down");
	root.renderer.nativeSimulateKeyUp(input, "down");
	await settle();
	expect(
		element("quick-action-settings:application").customProps?.["aria-selected"]
	).toBe(true);
	expect(root.renderer.getFocusedElementId()).toBe(input);
	root.renderer.nativeSimulateKeyDown(input, "up");
	root.renderer.nativeSimulateKeyUp(input, "up");
	await settle();
	expect(element("quick-action-settings").customProps?.["aria-selected"]).toBe(
		true
	);
});

it("focuses search even when native controls are not ready for the dialog's initial focus traversal", async () => {
	await render();
	// Packaged windows paint asynchronously; the first traversal can find no native input handle yet.
	spyOn(root.renderer, "focusNextWithin").mockImplementationOnce(() => {});
	await key("cmd-p");
	expect(root.renderer.getFocusedElementId()).toBe(
		element("quick-switcher-search").id
	);
	await key("down");
	expect(
		element("quick-action-settings:application").customProps?.["aria-selected"]
	).toBe(true);
});

it("reactivates an already open repository without duplicating or rereading it", async () => {
	const { read } = await render({
		tabs: [
			{ id: "workspace-1", path: "/test/project", draft: "" },
			{ id: "workspace-2", path: "/test/other", draft: "" },
		],
		activeId: "workspace-2",
	});

	const projectReads = () =>
		read.mock.calls.filter(([path]) => path === "/test/project").length;

	const reads = projectReads();

	await key("cmd-p");
	await key("p r o j e c t");
	await key("enter");
	expect(element("workspace-1").customProps?.["aria-selected"]).toBe(true);
	expect(root.renderer.findByTestId("workspace-3")).toBeUndefined();
	expect(projectReads()).toBe(reads);
});

it("includes discovered and starred repositories, and keeps the menu stationary for no matches", async () => {
	await render(
		{ repositoryLibrary: { starred: ["/test/starred"], view: "tiles" } },
		["/test/discovered"]
	);
	await key("cmd-p");
	expect(element("quick-repository-/test/discovered")).toBeDefined();
	expect(element("quick-repository-/test/starred")).toBeDefined();
	const before = root.renderer.getElementBounds(element("quick-switcher").id);

	await key("z z z z");
	expect(element("quick-switcher-empty")).toBeDefined();
	expect(root.renderer.getElementBounds(element("quick-switcher").id)).toEqual(
		before
	);
	await key("enter");
	expect(element("quick-switcher")).toBeDefined();
	await key("cmd-p");
	expect(root.renderer.findByTestId("quick-switcher")).toBeUndefined();
});

it("does not open over an existing modal or consume modified shortcuts", async () => {
	await render();
	await key("cmd-shift-p");
	expect(root.renderer.findByTestId("quick-switcher")).toBeUndefined();
	await click("machine-add");
	await key("cmd-p");
	expect(element("machine-settings")).toBeDefined();
	expect(root.renderer.findByTestId("quick-switcher")).toBeUndefined();
});

it("renders a bounded window and navigates to a result beyond the first window", async () => {
	const paths = Array.from(
		{ length: 5000 },
		(_, index) => `/test/repo-${index}`
	);

	let opened: string | undefined;

	root.render(
		<RepositoryQuickSwitcher
			open
			items={RepositoryQuickSwitcherModel.catalog(paths, [], () => "SSH")}
			onClose={() => {}}
			onOpen={(path) => {
				opened = path;
			}}
		/>
	);
	await settle();
	expect(
		root.renderer.findByTestId("quick-repository-/test/repo-4999")
	).toBeUndefined();
	await key("up");
	expect(
		element("quick-repository-/test/repo-4999").customProps?.["aria-selected"]
	).toBe(true);
	await key("enter");
	expect(opened).toBe("/test/repo-4999");
});

it("puts commands first, renders compact repository rows and exposes disabled actions with rebound hints", async () => {
	const actions = repositoryPaletteActions(
		{ refresh: "alt-r" },
		{
			hasRepository: false,
			canFetch: false,
			canBranch: false,
			canSynchronize: false,
			canStash: false,
			canReveal: false,
			canClose: false,
		}
	);

	let selectedAction: string | undefined;

	root.render(
		<RepositoryQuickSwitcher
			open
			items={RepositoryQuickSwitcherModel.catalog(
				["/test/repository"],
				[],
				() => "Mac"
			)}
			actions={actions.filter((action) =>
				["fetch", "new-tab"].includes(action.id)
			)}
			onClose={() => {}}
			onOpen={() => {}}
			onAction={(id) => {
				selectedAction = id;
			}}
		/>
	);
	await settle();

	const repositoryBounds = root.renderer.getElementBounds(
		element("quick-repository-/test/repository").id
	);

	const actionBounds = root.renderer.getElementBounds(
		element("quick-action-fetch").id
	);

	expect(actionBounds?.y).toBeLessThan(repositoryBounds?.y ?? 0);
	expect(repositoryBounds?.height).toBe(48);
	expect(element("quick-avatar-/test/repository").style.width).toBe(24);
	expect(element("quick-action-new-tab").customProps?.["aria-selected"]).toBe(
		true
	);
	expect(element("quick-action-fetch").style.opacity).toBe(0.5);
	const fetchIcon = element("quick-action-icon-fetch").customProps?.source;
	const newTabIcon = element("quick-action-icon-new-tab").customProps?.source;

	expect(fetchIcon).toContain("<svg");
	expect(newTabIcon).toContain("<svg");
	expect(fetchIcon).not.toBe(newTabIcon);
	expect(root.renderer.getAllText().join(" ")).toContain("⌥R");

	await key(">");
	await key("n e w");
	await key("enter");
	expect(selectedAction).toBe("new-tab");
});

it.each([true, false])(
	"places Settings around repositories for settingsFirst=%s",
	async (settingsFirst) => {
		const actions = repositoryPaletteActions(
			{},
			{
				hasRepository: true,
				canFetch: true,
				canBranch: true,
				canSynchronize: true,
				canStash: true,
				canReveal: true,
				canClose: true,
			}
		).filter((action) =>
			["settings", "settings:application", "fetch"].includes(action.id)
		);

		root.render(
			<RepositoryQuickSwitcher
				open
				settingsFirst={settingsFirst}
				items={RepositoryQuickSwitcherModel.catalog(
					["/test/project"],
					[],
					() => "Mac"
				)}
				actions={actions}
				onClose={() => {}}
				onOpen={() => {}}
			/>
		);
		await settle();
		const order = settingsFirst
			? [
					"quick-action-settings",
					"quick-action-settings:application",
					"quick-action-fetch",
					"quick-repository-/test/project",
				]
			: [
					"quick-action-fetch",
					"quick-repository-/test/project",
					"quick-action-settings",
					"quick-action-settings:application",
				];

		for (const id of order) {
			expect(element(id).customProps?.["aria-selected"]).toBe(true);
			await key("down");
		}

		expect(element(order[0]!).customProps?.["aria-selected"]).toBe(true);
		await key(">");
		expect(
			element(settingsFirst ? "quick-action-settings" : "quick-action-fetch")
				.customProps?.["aria-selected"]
		).toBe(true);
		expect(
			root.renderer.findByTestId("quick-repository-/test/project")
		).toBeUndefined();
	}
);

it("changes Settings priority when switching from a repository to Settings", async () => {
	await render({
		tabs: [{ id: "workspace-1", path: "/test/project", draft: "" }],
		activeId: "workspace-1",
	});
	await key("cmd-p");
	expect(element("quick-action-new-tab").customProps?.["aria-selected"]).toBe(
		true
	);
	await key("up");
	expect(
		element("quick-action-settings:repository-ignored-history").customProps?.[
			"aria-selected"
		]
	).toBe(true);
	await key("escape");
	await key("cmd-,");
	await key("cmd-p");
	expect(element("quick-action-settings").customProps?.["aria-selected"]).toBe(
		true
	);
	await key("down");
	expect(
		element("quick-action-settings:application").customProps?.["aria-selected"]
	).toBe(true);
});

it("navigates and wraps across repositories and commands in the same list", async () => {
	let selectedAction: string | undefined;

	root.render(
		<RepositoryQuickSwitcher
			open
			items={RepositoryQuickSwitcherModel.catalog(
				["/test/project"],
				[],
				() => "Mac"
			)}
			actions={[
				{
					id: "new-tab",
					icon: "add",
					label: "New tab",
					hint: "",
					enabled: true,
				},
			]}
			onClose={() => {}}
			onOpen={() => {}}
			onAction={(id) => {
				selectedAction = id;
			}}
		/>
	);
	await settle();
	expect(element("quick-action-new-tab").customProps?.["aria-selected"]).toBe(
		true
	);
	await key("down");
	expect(
		element("quick-repository-/test/project").customProps?.["aria-selected"]
	).toBe(true);
	await key("down");
	expect(element("quick-action-new-tab").customProps?.["aria-selected"]).toBe(
		true
	);
	await key("up");
	expect(
		element("quick-repository-/test/project").customProps?.["aria-selected"]
	).toBe(true);
	await key("down");
	await key("enter");
	expect(selectedAction).toBe("new-tab");
});

it("scrolls keyboard-selected commands into view without moving search focus", async () => {
	const actions = repositoryPaletteActions(
		{},
		{
			hasRepository: true,
			canFetch: true,
			canBranch: true,
			canSynchronize: true,
			canStash: true,
			canReveal: true,
			canClose: true,
		}
	).filter((action) => action.id !== "settings" && !action.settingsSection);

	let selectedAction: string | undefined;

	root.render(
		<RepositoryQuickSwitcher
			open
			items={[]}
			actions={actions}
			onClose={() => {}}
			onOpen={() => {}}
			onAction={(id) => {
				selectedAction = id;
			}}
		/>
	);
	await settle();
	await key(">");

	for (const _action of actions.slice(
		0,
		actions.findIndex((action) => action.id === "copy-path")
	))
		await key("down");

	const list = element("quick-switcher-results");
	const selected = element("quick-action-copy-path");
	const anchor = root.renderer.getListScrollTop(list.id)!;

	const selectedIndex = actions.findIndex(
		(action) => action.id === "copy-path"
	);

	expect(selected.customProps?.["aria-selected"]).toBe(true);
	expect(anchor[0]).toBeGreaterThan(0);
	expect(anchor[0]).toBeLessThanOrEqual(selectedIndex);
	expect((selectedIndex - anchor[0] + 1) * 48 - anchor[1]).toBeLessThanOrEqual(
		anchor[2]
	);
	expect(root.renderer.getFocusedElementId()).toBe(
		element("quick-switcher-search").id
	);
	await key("enter");
	expect(selectedAction).toBe("copy-path");
});

it("reuses a visible overview after closing and reopening the palette", async () => {
	const read = mock(async () => ({
		ok: true as const,
		value: repositorySnapshot([changedFile("src/index.ts")]),
	}));

	const overviews = new RepositoryOverviews(read, () => true);

	root.render(
		<RepositoryQuickSwitcher
			open
			items={RepositoryQuickSwitcherModel.catalog(
				["/test/repository"],
				[],
				() => "Mac"
			)}
			overviews={overviews}
			onClose={() => {}}
			onOpen={() => {}}
		/>
	);
	await settle();
	expect(read).toHaveBeenCalledTimes(1);
	await key("r e p o");
	expect(read).toHaveBeenCalledTimes(1);

	root.render(
		<RepositoryQuickSwitcher
			open={false}
			items={[]}
			overviews={overviews}
			onClose={() => {}}
			onOpen={() => {}}
		/>
	);
	await settle();
	root.render(
		<RepositoryQuickSwitcher
			open
			items={RepositoryQuickSwitcherModel.catalog(
				["/test/repository"],
				[],
				() => "Mac"
			)}
			overviews={overviews}
			onClose={() => {}}
			onOpen={() => {}}
		/>
	);
	await settle();
	expect(read).toHaveBeenCalledTimes(1);
	overviews.dispose();
});

it("dispatches pull and push as separate reviewed upstream requests", async () => {
	const baseSnapshot = {
		...repositorySnapshot(),
		head: {
			...repositorySnapshot().head,
			upstream: "origin/main",
			ahead: 1,
			behind: 2,
		},
		remoteCount: 1,
	};

	const readBranches = mock<typeof RepositoryBranches.read>(async () => ({
		ok: true,
		value: branchReview(baseSnapshot),
	}));

	const writeSyncRepository = mock<typeof RepositorySync.write>(
		async (_root, input) => ({
			ok: true,
			value: {
				operation: input.kind === "pull" ? "pull" : "push",
				remote: input.kind === "sync" ? null : input.remote,
				branch: "main",
				snapshot: baseSnapshot,
			},
		})
	);

	await render(
		{
			tabs: [{ id: "workspace-1", path: "/test/project", draft: "" }],
			activeId: "workspace-1",
		},
		[],
		{ readBranches, writeSyncRepository },
		baseSnapshot
	);

	await key("cmd-p");
	await key(">");
	await key("p u l l");
	await key("enter");
	await settle();
	await settle();

	const pullCall = writeSyncRepository.mock.calls.find(
		([, input]) => input.kind === "pull"
	);

	expect(pullCall?.[0]).toBe("/test/project");
	expect(pullCall?.[1]).toMatchObject({
		kind: "pull",
		remote: "origin",
		remoteRef: "refs/heads/main",
		expectedHead: baseSnapshot.head.oid,
		expectedBranch: "main",
	});

	await key("cmd-p");
	await key(">");
	await key("p u s h");
	await key("enter");
	await settle();
	await settle();

	const pushCall = writeSyncRepository.mock.calls.find(
		([, input]) => input.kind === "push"
	);

	expect(pushCall?.[0]).toBe("/test/project");
	expect(pushCall?.[1]).toMatchObject({
		kind: "push",
		remote: "origin",
		remoteRef: "refs/heads/main",
		expectedHead: baseSnapshot.head.oid,
		expectedBranch: "main",
	});
});

it("routes branch commands into the existing branch forms", async () => {
	const baseSnapshot = { ...repositorySnapshot(), remoteCount: 1 };

	const readBranches = mock<typeof RepositoryBranches.read>(async () => ({
		ok: true,
		value: branchReview(baseSnapshot),
	}));

	await render(
		{
			tabs: [{ id: "workspace-1", path: "/test/project", draft: "" }],
			activeId: "workspace-1",
		},
		[],
		{
			readBranches,
		},
		baseSnapshot
	);

	await key("cmd-p");
	await key(">");
	await key("n e w space b r a n c h");
	await key("enter");
	await settle();
	expect(element("workspace-menu")).toBeDefined();
	expect(element("new-actions")).toBeDefined();
	expect(element("create-branch")).toBeDefined();

	await key("escape");
	await key("escape");
	await key("cmd-p");
	await key(">");
	await key("s w i t c h");
	await key("enter");
	await settle();
	expect(element("workspace-menu")).toBeDefined();
	expect(element("branch-main")).toBeDefined();
});

it("opens stash creation once and does not replay it after cancellation and navigation", async () => {
	const baseSnapshot = {
		...repositorySnapshot([changedFile("src/index.ts")]),
		remoteCount: 1,
	};

	const readBranches = mock<typeof RepositoryBranches.read>(async () => ({
		ok: true,
		value: branchReview(baseSnapshot),
	}));

	await render(
		{
			tabs: [{ id: "workspace-1", path: "/test/project", draft: "" }],
			activeId: "workspace-1",
		},
		[],
		{
			readBranches,
			readStashes: async () => ({ ok: true, value: [] }),
			readStashFiles: async () => ({ ok: true, value: [] }),
		},
		baseSnapshot
	);

	await key("cmd-p");
	await key(">");
	await key("s t a s h");
	await key("enter");
	await settle();
	expect(element("stash-create")).toBeDefined();
	expect(element("stash-message")).toBeDefined();

	await click("stash-cancel");
	expect(root.renderer.findByTestId("stash-message")).toBeUndefined();
	await click("view-changes");
	await click("workspace-home");
	await click("workspace-1");
	await settle();
	expect(root.renderer.findByTestId("stash-message")).toBeUndefined();

	await key("cmd-p");
	await key(">");
	await key("s t a s h");
	await key("enter");
	await settle();
	expect(element("stash-message")).toBeDefined();
});

it("opens a fresh target palette for New tab before filling that tab", async () => {
	const { read } = await render({
		tabs: [{ id: "workspace-1", path: "/test/project", draft: "" }],
		activeId: "workspace-1",
	});

	await key("cmd-p");
	await key(">");
	await key("t a b");
	await key("enter");
	await settle();
	expect(element("workspace-2")).toBeDefined();
	expect(element("quick-switcher-search").customProps?.value).toBe("");
	await key("r e c e n t");
	await key("enter");
	await settle();

	expect(root.renderer.findByTestId("quick-switcher")).toBeUndefined();
	expect(read.mock.calls.some(([path]) => path === "/test/recent")).toBe(true);
	expect(element("workspace-2")).toBeDefined();
});

it.each(["light", "dark"] as const)(
	"fits the minimum window and keeps keyboard focus inside the %s switcher",
	async (appearance) => {
		root.unmount();
		root = createTestRoot({
			width: 980,
			height: 640,
			onKeyDown: windowOptions.onKeyDown,
		});
		root.renderer.clockPause();
		await render({
			appearance,
			tabs: [{ id: "workspace-1", path: "/test/project", draft: "" }],
			activeId: "workspace-1",
		});
		await key("cmd-p");
		const dialog = element("quick-switcher");
		const bounds = root.renderer.getElementBounds(dialog.id);

		expect(dialog.style.backgroundColor).toBe(
			appThemes[appearance].tokens.colors.overlay
		);
		expect(bounds).toBeDefined();
		expect(bounds?.y).toBeGreaterThanOrEqual(0);
		expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(640);
		root.renderer.nativeSimulateKeyDown(
			element("quick-switcher-search").id,
			"tab"
		);
		await settle();
		expect(root.renderer.getFocusedElementId()).toBe(
			element("quick-switcher-search").id
		);
		const inputBounds = root.renderer.getElementBounds(
			element("quick-switcher-search").id
		);

		expect(inputBounds?.width).toBeGreaterThan(400);
		expect(inputBounds?.height).toBeGreaterThan(20);
		const screenshot = process.env.GPUIX_QUICK_SWITCHER_SCREENSHOT;

		if (screenshot) {
			await Bun.sleep(120);
			await settle();
			root.renderer.captureScreenshot(`${screenshot}.${appearance}.png`);
			await key("D e v b o x");
			root.renderer.captureScreenshot(`${screenshot}.${appearance}.typed.png`);
		}
	}
);

it("opens a clicked repository and reports a failed read without replacing the previous draft", async () => {
	const { read, snapshot } = await render({
		tabs: [{ id: "workspace-1", path: "/test/project", draft: "Keep my work" }],
		activeId: "workspace-1",
	});

	read.mockImplementation(async (path) => {
		if (path === "/test/recent") throw new Error("Checkout no longer exists");

		return {
			ok: true as const,
			value: {
				...snapshot,
				repository: {
					...snapshot.repository,
					root: path,
					commonDirectory: `${path}/.git`,
				},
			},
		};
	});
	await key("cmd-p");
	await key("r e c e n t");
	await click("quick-repository-/test/recent");
	expect(root.renderer.getAllText().join("\n")).toContain(
		"Checkout no longer exists"
	);
	expect(element("workspace-1")).toBeDefined();
	expect(element("workspace-2")).toBeDefined();
	await click("workspace-1");
	expect(element("commit-message").customProps?.value).toBe("Keep my work");
});
