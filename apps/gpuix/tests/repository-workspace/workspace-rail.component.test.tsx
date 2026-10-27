/**
 * Covers: chrome rail geometry, view titles, tooltip/focus, Settings restoration, native menu choices and clone defaults.
 * Real: App, account metadata, native layout/hit testing, keyboard and provider clients.
 * Doubles: provider HTTP/vault and OS menu tracking; focus notification for offscreen test windows.
 * Requires: patched native addon with macOS graphics access; no real account or repository.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { rmSync } from "node:fs";
import { flushSync, handleGpuixEvent } from "@gpuix/react";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import { WorkspaceRail } from "../../src/feature/repository-workspace/components/workspace-rail";
import { NativeFileMenu } from "../../src/feature/repository-workspace/lib/native-file-menu";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import { hostingRepositories } from "../_shared/hosting-repositories";
import { windowOptions } from "../../src/window-options";
import { appTokens } from "../../src/styles/tokens";
import { accountProviderIcons } from "../../src/feature/accounts/account-provider-icons";

let root: TestRoot;
let f: ReturnType<typeof hostingRepositories>;

beforeEach(() => {
	f = hostingRepositories();
	root = createTestRoot({
		width: 980,
		height: 720,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
});
afterEach(() => {
	root.unmount();
	mock.restore();
	rmSync(f.directory, { recursive: true, force: true });
});

function element(id: string) {
	const node = root.renderer.findByTestId(id);

	if (!node) throw new Error(`Missing ${id}`);

	return node;
}
function bounds(id: string) {
	const value = root.renderer.getElementBounds(element(id).id);

	if (!value) throw new Error(`Missing bounds ${id}`);

	return value;
}
function click(id: string) {
	const box = bounds(id);

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2
	);
	root.renderer.flush();
}
function key(id: string, value: string) {
	root.renderer.nativeSimulateKeyDown(element(id).id, value);
	root.renderer.flush();
}
async function settle() {
	await Bun.sleep(170);
	root.renderer.clockFastForward(200);
	root.renderer.flush();
	root.renderer.advanceTime(1);
	await Bun.sleep(0);
	root.renderer.flush();
}

it("keeps chrome outside the rounded workspace and labels each repository view", async () => {
	root.render(<App accounts={f.accounts} preview initialTabCount={2} />);
	const rail = bounds("workspace-rail");
	const workspace = bounds("workspace");

	expect(element("app-shell").style.backgroundColor).toBe("transparent");
	expect(element("workspace").style.backgroundColor).toBe("#ffffff");
	expect(rail.width).toBe(48);
	expect(workspace.x).toBe(48);
	const button = bounds("view-changes");

	expect(button.width).toBe(32);
	expect(button.x - rail.x).toBe(8);
	expect(workspace.x - button.x - button.width).toBe(8);
	const history = bounds("view-history");
	const stashes = bounds("view-stashes");
	const settings = bounds("rail-settings");
	const account = bounds("rail-account");

	expect(history.y - button.y - button.height).toBe(4);
	expect(stashes.y - history.y - history.height).toBe(4);
	expect(account.y - settings.y - settings.height).toBe(4);
	expect(rail.y).toBe(42);
	expect(bounds("rail-account").y).toBeGreaterThan(bounds("rail-settings").y);
	expect(bounds("rail-account").y + 32).toBeLessThanOrEqual(720);

	for (const view of ["changes", "history", "stashes"] as const) {
		click(`view-${view}`);
		expect(element(`view-${view}`).customProps?.["aria-selected"]).toBe(true);
		expect(
			element("repository-view-title")
				.children.map((id) => root.renderer.getElement(id)?.text)
				.join("")
		).toBe(view[0]!.toUpperCase() + view.slice(1));
	}

	expect(f.requests).toEqual([]);
	click("view-changes");
	await settle();

	if (process.env.GPUIX_RAIL_SCREENSHOT)
		root.renderer.captureScreenshot(`${process.env.GPUIX_RAIL_SCREENSHOT}.png`);
});

it("shows accessible tooltips on keyboard focus and preserves focus when returning from Settings", async () => {
	root.render(<App accounts={f.accounts} preview />);
	key("view-changes", "down");
	expect(element("view-history").customProps?.["aria-selected"]).toBe(true);
	flushSync(() =>
		handleGpuixEvent(
			{ elementId: element("view-history").id, eventType: "focus" },
			root.renderer
		)
	);
	await settle();
	expect(element("view-history-tooltip").customProps?.role).toBe("tooltip");
	key("view-history", "escape");
	expect(root.renderer.findByTestId("view-history-tooltip")).toBeUndefined();
	key("view-history", "cmd-,");
	await settle();
	expect(element("settings-view")).toBeDefined();
	expect(element("workspace-toolbar")).toBeDefined();
	expect(element("workspace-2").customProps?.["aria-label"]).toBe("Settings");
	expect(element("workspace-2").customProps?.["aria-selected"]).toBe(true);
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(root.renderer.getFocusedElementId()).toBe(element("view-history").id);
	click("rail-settings");
	await settle();
	expect(element("settings-view")).toBeDefined();
	expect(element("view-history")).toBeDefined();
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(root.renderer.getFocusedElementId()).toBe(element("rail-settings").id);
	expect(element("view-history").customProps?.["aria-selected"]).toBe(true);
});

it("makes only the full-width empty rail spacer a native window drag target", async () => {
	root.render(<App accounts={f.accounts} preview />);

	for (const settings of [false, true]) {
		if (settings) {
			click("rail-settings");
			await settle();
		}

		const rail = bounds("workspace-rail");
		const spacer = bounds("rail-window-drag-region");
		const stashes = bounds("view-stashes");
		const settingsButton = bounds("rail-settings");

		expect(element("rail-window-drag-region").customProps?.windowDrag).toBe(
			true
		);
		expect(spacer.x).toBe(rail.x);
		expect(spacer.width).toBe(rail.width);
		expect(spacer.height).toBeGreaterThan(0);
		expect(spacer.y).toBeGreaterThanOrEqual(stashes.y + stashes.height);
		expect(spacer.y + spacer.height).toBeLessThanOrEqual(settingsButton.y);
		expect(element("workspace-rail").customProps?.windowDrag).not.toBe(true);

		for (const id of [
			"view-changes",
			"view-history",
			"view-stashes",
			"rail-settings",
			"rail-account",
		])
			expect(element(id).customProps?.windowDrag).not.toBe(true);
	}
});

it("centers an inverted hover tooltip beside each rail button", async () => {
	root.render(<App accounts={f.accounts} preview />);

	for (const id of [
		"view-changes",
		"view-history",
		"rail-settings",
		"rail-account",
	]) {
		const trigger = bounds(id);

		root.renderer.nativeSimulateMouseMove(
			trigger.x + trigger.width / 2,
			trigger.y + trigger.height / 2
		);
		await Bun.sleep(400);
		await settle();
		const tooltip = bounds(`${id}-tooltip`);

		expect(tooltip.y + tooltip.height / 2, id).toBeCloseTo(
			trigger.y + trigger.height / 2,
			0
		);
		expect(tooltip.x, id).toBe(trigger.x + trigger.width + 8);
		expect(element(`${id}-tooltip`).style).toMatchObject({
			backgroundColor: appTokens.tooltip?.background,
			color: appTokens.tooltip?.text,
		});

		if (id === "view-history" && process.env.GPUIX_RAIL_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_RAIL_SCREENSHOT}-tooltip.png`
			);

		root.renderer.nativeSimulateMouseMove(900, 400);
		await Bun.sleep(100);
		root.renderer.flush();
		expect(root.renderer.findByTestId(`${id}-tooltip`)).toBeUndefined();
	}
});

it("keeps repository navigation in Settings and returns to the chosen view", async () => {
	root.render(<App accounts={f.accounts} preview />);
	click("rail-settings");
	await settle();
	click("settings-appearance");
	await settle();
	expect(element("appearance-settings")).toBeDefined();
	const settingsTabId = element("workspace-2").id;

	for (const id of ["view-changes", "view-history", "view-stashes"])
		expect(element(id)).toBeDefined();

	click("view-stashes");
	await settle();
	expect(element("settings-view").style.visibility).toBe("hidden");
	expect(element("workspace-2").id).toBe(settingsTabId);
	expect(element("view-stashes").customProps?.["aria-selected"]).toBe(true);
	expect(root.renderer.getFocusedElementId()).toBe(element("view-stashes").id);
	click("rail-settings");
	await settle();
	expect(element("appearance-settings")).toBeDefined();
});

it("routes tab shortcuts while Settings is active", async () => {
	root.render(
		<App
			accounts={f.accounts}
			initialSession={{
				version: 1,
				tabs: [
					{
						id: "workspace-1",
						kind: "repository",
						path: null,
						draft: "",
					},
				],
				activeId: "workspace-1",
				recentRepositories: ["/test/recent"],
			}}
		/>
	);
	click("rail-settings");
	await settle();

	root.renderer.simulateKeystrokes("cmd-t");
	await settle();
	const emptyTab = element("workspace-3");

	expect(emptyTab.customProps?.["aria-label"]).toBe("Welcome");
	root.renderer.simulateKeystrokes("escape");
	await settle();
	root.renderer.simulateKeystrokes("cmd-p");
	await settle();
	root.renderer.simulateKeystrokes("r e c e n t");
	await settle();
	click("quick-repository-/test/recent");
	await settle();
	expect(element("workspace-3").customProps?.["aria-label"]).toBe("recent");
	root.renderer.simulateKeystrokes("cmd-2");
	await settle();
	expect(root.renderer.findByTestId("settings-view")).toBeDefined();
	root.renderer.simulateKeystrokes("cmd-w");
	await settle();
	expect(root.renderer.findByTestId("settings-view")).toBeUndefined();
});

it("opens a new tab instead of loading Settings for Open and ignores Refresh", async () => {
	root.render(<App accounts={f.accounts} preview />);
	click("rail-settings");
	await settle();

	root.renderer.simulateKeystrokes("cmd-o");
	await settle();

	expect(element("workspace-2").customProps?.["aria-label"]).toBe("Settings");
	expect(element("workspace-3").customProps?.["aria-label"]).toBe("Welcome");
	root.renderer.simulateKeystrokes("cmd-r");
	await settle();
	expect(element("workspace-2").customProps?.["aria-label"]).toBe("Settings");
});

it("switches the clone default through public account metadata without accessing credentials", async () => {
	const metadata = spyOn(f.accounts, "load");
	const secrets = [...f.secrets];
	const menu = spyOn(NativeFileMenu, "show").mockReturnValue(1);

	root.render(<App accounts={f.accounts} />);
	expect(root.renderer.findByTestId("view-changes")).toBeUndefined();
	click("rail-account");
	expect(menu).toHaveBeenCalledWith(
		root.renderer,
		[
			"✓ tester · GitHub (github.com)",
			"lab-user · GitLab (gitlab.com)",
			"Add account…",
			"Manage accounts…",
		],
		[true, true, true, true],
		expect.any(Number),
		expect.any(Number)
	);
	expect(metadata).toHaveBeenCalled();
	expect(f.requests).toEqual([]);
	expect([...f.secrets]).toEqual(secrets);
	expect(f.store.load()).toEqual(f.saved);
	click("repository-clone");
	await settle();
	expect(element(`clone-account-${f.saved[1]!.id}`).style.backgroundColor).toBe(
		appTokens.colors.surface
	);
	expect(root.renderer.getAllText().join("")).toContain(
		"group/nested/lab-project"
	);
	expect(f.requests.every((request) => request.url.host === "gitlab.com")).toBe(
		true
	);
	expect(root.renderer.getAllText().join("")).not.toContain(
		"fixture-gitlab-token"
	);
});

it("keeps an existing Clone selection while changing the default for subsequent clones", async () => {
	const menu = spyOn(NativeFileMenu, "show").mockReturnValue(1);

	root.render(<App accounts={f.accounts} />);
	click("repository-clone");
	await settle();
	click("clone-repository-10");
	click("rail-account");
	await settle();
	expect(menu).toHaveBeenCalled();
	expect(element(`clone-account-${f.saved[0]!.id}`).style.backgroundColor).toBe(
		appTokens.colors.surface
	);
	expect(element("clone-repository-10").style.backgroundColor).toBe(
		appTokens.colors.surface
	);
	click("clone-back");
	click("repository-clone");
	await settle();
	expect(element(`clone-account-${f.saved[1]!.id}`).style.backgroundColor).toBe(
		appTokens.colors.surface
	);
});

it("handles no accounts and safely opens Add/Manage from the native menu", async () => {
	f.store.save([]);
	const menu = spyOn(NativeFileMenu, "show").mockReturnValue(1);

	root.render(<App accounts={f.accounts} />);
	click("rail-account");
	await settle();
	expect(menu.mock.calls[0]?.[1]).toEqual([
		"No accounts connected",
		"Add account…",
		"Manage accounts…",
	]);
	expect(menu.mock.calls[0]?.[2]).toEqual([false, true, true]);
	expect(element("account-setup-panel")).toBeDefined();
	click("accounts-cancel");
	menu.mockReturnValue(2);
	click("rail-account");
	await settle();
	expect(element("settings-view")).toBeDefined();
	expect(root.renderer.findByTestId("account-setup-panel")).toBeUndefined();
	expect(f.requests).toEqual([]);
});

it("falls back after the preferred account is removed and does not leak metadata errors", () => {
	f.store.save([f.saved[0]!]);
	const menu = spyOn(NativeFileMenu, "show").mockReturnValue(-1);

	const render = () =>
		root.render(
			<WorkspaceRail
				accounts={f.accounts}
				preferredAccountKey={AccountStore.key(f.saved[1]!)}
				onSettings={() => {}}
				onAddAccount={() => {}}
			/>
		);

	render();
	click("rail-account");
	expect(menu.mock.calls[0]?.[1]?.[0]).toBe("✓ tester · GitHub (github.com)");
	spyOn(f.accounts, "load").mockImplementation(() => {
		throw new Error("private-path-and-secret");
	});
	click("rail-account");
	expect(menu.mock.calls[1]?.[1]?.[0]).toBe(
		"Could not load accounts. Open Settings."
	);
	expect(root.renderer.getAllText().join("")).not.toContain(
		"private-path-and-secret"
	);
});

it("does not activate disabled navigation, settings or accounts during setup operations", () => {
	const menu = spyOn(NativeFileMenu, "show").mockReturnValue(0);
	const onSettings = mock();
	const onView = mock();
	const onColorChange = mock();
	const settingsMenu = spyOn(NativeFileMenu, "showItems");

	root.render(
		<WorkspaceRail
			accounts={f.accounts}
			view="changes"
			onView={onView}
			disabled
			onSettings={onSettings}
			onAddAccount={onSettings}
			repositoryAppearance={{
				onChange: onColorChange,
				onPatternChange: () => {},
			}}
		/>
	);
	click("rail-settings");
	key("rail-settings", "enter");
	click("rail-account");
	key("rail-account", "space");
	click("view-history");
	key("view-changes", "down");
	expect(onSettings).not.toHaveBeenCalled();
	expect(onView).not.toHaveBeenCalled();
	expect(onColorChange).not.toHaveBeenCalled();
	expect(settingsMenu).not.toHaveBeenCalled();
	expect(menu).not.toHaveBeenCalled();
	expect(element("rail-account").customProps?.tabIndex).toBeUndefined();
	expect(element("rail-account").style.opacity).toBe(0.45);
});

it("opens featured settings from a dropdown instead of showing the color editor", async () => {
	const onSettings = mock();

	const menu = spyOn(NativeFileMenu, "showItems").mockReturnValue({
		kind: "settings",
		section: "appearance",
	});

	root.render(
		<WorkspaceRail
			accounts={f.accounts}
			onSettings={onSettings}
			onAddAccount={() => {}}
			repositoryAppearance={{
				onChange: () => {},
				onPatternChange: () => {},
			}}
		/>
	);
	click("rail-settings");
	click("rail-settings");
	await settle();
	expect(menu).toHaveBeenCalledTimes(1);
	expect(onSettings).toHaveBeenCalledWith("appearance");
	expect(root.renderer.findByTestId("repository-color-custom")).toBeUndefined();
});

it("dismisses without changes, opens customization by keyboard and falls back to Settings if native menus fail", async () => {
	const onSettings = mock();
	const onAppearance = mock();
	const onChange = mock();
	const menu = spyOn(NativeFileMenu, "showItems").mockReturnValue(undefined);

	root.render(
		<WorkspaceRail
			accounts={f.accounts}
			onSettings={onSettings}
			onAppearance={onAppearance}
			onAddAccount={() => {}}
			repositoryAppearance={{ onChange, onPatternChange: () => {} }}
		/>
	);
	click("rail-settings");
	await settle();
	expect(onSettings).not.toHaveBeenCalled();
	expect(onAppearance).not.toHaveBeenCalled();
	expect(onChange).not.toHaveBeenCalled();
	expect(root.renderer.getFocusedElementId()).toBe(element("rail-settings").id);
	menu.mockReturnValueOnce({ kind: "appearance", section: "color" });
	key("rail-settings", "space");
	await settle();
	expect(onAppearance).toHaveBeenCalledWith("color");
	expect(onChange).not.toHaveBeenCalled();
	expect(root.renderer.getFocusedElementId()).toBe(element("rail-settings").id);
	expect(onSettings).not.toHaveBeenCalled();
	menu.mockImplementationOnce(() => {
		throw new Error("No grouped menus");
	});
	key("rail-settings", "enter");
	await settle();
	expect(onSettings).toHaveBeenCalledTimes(1);
});

it("opens repository appearance Settings when the live editor is unavailable", async () => {
	const onSettings = mock();

	spyOn(NativeFileMenu, "showItems").mockReturnValue({
		kind: "appearance",
		section: "color",
	});
	root.render(
		<WorkspaceRail
			accounts={f.accounts}
			onSettings={onSettings}
			onAddAccount={() => {}}
			repositoryAppearance={{ onChange: () => {}, onPatternChange: () => {} }}
		/>
	);
	click("rail-settings");
	await settle();

	expect(onSettings).toHaveBeenCalledWith("repository-appearance");
});

it("reflects the Settings-owned account list immediately without remounting controls", () => {
	const render = (saved: typeof f.saved) =>
		root.render(
			<WorkspaceRail
				accounts={f.accounts}
				savedAccounts={saved}
				onSettings={() => {}}
				onAddAccount={() => {}}
			/>
		);

	render([]);
	const original = element("rail-account").id;

	expect(element("rail-account-icon").customProps?.source).not.toBe(
		accountProviderIcons.github
	);
	render([f.saved[0]!]);
	expect(element("rail-account").id).toBe(original);
	expect(element("rail-account-icon").customProps?.source).toBe(
		accountProviderIcons.github
	);
	render([f.saved[1]!]);
	expect(element("rail-account-icon").customProps?.source).toBe(
		accountProviderIcons.gitlab
	);
	expect(f.requests).toEqual([]);
});

it.each([
	[756, 450],
	[640, 420],
])(
	"keeps workspace controls reachable in a %s × %s tile",
	async (width, height) => {
		root.unmount();
		root = createTestRoot({
			width,
			height,
			onKeyDown: windowOptions.onKeyDown,
		});
		root.renderer.clockPause();
		root.render(<App accounts={f.accounts} preview initialTabCount={2} />);
		await settle();

		for (const id of [
			"rail-settings",
			"rail-account",
			"commit-message",
			"commit-preview",
		]) {
			const box = bounds(id);

			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.y).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width).toBeLessThanOrEqual(width);
			expect(box.y + box.height).toBeLessThanOrEqual(height);
		}

		expect(bounds("workspace").width).toBeGreaterThan(550);

		if (width === 756 && process.env.GPUIX_SMALL_WINDOW_SCREENSHOT)
			root.renderer.captureScreenshot(
				process.env.GPUIX_SMALL_WINDOW_SCREENSHOT
			);
	}
);
