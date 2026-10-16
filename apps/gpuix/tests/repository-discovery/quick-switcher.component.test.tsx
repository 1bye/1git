/**
 * Covers: Command P, focused search, navigation, dismissal, local/SSH opening, discovery and bounded rendering.
 * Real: App, switcher, session/tab models and GPUIX layout/input.
 * Doubles: repository reads, scans, account/machine catalogs and artwork; no user data or network.
 * Requires: patched GPUIX addon with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
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
import { RepositoryAvatars } from "../../src/feature/repository-workspace/lib/repository-avatars";
import { commitInfo } from "../_shared/history-page";
import { repositorySnapshot } from "../_shared/repository-snapshot";
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
	discovered: readonly string[] = []
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
	const snapshot = repositorySnapshot();

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
		/>
	);
	await settle();

	return { read, scan };
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
	expect(
		element("quick-repository-/test/recent").customProps?.["aria-selected"]
	).toBe(true);
	await key("up");
	expect(
		element("quick-repository-/test/older").customProps?.["aria-selected"]
	).toBe(true);
	await key("down");
	expect(
		element("quick-repository-/test/recent").customProps?.["aria-selected"]
	).toBe(true);
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
		element(`quick-repository-${remote}`).customProps?.["aria-selected"]
	).toBe(true);
	expect(root.renderer.getFocusedElementId()).toBe(input);
	root.renderer.nativeSimulateKeyDown(input, "up");
	root.renderer.nativeSimulateKeyUp(input, "up");
	await settle();
	expect(
		element("quick-repository-/test/recent").customProps?.["aria-selected"]
	).toBe(true);
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
		element(`quick-repository-${remote}`).customProps?.["aria-selected"]
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

	const reads = read.mock.calls.length;

	await key("cmd-p");
	await key("p r o j e c t");
	await key("enter");
	expect(element("workspace-1").customProps?.["aria-selected"]).toBe(true);
	expect(root.renderer.findByTestId("workspace-3")).toBeUndefined();
	expect(read.mock.calls).toHaveLength(reads);
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
	const { read } = await render({
		tabs: [{ id: "workspace-1", path: "/test/project", draft: "Keep my work" }],
		activeId: "workspace-1",
	});

	read.mockRejectedValueOnce(new Error("Checkout no longer exists"));
	await key("cmd-p");
	await click("quick-repository-/test/recent");
	expect(root.renderer.getAllText().join("\n")).toContain(
		"Checkout no longer exists"
	);
	expect(element("workspace-1")).toBeDefined();
	expect(element("workspace-2")).toBeDefined();
	await click("workspace-1");
	expect(element("commit-message").customProps?.value).toBe("Keep my work");
});
