/**
 * Covers: compact width-capped Accounts, Settings tab close/focus restoration, illustrated empty state, public setup copying, split setup, pinned actions, preserved workspace state, token masking, icon actions, confirmed removal and keyboard navigation.
 * Real: App, Accounts, providers, disposable metadata file and native layout/editing/accessibility.
 * Doubles: HTTP, credential vault and clipboard writes; no real account, token or network.
 * Requires: built local native addon and macOS graphics access.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { NativeCredentials } from "../../src/feature/accounts/lib/native-credentials";
import { GitHubCli } from "../../src/feature/accounts/lib/github-cli";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import { windowOptions } from "../../src/window-options";
import { AccountAuthorization } from "../../src/feature/accounts/lib/account-authorization";
import { AppThemeContext, appThemes } from "../../src/styles/theme";
import { appTokens } from "../../src/styles/tokens";
import { workspaceLayout } from "../../src/styles/workspace-layout";
import { AccountsSettings } from "../../src/feature/accounts/accounts-settings";
import { accountProviderIcons } from "../../src/feature/accounts/account-provider-icons";
import type { HostingFetch } from "@1git/hosting/contracts";

let root: TestRoot;
let directory: string;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "1git-settings-test-"));
	root = createTestRoot({
		width: 980,
		height: 720,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
});

afterEach(() => {
	root.unmount();
	rmSync(directory, { recursive: true, force: true });
});

function click(testId: string) {
	const element = root.renderer.findByTestId(testId);
	const bounds = element && root.renderer.getElementBounds(element.id);

	if (!bounds) throw new Error(`Missing bounds: ${testId}`);

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	root.renderer.flush();
}

async function settle() {
	root.renderer.flush();
	await Bun.sleep(150);
	root.renderer.clockFastForward(200);
	root.renderer.flush();
	root.renderer.advanceTime(1);
	await Bun.sleep(0);
	root.renderer.flush();
}

async function revealSetupControl(testId: string) {
	const scroll = root.renderer.findByTestId("account-setup-scroll")!;
	const element = root.renderer.findByTestId(testId)!;
	const viewport = root.renderer.getElementBounds(scroll.id)!;
	const bounds = root.renderer.getElementBounds(element.id)!;

	if (
		bounds.y < viewport.y ||
		bounds.y + bounds.height > viewport.y + viewport.height
	) {
		const offset = root.renderer.getScrollOffset(scroll.id)?.[1] ?? 0;

		root.renderer.scrollTo(scroll.id, 0, offset - (bounds.y - viewport.y) + 8);
		await settle();
	}
}

function fixture(
	status = 200,
	device = false,
	beforeDelete?: (key: string) => Promise<void>,
	cli?: GitHubCli
) {
	const store = new AccountStore(join(directory, "accounts.json"));
	const secrets = new Map<string, string>();

	const requests: string[] = [];

	const http: HostingFetch = async (url) => {
		requests.push(String(url));

		if (device && new URL(url).pathname === "/login/device/code")
			return Response.json({
				device_code: "never-render-device-secret",
				user_code: "ABCD-EFGH",
				verification_uri: "https://github.com/login/device",
				expires_in: 900,
				interval: 1,
			});

		if (device && new URL(url).pathname === "/login/oauth/access_token")
			return Response.json({
				access_token: "never-render-oauth-access",
				refresh_token: "never-render-oauth-refresh",
				token_type: "bearer",
				expires_in: 7200,
			});

		return Response.json(
			status === 200
				? {
						id: 7,
						login: "tester",
						name: null,
						html_url: "https://github.com/tester",
					}
				: { message: "must-not-display-server-text" },
			{ status }
		);
	};

	const accounts = new Accounts(
		store,
		{
			async read(key) {
				return secrets.get(key) ?? null;
			},
			async write(key, token) {
				secrets.set(key, token);
			},
			async delete(key) {
				await beforeDelete?.(key);
				secrets.delete(key);
			},
		},
		http,
		new AccountAuthorization(http, async () => undefined),
		cli
	);

	return { accounts, store, secrets, requests, http };
}

it("opens a full Settings view with Cmd+, and restores the same workspace and focus", async () => {
	const f = fixture();

	root.render(<App accounts={f.accounts} />);
	await settle();
	const entry = root.renderer.findByTestId("welcome-search")!;
	const workspace = root.renderer.findByTestId("repository-welcome")!;

	root.renderer.focusElement(entry.id);
	root.renderer.simulateKeystrokes("cmd-,");
	await settle();
	const dialog = root.renderer.findByTestId("accounts-settings")!;
	const bounds = root.renderer.getElementBounds(dialog.id)!;

	if (process.env.GPUIX_ACCOUNTS_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_ACCOUNTS_SCREENSHOT}.view.png`
		);

	expect(root.renderer.getAllText()).toContain("No accounts connected.");
	expect(bounds.width).toBeGreaterThan(600);
	expect(bounds.height).toBeGreaterThan(600);
	expect(root.renderer.findByTestId("repository-welcome")?.id).toBe(
		workspace.id
	);
	root.renderer.simulateKeystrokes("tab tab tab tab tab");
	await settle();
	expect(root.renderer.getFocusedElementId()).not.toBe(entry.id);
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(root.renderer.findByTestId("accounts-settings")).toBeUndefined();
	expect(root.renderer.getFocusedElementId()).toBe(entry.id);
});

it("removes Back and fits the Settings tab above the sidebar without covering window controls", async () => {
	const f = fixture();

	root.render(<App accounts={f.accounts} preview />);
	await settle();
	const workspaceTab = root.renderer.findByTestId("slot-workspace-1")!;
	const workspaceTabBounds = root.renderer.getElementBounds(workspaceTab.id)!;

	root.renderer.simulateKeystrokes("cmd-,");
	await settle();
	const sidebar = root.renderer.findByTestId("settings-navigation");
	const title = root.renderer.findByTestId("settings-title-tab");
	const accounts = root.renderer.findByTestId("settings-accounts");

	expect(root.renderer.findByTestId("settings-back")).toBeUndefined();
	expect(root.renderer.findByTestId("settings-back-icon")).toBeUndefined();
	const accountsIcon = root.renderer.findByTestId("settings-accounts-icon");
	const titleLabel = root.renderer.findByTestId("settings-title-tab-label");
	const heading = root.renderer.findByTestId("accounts-heading");

	expect(sidebar).toBeDefined();
	expect(title).toBeDefined();
	expect(accounts).toBeDefined();
	expect(accountsIcon).toBeDefined();
	expect(titleLabel).toBeDefined();
	expect(heading).toBeDefined();
	const sidebarBounds = root.renderer.getElementBounds(sidebar!.id)!;
	const titleBounds = root.renderer.getElementBounds(title!.id)!;
	const accountsBounds = root.renderer.getElementBounds(accounts!.id)!;
	const accountsIconBounds = root.renderer.getElementBounds(accountsIcon!.id)!;

	expect(accountsBounds.height).toBe(appTokens.layout.smallControlHeight);
	expect(accountsIconBounds.width).toBe(14);
	// Settings has no Home button; its title starts directly after the traffic lights.
	expect(titleBounds.x).toBe(workspaceLayout.desktopTitlebarControlsWidth);
	expect(titleBounds.x).toBeGreaterThanOrEqual(sidebarBounds.x);
	expect(titleBounds.width).toBeLessThan(sidebarBounds.width);
	const surfaceBounds = root.renderer.getElementBounds(
		root.renderer.findByTestId("settings-title-tab-surface")!.id
	)!;

	expect(surfaceBounds.x + surfaceBounds.width).toBeLessThan(
		sidebarBounds.x + sidebarBounds.width
	);
	expect(titleBounds.height).toBe(workspaceTabBounds.height);
	expect(titleBounds.y + titleBounds.height).toBe(sidebarBounds.y);
	const close = root.renderer.findByTestId("settings-title-tab-close")!;

	const closeIcon = root.renderer.findByTestId(
		"settings-title-tab-close-icon"
	)!;

	const closeBounds = root.renderer.getElementBounds(close.id)!;
	const iconBounds = root.renderer.getElementBounds(closeIcon.id)!;
	const labelBounds = root.renderer.getElementBounds(titleLabel!.id)!;

	expect(closeBounds).toMatchObject({ width: 24, height: 24 });
	expect(iconBounds).toMatchObject({ width: 14, height: 14 });
	expect(closeBounds.x + closeBounds.width).toBe(
		titleBounds.x + titleBounds.width - 6
	);
	expect(closeBounds.y + closeBounds.height / 2).toBe(
		labelBounds.y + labelBounds.height / 2
	);
	expect(root.renderer.getFocusedElementId()).toBe(accounts!.id);

	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(root.renderer.findByTestId("settings-view")).toBeUndefined();
	expect(root.renderer.findByTestId("slot-workspace-1")?.id).toBe(
		workspaceTab.id
	);
});

it("closes Settings from its tab with mouse or keyboard and restores Home focus", async () => {
	const f = fixture();

	root.render(<App accounts={f.accounts} initialTabCount={0} />);
	await settle();
	const search = root.renderer.findByTestId("welcome-search")!;
	const home = root.renderer.findByTestId("repository-welcome")!;

	for (const input of ["mouse", "enter", "space"] as const) {
		root.renderer.focusElement(search.id);
		root.renderer.simulateKeystrokes("cmd-,");
		await settle();
		const close = root.renderer.findByTestId("settings-title-tab-close")!;

		expect(close.customProps?.["aria-label"]).toBe("Close Settings");
		expect(close.customProps?.windowDrag).not.toBe(true);

		if (input === "mouse") click("settings-title-tab-close");
		else {
			root.renderer.focusElement(close.id);
			root.renderer.nativeSimulateKeyDown(close.id, input);

			if (input === "space") root.renderer.nativeSimulateKeyUp(close.id, input);
		}

		await settle();
		expect(root.renderer.findByTestId("settings-view")).toBeUndefined();
		expect(root.renderer.findByTestId("repository-welcome")?.id).toBe(home.id);
		expect(root.renderer.getFocusedElementId()).toBe(search.id);
	}
});

it("keeps the account list mounted beside setup and closes only setup on Cancel or Escape", async () => {
	const f = fixture();

	f.store.save([
		{
			provider: "github",
			webUrl: "https://github.com/",
			id: "7",
			username: "tester",
		},
	]);
	root.render(<App accounts={f.accounts} />);
	await settle();
	root.renderer.simulateKeystrokes("cmd-,");
	await settle();
	const account = f.store.load()[0]!;
	const key = AccountStore.key(account);
	const row = root.renderer.findByTestId(`account-${key}`)!;
	const list = root.renderer.findByTestId("accounts-list-scroll")!;

	expect(root.renderer.findByTestId("account-setup-panel")).toBeUndefined();
	click("account-add");
	await settle();
	const panel = root.renderer.findByTestId("account-setup-panel")!;
	const paneBounds = root.renderer.getElementBounds(panel.id)!;

	const listBounds = root.renderer.getElementBounds(
		root.renderer.findByTestId("accounts-list-panel")!.id
	)!;

	expect(root.renderer.findByTestId(`account-${key}`)?.id).toBe(row.id);
	expect(root.renderer.findByTestId("accounts-list-scroll")?.id).toBe(list.id);
	expect(paneBounds.x).toBeGreaterThanOrEqual(listBounds.x + listBounds.width);
	expect(panel.style.borderLeftWidth).toBe(1);
	expect(root.renderer.getPaintedText()).toContain("tester");
	click("accounts-cancel");
	await settle();
	expect(root.renderer.findByTestId("account-setup-panel")).toBeUndefined();
	expect(root.renderer.findByTestId(`account-${key}`)?.id).toBe(row.id);

	click(`account-reconnect-${key}`);
	await settle();
	expect(root.renderer.getAllText()).toContain("Reconnect account");
	expect(root.renderer.findByTestId(`account-${key}`)?.id).toBe(row.id);
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(root.renderer.findByTestId("account-setup-panel")).toBeUndefined();
	expect(root.renderer.findByTestId("settings-view")).toBeDefined();
	expect(f.requests).toEqual([]);
	expect(f.store.load()).toEqual([account]);

	if (process.env.GPUIX_ACCOUNTS_SCREENSHOT) {
		click("account-add");
		await settle();
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_ACCOUNTS_SCREENSHOT}.saved-list.png`
		);
	}
});

it("keeps Add account beside the Accounts heading and balances list and setup space", async () => {
	root.unmount();
	root = createTestRoot({
		width: 1280,
		height: 800,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	const f = fixture();

	root.render(<App accounts={f.accounts} />);
	await settle();
	root.renderer.simulateKeystrokes("cmd-,");
	await settle();
	const add = root.renderer.findByTestId("account-add")!;
	const heading = root.renderer.findByTestId("accounts-heading")!;
	const addBounds = root.renderer.getElementBounds(add.id)!;
	const headingBounds = root.renderer.getElementBounds(heading.id)!;

	expect(
		Math.abs(
			addBounds.y +
				addBounds.height / 2 -
				(headingBounds.y + headingBounds.height / 2)
		)
	).toBeLessThanOrEqual(1);
	expect(addBounds.x).toBeGreaterThan(headingBounds.x + headingBounds.width);
	expect(root.renderer.findByTestId("accounts-list-footer")).toBeUndefined();
	click("account-add");
	await settle();
	const list = root.renderer.findByTestId("accounts-list-panel")!;
	const setup = root.renderer.findByTestId("account-setup-panel")!;
	const listBounds = root.renderer.getElementBounds(list.id)!;
	const setupBounds = root.renderer.getElementBounds(setup.id)!;

	expect(Math.abs(listBounds.width - setupBounds.width)).toBeLessThanOrEqual(1);
	expect(listBounds.width).toBeGreaterThan(300);
	expect(root.renderer.getElementBounds(add.id)?.y).toBe(addBounds.y);

	if (process.env.GPUIX_ACCOUNTS_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_ACCOUNTS_SCREENSHOT}.wide.png`
		);
});

it("caps Accounts sections and centers an illustrated empty state on wide windows", async () => {
	root.unmount();
	root = createTestRoot({
		width: 1600,
		height: 800,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	const f = fixture();

	root.render(<App accounts={f.accounts} />);
	await settle();
	root.renderer.simulateKeystrokes("cmd-,");
	await settle();
	const header = root.renderer.findByTestId("accounts-list-header")!;
	const headerBounds = root.renderer.getElementBounds(header.id)!;

	expect(headerBounds.width).toBeLessThanOrEqual(480);
	const heading = root.renderer.findByTestId("accounts-heading")!;
	const description = root.renderer.findByTestId("accounts-description")!;
	const headingBounds = root.renderer.getElementBounds(heading.id)!;
	const descriptionBounds = root.renderer.getElementBounds(description.id)!;
	const add = root.renderer.findByTestId("account-add")!;
	const addBounds = root.renderer.getElementBounds(add.id)!;
	const content = root.renderer.findByTestId("accounts-list-content")!;
	const contentBounds = root.renderer.getElementBounds(content.id)!;
	const empty = root.renderer.findByTestId("accounts-empty-content")!;
	const emptyBounds = root.renderer.getElementBounds(empty.id)!;
	const emptyRegion = root.renderer.findByTestId("accounts-empty")!;
	const emptyRegionBounds = root.renderer.getElementBounds(emptyRegion.id)!;
	const artwork = root.renderer.findByTestId("accounts-empty-artwork")!;

	expect(
		descriptionBounds.y - headingBounds.y - headingBounds.height
	).toBeLessThanOrEqual(12);
	expect(addBounds.x + addBounds.width).toBe(
		headerBounds.x + headerBounds.width
	);
	expect(contentBounds.width).toBe(headerBounds.width);
	expect(contentBounds.x).toBe(headerBounds.x);
	expect(
		Math.abs(
			emptyBounds.x +
				emptyBounds.width / 2 -
				(contentBounds.x + contentBounds.width / 2)
		)
	).toBeLessThanOrEqual(1);
	expect(
		Math.abs(
			emptyBounds.y +
				emptyBounds.height / 2 -
				(emptyRegionBounds.y + emptyRegionBounds.height / 2)
		)
	).toBeLessThanOrEqual(1);
	expect(artwork.type).toBe("svg");
	expect(artwork.customProps?.["aria-hidden"]).toBe(true);
	expect(root.renderer.getPaintedText().join("\n")).toContain(
		"No accounts connected."
	);

	if (process.env.GPUIX_ACCOUNTS_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_ACCOUNTS_SCREENSHOT}.empty-wide.png`
		);

	click("account-add");
	await settle();
	const setupHeader = root.renderer.findByTestId("account-setup-heading")!;
	const setupContent = root.renderer.findByTestId("account-setup-content")!;
	const actions = root.renderer.findByTestId("account-setup-actions")!;
	const setupHeaderBounds = root.renderer.getElementBounds(setupHeader.id)!;
	const setupContentBounds = root.renderer.getElementBounds(setupContent.id)!;
	const actionsBounds = root.renderer.getElementBounds(actions.id)!;

	expect(root.renderer.getElementBounds(header.id)!.width).toBe(480);
	expect(setupContentBounds.width).toBe(480);
	expect(actionsBounds.width).toBe(setupContentBounds.width);
	expect(setupHeaderBounds.x).toBe(setupContentBounds.x);
	expect(actionsBounds.x).toBe(setupContentBounds.x);
	expect(f.requests).toEqual([]);

	if (process.env.GPUIX_ACCOUNTS_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_ACCOUNTS_SCREENSHOT}.setup-wide.png`
		);
});

it("shows matching icon tiles for connection methods with mouse and keyboard selection", async () => {
	const f = fixture();

	root.render(<App accounts={f.accounts} />);
	await settle();
	root.renderer.simulateKeystrokes("cmd-,");
	await settle();
	click("account-add");
	await settle();
	const provider = root.renderer.findByTestId("account-provider-github")!;
	const browser = root.renderer.findByTestId("account-auth-browser")!;
	const token = root.renderer.findByTestId("account-auth-token")!;
	const providerBounds = root.renderer.getElementBounds(provider.id)!;
	const browserBounds = root.renderer.getElementBounds(browser.id)!;
	const tokenBounds = root.renderer.getElementBounds(token.id)!;

	expect(browserBounds.height).toBe(providerBounds.height);
	expect(tokenBounds.height).toBe(providerBounds.height);
	// Three columns can differ by half a point after native device-pixel snapping.
	expect(Math.abs(tokenBounds.width - browserBounds.width)).toBeLessThanOrEqual(
		0.5
	);
	const cli = root.renderer.findByTestId("account-auth-github-cli")!;

	expect(
		Math.abs(
			root.renderer.getElementBounds(cli.id)!.width - browserBounds.width
		)
	).toBeLessThanOrEqual(0.5);
	expect(root.renderer.findByTestId("account-auth-browser-icon")).toBeDefined();
	expect(root.renderer.findByTestId("account-auth-token-icon")).toBeDefined();
	click("account-auth-token");
	await settle();
	expect(root.renderer.findByTestId("account-token")).toBeDefined();
	expect(root.renderer.findByTestId("account-client-id")).toBeUndefined();
	expect(JSON.stringify(root.renderer.getA11yTree())).toContain(
		"Selected connection method"
	);
	root.renderer.nativeSimulateKeyDown(browser.id, "space");
	root.renderer.nativeSimulateKeyUp(browser.id, "space");
	await settle();
	expect(root.renderer.findByTestId("account-client-id")).toBeDefined();
	expect(root.renderer.findByTestId("account-token")).toBeUndefined();
	root.renderer.focusElement(token.id);
	root.renderer.simulateKeystrokes("enter");
	await settle();
	expect(root.renderer.findByTestId("account-token")).toBeDefined();
	expect(f.requests).toEqual([]);
});

it("keeps compact content insets while placing the Settings title over navigation", async () => {
	const f = fixture();

	root.render(
		<AccountsSettings accounts={f.accounts} onBack={() => undefined} />
	);
	await settle();
	const navigation = root.renderer.findByTestId("settings-navigation")!;
	const heading = root.renderer.findByTestId("accounts-heading")!;
	const header = root.renderer.findByTestId("accounts-list-header")!;
	const content = root.renderer.findByTestId("accounts-list-content")!;
	const tab = root.renderer.findByTestId("settings-title-tab-label")!;
	const navigationBounds = root.renderer.getElementBounds(navigation.id)!;
	const headingBounds = root.renderer.getElementBounds(heading.id)!;

	expect(headingBounds.x - navigationBounds.x - navigationBounds.width).toBe(
		16
	);
	expect(
		root.renderer.getElementBounds(header.id)!.y - navigationBounds.y
	).toBe(16);
	expect(root.renderer.getElementBounds(content.id)!.x).toBe(headingBounds.x);
	expect(root.renderer.getElementBounds(tab.id)!.x).toBeGreaterThan(
		navigationBounds.x
	);
	expect(root.renderer.getElementBounds(tab.id)!.x).toBeLessThan(
		navigationBounds.x + navigationBounds.width
	);
});

it("copies public registration values with mouse and keyboard and follows the GitLab callback", async () => {
	const f = fixture();
	const copied: string[] = [];

	root.render(
		<AccountsSettings
			accounts={f.accounts}
			onBack={() => undefined}
			copyText={async (value) => {
				copied.push(value);
			}}
		/>
	);
	await settle();
	click("account-add");
	await settle();
	expect(root.renderer.findByTestId("account-copy-homepage")).toBeDefined();
	expect(copied).toEqual([]);
	click("account-copy-name");
	await settle();
	click("account-copy-homepage");
	await settle();
	const callbackCopy = root.renderer.findByTestId("account-copy-callback")!;

	root.renderer.focusElement(callbackCopy.id);
	root.renderer.simulateKeystrokes("enter");
	await settle();
	expect(copied).toEqual([
		"1git",
		"https://github.com/1bye/1git",
		"http://127.0.0.1:8765/oauth/callback",
	]);
	expect(root.renderer.getAllText()).toContain("Copied");
	expect(JSON.stringify(root.renderer.getA11yTree())).toContain(
		"Copy Callback URL"
	);
	click("account-provider-gitlab");
	await settle();
	expect(root.renderer.findByTestId("account-copy-homepage")).toBeUndefined();
	await revealSetupControl("account-advanced");
	click("account-advanced");
	await settle();
	await revealSetupControl("account-callback");
	click("account-callback");
	root.renderer.simulateKeystrokes("cmd-a");
	root.renderer.simulateKeystrokes(
		[..."http://127.0.0.1:9876/oauth/callback"].join(" ")
	);
	await settle();
	await revealSetupControl("account-copy-callback");
	click("account-copy-callback");
	await settle();
	expect(copied.at(-1)).toBe("http://127.0.0.1:9876/oauth/callback");
	await revealSetupControl("account-auth-token");
	click("account-auth-token");
	await settle();
	expect(root.renderer.findByTestId("account-copy-callback")).toBeUndefined();
	expect(root.renderer.findByTestId("account-token")).toBeDefined();
	expect(f.requests).toEqual([]);
	expect(f.secrets.size).toBe(0);

	if (process.env.GPUIX_ACCOUNTS_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_ACCOUNTS_SCREENSHOT}.quick-token.png`
		);
});

it("reports clipboard failures safely and allows copying again", async () => {
	const f = fixture();
	const copied: string[] = [];
	let fail = true;

	root.render(
		<AccountsSettings
			accounts={f.accounts}
			onBack={() => undefined}
			copyText={async (value) => {
				if (fail) throw new Error("must-not-display-native-clipboard-error");

				copied.push(value);
			}}
		/>
	);
	await settle();
	click("account-add");
	await settle();
	expect(root.renderer.findByTestId("account-copy-homepage")).toBeDefined();
	click("account-copy-homepage");
	await settle();
	expect(root.renderer.getAllText().join("\n")).toContain(
		"Could not copy. Try again."
	);
	expect(JSON.stringify(root.renderer.getA11yTree())).not.toContain(
		"must-not-display"
	);
	fail = false;
	click("account-copy-homepage");
	await settle();
	expect(copied).toEqual(["https://github.com/1bye/1git"]);
	expect(root.renderer.getAllText()).toContain("Copied");
	expect(root.renderer.getAllText().join("\n")).not.toContain("Could not copy");
});

it("shows quick setup without numbered steps and keeps Advanced after the connection fields", async () => {
	const f = fixture();

	root.render(
		<AccountsSettings accounts={f.accounts} onBack={() => undefined} />
	);
	await settle();
	click("account-add");
	await settle();
	const browserText = root.renderer.getAllText().join("\n");

	expect(browserText).not.toMatch(
		/\b[1-5]\. (?:Choose|Register|Configure|Paste)/u
	);
	expect(browserText.indexOf("Provider")).toBeLessThan(
		browserText.indexOf("Connect with")
	);
	expect(browserText.indexOf("Connect with")).toBeLessThan(
		browserText.indexOf("Application setup")
	);
	expect(browserText).toContain("Homepage URL");
	expect(browserText).toContain("Enable Device Flow");
	expect(browserText.indexOf("Client ID")).toBeLessThan(
		browserText.indexOf("Advanced")
	);

	if (process.env.GPUIX_ACCOUNTS_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_ACCOUNTS_SCREENSHOT}.quick-browser.png`
		);

	click("account-auth-token");
	await settle();
	const tokenText = root.renderer.getAllText().join("\n");

	expect(tokenText).toContain("Token setup");
	expect(tokenText).toContain("Token name");
	expect(tokenText).toContain("fine-grained token with an expiry date");
	expect(tokenText).not.toContain("Application setup");
	expect(root.renderer.findByTestId("account-copy-homepage")).toBeUndefined();
	expect(root.renderer.findByTestId("account-copy-callback")).toBeUndefined();
	expect(tokenText.indexOf("Access token")).toBeLessThan(
		tokenText.indexOf("Advanced")
	);
	expect(f.requests).toEqual([]);
});

it("preserves a scrolled account list while setup has its own independent scrolling", async () => {
	const f = fixture();

	f.store.save(
		Array.from({ length: 20 }, (_, index) => ({
			provider: "github" as const,
			webUrl: "https://github.com/",
			id: String(index + 1),
			username: `user-${index + 1}`,
		}))
	);
	root.render(<App accounts={f.accounts} />);
	await settle();
	root.renderer.simulateKeystrokes("cmd-,");
	await settle();
	const list = root.renderer.findByTestId("accounts-list-scroll")!;
	const initialListBounds = root.renderer.getElementBounds(list.id)!;

	root.renderer.nativeSimulateScrollWheel(
		initialListBounds.x + 30,
		initialListBounds.y + 40,
		0,
		-180
	);
	await settle();
	const offset = root.renderer.getScrollOffset(list.id);

	expect(offset?.[1]).toBeLessThan(0);
	click("account-add");
	await settle();
	expect(root.renderer.findByTestId("accounts-list-scroll")?.id).toBe(list.id);
	expect(root.renderer.getScrollOffset(list.id)).toEqual(offset);
	const setup = root.renderer.findByTestId("account-setup-scroll")!;
	const setupOffset = root.renderer.getScrollOffset(setup.id);
	const footer = root.renderer.findByTestId("account-setup-footer")!;
	const footerBounds = root.renderer.getElementBounds(footer.id);
	const listBounds = root.renderer.getElementBounds(list.id)!;

	root.renderer.nativeSimulateScrollWheel(
		listBounds.x + 30,
		listBounds.y + 40,
		0,
		-180
	);
	await settle();
	expect(root.renderer.getScrollOffset(list.id)?.[1]).toBeLessThan(offset![1]);
	expect(root.renderer.getScrollOffset(setup.id)).toEqual(setupOffset);
	expect(root.renderer.getElementBounds(footer.id)).toEqual(footerBounds);
	expect(f.requests).toEqual([]);
});

it("preserves a native commit draft and list scroll when closing the Settings tab while hidden-tab shortcuts are blocked", async () => {
	const f = fixture();

	root.render(<App accounts={f.accounts} preview initialTabCount={2} />);
	await settle();
	click("commit-message");
	root.renderer.simulateKeystrokes("d r a f t");
	await settle();
	const editor = root.renderer.findByTestId("commit-message")!;
	const list = root.renderer.findByTestId("repository-list")!;

	root.renderer.scrollTo(list.id, 0, -120);
	await settle();
	const offset = root.renderer.getScrollOffset(list.id);

	root.renderer.simulateKeystrokes("cmd-,");
	await settle();
	root.renderer.simulateKeystrokes("cmd-2");
	await settle();
	root.renderer.nativeSimulateKeyDown(
		root.renderer.findByTestId("settings-title-tab-close")!.id,
		"cmd-right"
	);
	await settle();
	root.renderer.nativeSimulateKeyDown(
		root.renderer.findByTestId("settings-title-tab-close")!.id,
		"cmd-w"
	);
	await settle();
	click("settings-title-tab-close");
	await settle();
	expect(root.renderer.findByTestId("settings-view")).toBeUndefined();
	expect(root.renderer.findByTestId("commit-message")?.id).toBe(editor.id);
	expect(root.renderer.findByTestId("commit-message")?.customProps?.value).toBe(
		"draft"
	);
	expect(root.renderer.getScrollOffset(list.id)).toEqual(offset);
	expect(root.renderer.getFocusedElementId()).toBe(editor.id);
});

it("shows only the public device code, authorizes through the browser flow and stores the OAuth pair securely", async () => {
	const f = fixture(200, true);

	root.render(<App accounts={f.accounts} />);
	await settle();
	root.renderer.simulateKeystrokes("cmd-,");
	await settle();
	click("account-add");
	await settle();
	click("account-client-id");
	root.renderer.simulateKeystrokes("p u b l i c");
	await settle();
	click("account-connect");
	await settle();
	expect(root.renderer.getPaintedText().join("\n")).toContain("ABCD-EFGH");
	expect(JSON.stringify(root.renderer.toJSON())).not.toContain("never-render");
	await Bun.sleep(1100);
	await settle();
	expect(root.renderer.getAllText()).toContain("tester");
	expect(f.secrets.size).toBe(1);
	expect([...f.secrets.values()][0]).toContain("never-render-oauth-refresh");
	expect(readFileSync(f.store.path, "utf8")).not.toContain("never-render");
	expect(JSON.stringify(root.renderer.toJSON())).not.toContain("never-render");
});

it("cancels a pending device sign-in without storing an account", async () => {
	const f = fixture(200, true);

	root.render(<App accounts={f.accounts} preview />);
	await settle();
	root.renderer.simulateKeystrokes("cmd-,");
	await settle();
	click("account-add");
	await settle();
	click("account-client-id");
	root.renderer.simulateKeystrokes("p u b l i c");
	await settle();
	click("account-connect");
	await settle();
	const history = root.renderer.findByTestId("view-history")!;

	expect(history.style.opacity).toBe(0.45);
	expect(history.customProps?.tabIndex).toBeUndefined();
	expect(root.renderer.findByTestId("account-device-code")).toBeDefined();
	click("view-history");
	root.renderer.nativeSimulateKeyDown(history.id, "enter");
	await settle();
	expect(root.renderer.findByTestId("settings-view")).toBeDefined();
	expect(root.renderer.findByTestId("account-device-code")).toBeDefined();
	click("accounts-cancel");
	await settle();
	expect(root.renderer.findByTestId("account-device-code")).toBeUndefined();
	expect(f.secrets.size).toBe(0);
	expect(
		f.requests.some((url) => url.endsWith("/login/oauth/access_token"))
	).toBe(false);
});

it("shows compact right-aligned account icons with accessible mouse and keyboard actions", async () => {
	const f = fixture();

	const [account] = await f.accounts.connect({
		provider: "github",
		webUrl: "https://github.com",
		token: "synthetic-action-token",
	});

	const key = AccountStore.key(account!);

	const gitlab = {
		provider: "gitlab" as const,
		webUrl: "https://gitlab.example/team/",
		id: "8",
		username: "gitlab-user",
	};

	f.store.save([account!, gitlab]);

	root.render(<App accounts={f.accounts} />);
	await settle();
	root.renderer.simulateKeystrokes("cmd-,");
	await settle();
	const info = root.renderer.findByTestId(`account-info-${key}`)!;
	const infoBounds = root.renderer.getElementBounds(info.id)!;
	const row = root.renderer.findByTestId(`account-${key}`)!;
	const rowBounds = root.renderer.getElementBounds(row.id)!;
	const actions = ["check", "reconnect", "remove"] as const;

	for (const saved of [account!, gitlab]) {
		const savedKey = AccountStore.key(saved);

		const icon = root.renderer.findByTestId(
			`account-provider-icon-${savedKey}`
		)!;

		const name = root.renderer.findByTestId(`account-name-${savedKey}`)!;
		const status = root.renderer.findByTestId(`account-status-${savedKey}`)!;
		const iconBounds = root.renderer.getElementBounds(icon.id)!;
		const nameBounds = root.renderer.getElementBounds(name.id)!;
		const statusBounds = root.renderer.getElementBounds(status.id)!;

		expect(icon.customProps?.source).toBe(accountProviderIcons[saved.provider]);
		expect(iconBounds.x + iconBounds.width).toBeLessThan(nameBounds.x);
		expect(statusBounds.y - nameBounds.y - nameBounds.height).toBe(2);
		expect(root.renderer.getAllText()).toContain(saved.username);
	}

	expect(root.renderer.getAllText()).not.toContain("tester · GitHub");
	expect(root.renderer.getAllText()).not.toContain("gitlab-user · GitLab");
	expect(JSON.stringify(root.renderer.getA11yTree())).toContain(
		"tester · GitHub"
	);
	expect(JSON.stringify(root.renderer.getA11yTree())).toContain(
		"gitlab-user · GitLab"
	);

	for (const action of actions) {
		const button = root.renderer.findByTestId(`account-${action}-${key}`)!;
		const bounds = root.renderer.getElementBounds(button.id)!;

		expect(bounds.width).toBe(26);
		expect(bounds.height).toBe(26);
		expect(bounds.x).toBeGreaterThan(infoBounds.x + infoBounds.width);
		expect(
			root.renderer.findByTestId(`account-${action}-icon-${key}`)
		).toBeDefined();
	}

	const remove = root.renderer.findByTestId(`account-remove-${key}`)!;
	const removeBounds = root.renderer.getElementBounds(remove.id)!;

	expect(removeBounds.x + removeBounds.width).toBe(
		rowBounds.x + rowBounds.width - 16
	);
	expect(root.renderer.getAllText()).not.toContain("Check");
	expect(root.renderer.getAllText()).not.toContain("Reconnect");
	expect(root.renderer.getAllText()).not.toContain("Remove");
	expect(JSON.stringify(root.renderer.getA11yTree())).toContain(
		"Check connection for tester on github.com"
	);
	expect(JSON.stringify(root.renderer.getA11yTree())).toContain(
		"Reconnect tester on github.com"
	);
	expect(JSON.stringify(root.renderer.getA11yTree())).toContain(
		"Remove tester on github.com"
	);
	const check = root.renderer.findByTestId(`account-check-${key}`)!;

	root.renderer.focusElement(check.id);
	root.renderer.simulateKeystrokes("enter");
	await settle();
	expect(root.renderer.getAllText()).toContain("github.com · Connected");
	expect(f.requests).toHaveLength(2);

	if (process.env.GPUIX_ACCOUNTS_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_ACCOUNTS_SCREENSHOT}.actions.png`
		);

	click(`account-reconnect-${key}`);
	await settle();
	expect(root.renderer.getAllText()).toContain("Reconnect account");
	click(`account-check-${key}`);
	await settle();
	expect(f.requests).toHaveLength(2);
});

it("confirms the exact account before removal and cancels without changing saved credentials", async () => {
	const f = fixture();

	const [account] = await f.accounts.connect({
		provider: "github",
		webUrl: "https://github.com",
		token: "synthetic-removal-token",
	});

	const other = { ...account!, id: "8", username: "other-user" };
	const key = AccountStore.key(account!);
	const otherKey = AccountStore.key(other);

	f.store.save([account!, other]);
	f.secrets.set(otherKey, "unrelated-test-credential");
	root.render(<App accounts={f.accounts} />);
	await settle();
	root.renderer.simulateKeystrokes("cmd-,");
	await settle();
	const remove = root.renderer.findByTestId(`account-remove-${key}`)!;

	root.renderer.focusElement(remove.id);
	root.renderer.simulateKeystrokes("enter");
	await settle();
	const dialog = root.renderer.findByTestId("account-remove-dialog")!;
	const dialogBounds = root.renderer.getElementBounds(dialog.id)!;

	expect(Math.abs(dialogBounds.x + dialogBounds.width / 2 - 490)).toBeLessThan(
		2
	);
	expect(root.renderer.getAllText()).toContain("Remove account?");
	expect(root.renderer.getAllText()).toContain("tester · GitHub · github.com");
	expect(root.renderer.getAllText().join("\n")).toContain(
		"Your GitHub account and repositories stay unchanged."
	);
	expect(f.store.load()).toEqual([account!, other]);
	expect(f.secrets.size).toBe(2);
	expect(root.renderer.getFocusedElementId()).toBe(
		root.renderer.findByTestId("account-remove-cancel")!.id
	);
	root.renderer.simulateKeystrokes("tab");
	await settle();
	expect(root.renderer.getFocusedElementId()).toBe(
		root.renderer.findByTestId("account-remove-confirm")!.id
	);
	root.renderer.simulateKeystrokes("shift-tab escape");
	await settle();
	expect(root.renderer.findByTestId("account-remove-dialog")).toBeUndefined();
	expect(root.renderer.findByTestId("settings-view")).toBeDefined();
	expect(root.renderer.getFocusedElementId()).toBe(remove.id);

	click(`account-remove-${key}`);
	await settle();
	click("account-remove-cancel");
	await settle();
	expect(f.store.load()).toEqual([account!, other]);
	expect(f.secrets.size).toBe(2);
	click(`account-remove-${key}`);
	await settle();
	root.renderer.nativeSimulateClick(5, 5);
	await settle();
	expect(root.renderer.findByTestId("account-remove-dialog")).toBeUndefined();
	expect(f.secrets.size).toBe(2);
	click(`account-remove-${key}`);
	await settle();

	if (process.env.GPUIX_ACCOUNTS_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_ACCOUNTS_SCREENSHOT}.remove.png`
		);

	root.renderer.focusElement(
		root.renderer.findByTestId("account-remove-confirm")!.id
	);
	root.renderer.simulateKeystrokes("enter");
	await settle();

	// Saving credentials can complete after the native list has repainted.
	for (
		let attempt = 0;
		attempt < 10 && root.renderer.findByTestId("account-remove-dialog");
		attempt++
	)
		await settle();

	expect(root.renderer.findByTestId("account-remove-dialog")).toBeUndefined();
	expect(f.store.load()).toEqual([other]);
	expect(f.secrets.has(key)).toBe(false);
	expect(f.secrets.get(otherKey)).toBe("unrelated-test-credential");
	expect(f.requests).toHaveLength(1);
	expect(root.renderer.getFocusedElementId()).toBe(
		root.renderer.findByTestId("account-add")!.id
	);
});

it("blocks removal dismissal while saving and preserves a failed account for retry", async () => {
	const pending = Promise.withResolvers<void>();
	let fail = true;

	const f = fixture(200, false, async () => {
		await pending.promise;

		if (fail) throw new Error("Could not remove saved credential.");
	});

	const [account] = await f.accounts.connect({
		provider: "github",
		webUrl: "https://github.com",
		token: "synthetic-busy-token",
	});

	const key = AccountStore.key(account!);

	root.render(<App accounts={f.accounts} />);
	await settle();
	root.renderer.simulateKeystrokes("cmd-,");
	await settle();
	click(`account-remove-${key}`);
	await settle();
	click("account-remove-confirm");
	await settle();
	const close = root.renderer.findByTestId("settings-title-tab-close")!;

	expect(close.customProps?.tabIndex).toBeUndefined();
	expect(close.style.opacity).toBe(0.45);
	root.renderer.nativeSimulateKeyDown(close.id, "enter");
	click("settings-title-tab-close");
	root.renderer.simulateKeystrokes("escape");
	root.renderer.nativeSimulateClick(5, 5);
	click("account-remove-cancel");
	await settle();
	expect(root.renderer.findByTestId("account-remove-dialog")).toBeDefined();
	expect(root.renderer.findByTestId("settings-view")).toBeDefined();
	expect(f.store.load()).toEqual([account!]);
	expect(f.secrets.size).toBe(1);
	pending.resolve();
	await settle();
	expect(
		root.renderer.findByTestId("settings-title-tab-close")?.customProps
			?.tabIndex
	).toBe(0);
	expect(root.renderer.getAllText()).toContain(
		"Could not remove saved credential."
	);
	expect(root.renderer.findByTestId("account-remove-dialog")).toBeDefined();
	expect(f.secrets.size).toBe(1);
	fail = false;
	click("account-remove-confirm");
	await settle();
	expect(root.renderer.findByTestId("account-remove-dialog")).toBeUndefined();
	expect(root.renderer.getAllText()).toContain("No accounts connected.");
	expect(f.secrets.size).toBe(0);
});

it("connects with a masked token, keeps it out of native dumps, persists identity and removes the saved credential", async () => {
	const f = fixture();

	root.render(<App accounts={f.accounts} />);
	await settle();
	root.renderer.simulateKeystrokes("cmd-,");
	await settle();
	click("account-add");
	await settle();
	click("account-auth-token");
	await settle();
	click("account-token");
	root.renderer.simulateKeystrokes("s y n t h e t i c");
	await settle();

	expect(root.renderer.getPaintedText().join("\n")).not.toContain("synthetic");
	expect(root.renderer.getPaintedText().join("\n")).toContain("*********");
	expect(JSON.stringify(root.renderer.toJSON())).not.toContain("synthetic");
	expect(JSON.stringify(root.renderer.getA11yTree())).not.toContain(
		"synthetic"
	);
	expect(JSON.stringify(root.renderer.getA11yTree()).toLowerCase()).toContain(
		"password"
	);
	const screenshot = process.env.GPUIX_ACCOUNTS_SCREENSHOT;

	if (screenshot) root.renderer.captureScreenshot(screenshot);

	click("account-connect");
	await settle();
	expect(root.renderer.getAllText()).toContain("tester");
	expect(root.renderer.findByTestId("account-setup-panel")).toBeUndefined();
	expect(f.secrets.size).toBe(1);
	expect(readFileSync(f.store.path, "utf8")).not.toContain("synthetic");
	const key = AccountStore.key(f.store.load()[0]!);

	click(`account-remove-${key}`);
	await settle();
	expect(f.secrets.size).toBe(1);
	click("account-remove-confirm");
	await settle();
	expect(root.renderer.getAllText()).toContain("No accounts connected.");
	expect(f.secrets.size).toBe(0);
});

it("shows safe provider failures, clears the token field and allows retry", async () => {
	const f = fixture(401);

	root.render(<App accounts={f.accounts} />);
	await settle();
	root.renderer.simulateKeystrokes("cmd-,");
	await settle();
	click("account-add");
	await settle();
	click("account-auth-token");
	await settle();
	click("account-token");
	root.renderer.simulateKeystrokes("s e c r e t");
	await settle();
	click("account-connect");
	await settle();

	expect(root.renderer.findByTestId("accounts-error")).toBeDefined();
	expect(root.renderer.getAllText().join("\n")).not.toContain(
		"must-not-display-server-text"
	);
	expect(root.renderer.getPaintedText().join("\n")).not.toContain("******");
	expect(f.secrets.size).toBe(0);
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(root.renderer.findByTestId("account-token")).toBeUndefined();
});

it("supports password caret editing with Unicode without exposing clear text", async () => {
	let value = "";

	root.render(
		<input
			type="password"
			testId="password-test"
			aria-label="Test password"
			tabIndex={0}
			style={{ width: 280, height: 36 }}
			onChange={(event) => {
				value = event.value ?? "";
			}}
		/>
	);
	click("password-test");
	root.renderer.simulateKeystrokes("é left x");
	await settle();

	expect(value).toBe("xé");
	expect(root.renderer.getPaintedText().join("\n")).toContain("**");
	expect(root.renderer.getPaintedText().join("\n")).not.toContain("xé");
	root.renderer.simulateKeystrokes("cmd-a cmd-c cmd-x cmd-z");
	await settle();
	expect(value).toBe("");
});

it("switches provider cells with mouse and keyboard and shows the matching setup guide", async () => {
	const f = fixture();

	root.render(<App accounts={f.accounts} />);
	await settle();
	root.renderer.simulateKeystrokes("cmd-,");
	await settle();
	click("account-add");
	await settle();
	expect(root.renderer.getFocusedElementId()).toBe(
		root.renderer.findByTestId("account-provider-github")!.id
	);
	click("account-provider-gitlab");
	await settle();

	expect(root.renderer.getPaintedText().join("\n")).toContain(
		"Uncheck Confidential"
	);
	expect(root.renderer.findByTestId("account-host")).toBeUndefined();
	expect(root.renderer.findByTestId("account-callback")).toBeUndefined();
	expect(root.renderer.findByTestId("account-provider-gitlab")).toBeDefined();
	const github = root.renderer.findByTestId("account-provider-github")!;

	root.renderer.nativeSimulateKeyDown(github.id, "space");
	expect(root.renderer.getPaintedText().join("\n")).toContain(
		"Uncheck Confidential"
	);
	root.renderer.nativeSimulateKeyUp(github.id, "space");
	await settle();
	expect(root.renderer.getPaintedText().join("\n")).toContain(
		"Enable Device Flow"
	);
	expect(JSON.stringify(root.renderer.getA11yTree())).toContain(
		"Selected provider"
	);

	const screenshot = process.env.GPUIX_ACCOUNTS_SCREENSHOT;

	if (screenshot) root.renderer.captureScreenshot(`${screenshot}.github.png`);

	const field = root.renderer.findByTestId("account-client-id")!;
	const action = root.renderer.findByTestId("account-connect")!;

	expect(field.style.height).toBe(appTokens.layout.controlHeight);
	expect(field.style.fontSize).toBe(12);
	expect(root.renderer.getElementBounds(action.id)?.height).toBe(
		appTokens.layout.smallControlHeight
	);
	root.renderer.focusElement(
		root.renderer.findByTestId("account-provider-gitlab")!.id
	);
	root.renderer.simulateKeystrokes("enter");
	await settle();
	expect(root.renderer.getPaintedText().join("\n")).toContain(
		"Uncheck Confidential"
	);

	if (screenshot) root.renderer.captureScreenshot(`${screenshot}.gitlab.png`);
});

it("opens only explicitly requested setup pages, including a contribution issue draft", async () => {
	const f = fixture();
	const opened: string[] = [];

	root.render(
		<AccountsSettings
			accounts={f.accounts}
			onBack={() => undefined}
			openLink={async (url) => {
				opened.push(url);
			}}
		/>
	);
	await settle();
	click("account-add");
	await settle();
	expect(opened).toEqual([]);
	click("account-setup-open");
	await settle();
	expect(opened).toEqual(["https://github.com/settings/applications/new"]);
	click("account-auth-token");
	await settle();
	click("account-setup-open");
	await settle();
	expect(new URL(opened[1]!).pathname).toBe(
		"/settings/personal-access-tokens/new"
	);
	click("account-provider-other");
	await settle();
	const issue = new URL(opened[2]!);

	expect(issue.origin + issue.pathname).toBe(
		"https://github.com/1bye/1git/issues/new"
	);
	expect(issue.searchParams.get("body")).toContain("HostingProvider");
	expect(f.requests).toEqual([]);
	expect(f.secrets.size).toBe(0);
});

it("keeps self-managed settings under Advanced, updates callback guidance and rejects unsafe setup hosts", async () => {
	const f = fixture();
	const opened: string[] = [];

	root.render(
		<AccountsSettings
			accounts={f.accounts}
			onBack={() => undefined}
			openLink={async (url) => {
				opened.push(url);
			}}
		/>
	);
	await settle();
	click("account-add");
	await settle();
	click("account-provider-gitlab");
	await settle();
	await revealSetupControl("account-advanced");
	click("account-advanced");
	await settle();
	expect(root.renderer.findByTestId("account-host")?.customProps?.value).toBe(
		"https://gitlab.com"
	);
	await revealSetupControl("account-host");
	click("account-host");
	root.renderer.simulateKeystrokes("cmd-a");
	root.renderer.simulateKeystrokes([..."https://code.example/team"].join(" "));
	await revealSetupControl("account-callback");
	click("account-callback");
	root.renderer.simulateKeystrokes("cmd-a");
	root.renderer.simulateKeystrokes(
		[..."http://127.0.0.1:9876/oauth/callback"].join(" ")
	);
	await settle();
	await revealSetupControl("account-setup-callback");
	expect(root.renderer.getAllText()).toContain(
		"http://127.0.0.1:9876/oauth/callback"
	);
	await revealSetupControl("account-setup-open");
	click("account-setup-open");
	await settle();
	expect(opened).toEqual([
		"https://code.example/team/user_settings/applications",
	]);
	await revealSetupControl("account-host");
	click("account-host");
	root.renderer.simulateKeystrokes("cmd-a");
	root.renderer.simulateKeystrokes(
		[..."https://secret@code.example"].join(" ")
	);
	await settle();
	await revealSetupControl("account-setup-open");
	click("account-setup-open");
	await settle();
	expect(opened).toHaveLength(1);
	expect(root.renderer.getAllText().join("\n")).toContain("valid HTTPS host");
});

it("clears typed secrets when changing providers or authentication methods", async () => {
	const f = fixture();

	root.render(
		<AccountsSettings accounts={f.accounts} onBack={() => undefined} />
	);
	await settle();
	click("account-add");
	await settle();
	click("account-client-id");
	root.renderer.simulateKeystrokes("p u b l i c");
	click("account-auth-token");
	await settle();
	click("account-token");
	root.renderer.simulateKeystrokes("s e c r e t");
	await settle();
	expect(root.renderer.getPaintedText().join("\n")).toContain("******");
	click("account-provider-gitlab");
	await settle();
	expect(root.renderer.getPaintedText().join("\n")).not.toContain("******");
	click("account-connect");
	await settle();
	expect(f.requests).toEqual([]);
	click("account-auth-browser");
	await settle();
	expect(
		root.renderer.findByTestId("account-client-id")?.customProps?.value
	).toBe("");
	click("account-auth-token");
	await settle();
	click("account-token");
	root.renderer.simulateKeystrokes("x y z");
	await settle();
	click("account-auth-browser");
	await settle();
	click("account-auth-token");
	await settle();
	expect(root.renderer.getPaintedText().join("\n")).not.toContain("***");
	expect(JSON.stringify(root.renderer.getA11yTree())).not.toContain("secret");
});

it("reports a safe browser-opening failure and keeps setup available for retry", async () => {
	const f = fixture();

	root.render(
		<AccountsSettings
			accounts={f.accounts}
			onBack={() => undefined}
			openLink={async () => {
				throw new Error("private browser detail");
			}}
		/>
	);
	await settle();
	click("account-add");
	await settle();
	click("account-setup-open");
	await settle();
	expect(root.renderer.getAllText().join("\n")).toContain(
		"Could not open the setup page"
	);
	expect(root.renderer.getAllText().join("\n")).not.toContain(
		"private browser detail"
	);
	expect(root.renderer.findByTestId("account-client-id")).toBeDefined();
	expect(f.requests).toEqual([]);
});

it("pins Cancel and Connect outside setup scrolling at minimum window height", async () => {
	root.unmount();
	root = createTestRoot({
		width: 980,
		height: 640,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	const f = fixture();

	root.render(<App accounts={f.accounts} />);
	await settle();
	root.renderer.simulateKeystrokes("cmd-,");
	await settle();
	click("account-add");
	await settle();
	click("account-provider-gitlab");
	await settle();
	await revealSetupControl("account-advanced");
	click("account-advanced");
	await settle();
	const content = root.renderer.findByTestId("account-setup-scroll")!;
	const bounds = root.renderer.getElementBounds(content.id)!;
	const screenshot = process.env.GPUIX_ACCOUNTS_SCREENSHOT;

	if (screenshot) root.renderer.captureScreenshot(`${screenshot}.minimum.png`);

	for (const provider of ["github", "gitlab", "other"]) {
		const cell = root.renderer.findByTestId(`account-provider-${provider}`)!;
		const cellBounds = root.renderer.getElementBounds(cell.id)!;

		expect(cellBounds.x).toBeGreaterThanOrEqual(bounds.x);
		expect(cellBounds.x + cellBounds.width).toBeLessThanOrEqual(
			bounds.x + bounds.width
		);
	}

	const cancel = root.renderer.findByTestId("accounts-cancel")!;
	const connect = root.renderer.findByTestId("account-connect")!;
	const initialCancelBounds = root.renderer.getElementBounds(cancel.id)!;
	const initialConnectBounds = root.renderer.getElementBounds(connect.id)!;
	const list = root.renderer.findByTestId("accounts-list-scroll")!;
	const listOffset = root.renderer.getScrollOffset(list.id);

	expect(initialCancelBounds.y).toBeGreaterThanOrEqual(
		bounds.y + bounds.height
	);
	expect(
		initialCancelBounds.y + initialCancelBounds.height
	).toBeLessThanOrEqual(640);
	expect(
		initialConnectBounds.y + initialConnectBounds.height
	).toBeLessThanOrEqual(640);

	root.renderer.nativeSimulateScrollWheel(
		bounds.x + bounds.width - 10,
		bounds.y + 100,
		0,
		-240
	);
	await settle();
	expect(root.renderer.getScrollOffset(content.id)?.[1]).toBeLessThan(0);
	expect(root.renderer.getElementBounds(cancel.id)).toEqual(
		initialCancelBounds
	);
	expect(root.renderer.getElementBounds(connect.id)).toEqual(
		initialConnectBounds
	);
	expect(root.renderer.getScrollOffset(list.id)).toEqual(listOffset);

	if (screenshot)
		root.renderer.captureScreenshot(`${screenshot}.minimum-scrolled.png`);

	click("accounts-cancel");
	await settle();
	expect(root.renderer.findByTestId("accounts-empty")).toBeDefined();
	expect(root.renderer.findByTestId("account-setup-panel")).toBeUndefined();
});

it("discovers CLI accounts, connects the chosen account with keyboard activation and keeps gh signed in on removal", async () => {
	const calls: (readonly string[])[] = [];

	const cli = new GitHubCli(async (args) => {
		calls.push(args);

		if (args[1] === "status")
			return JSON.stringify({
				hosts: {
					"github.com": [
						{
							login: "other",
							active: true,
							state: "success",
							token: "never-render-status-token",
						},
						{
							login: "tester",
							active: false,
							state: "success",
							token: "never-render-status-token",
						},
					],
				},
			});

		return "never-render-cli-secret";
	});

	const f = fixture(200, false, undefined, cli);

	root.render(
		<AccountsSettings
			accounts={f.accounts}
			initialForm="connect"
			onBack={() => undefined}
		/>
	);
	await settle();
	click("account-auth-github-cli");
	await settle();
	expect(root.renderer.getAllText()).toContain("other");
	expect(root.renderer.getAllText()).toContain("tester");
	expect(root.renderer.getAllText()).toContain("github.com · Select");
	expect(root.renderer.getAllText().join("\n")).toContain(
		"Select an account below to enable"
	);
	expect(root.renderer.findByTestId("account-connect")?.style.opacity).toBe(
		0.45
	);
	click("account-connect");
	await settle();
	expect(f.store.load()).toEqual([]);
	expect(f.requests).toEqual([]);
	expect(root.renderer.findByTestId("account-token")).toBeUndefined();
	expect(root.renderer.findByTestId("account-client-id")).toBeUndefined();
	const picker = root.renderer.findByTestId("account-cli-github.com-tester");

	if (!picker) throw new Error("Missing CLI account picker");

	root.renderer.focusElement(picker.id);
	root.renderer.simulateKeystrokes("enter");
	await settle();
	expect(JSON.stringify(root.renderer.getA11yTree())).toContain(
		"Selected account"
	);
	expect(root.renderer.getAllText()).toContain("github.com · Selected");
	expect(root.renderer.findByTestId("account-connect")?.style.opacity).not.toBe(
		0.45
	);

	if (process.env.GPUIX_ACCOUNTS_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_ACCOUNTS_SCREENSHOT}.cli.png`
		);

	click("account-connect");
	await settle();
	const account = f.store.load()[0];

	if (!account) throw new Error("Missing connected CLI account");

	expect(account.username).toBe("tester");
	expect(account.credentialSource).toBe("github-cli");
	expect(f.secrets.size).toBe(0);
	expect(readFileSync(f.store.path, "utf8")).not.toContain("never-render");
	expect(root.renderer.getAllText()).not.toContain("never-render");
	click(`account-remove-${AccountStore.key(account)}`);
	await settle();
	expect(root.renderer.getAllText().join("\n")).toContain(
		"You stay signed in to GitHub CLI."
	);
	click("account-remove-confirm");
	await settle();
	expect(f.store.load()).toEqual([]);
	expect(calls).toEqual([
		["auth", "status", "--json", "hosts"],
		["auth", "token", "--hostname", "github.com", "--user", "tester"],
	]);
});

it("shows recoverable CLI errors and empty discovery, refreshes and hides CLI for GitLab", async () => {
	let attempt = 0;

	const cli = new GitHubCli(async () => {
		attempt++;

		if (attempt === 1) throw new Error("never-render-cli-failure");

		return '{"hosts":{}}';
	});

	const f = fixture(200, false, undefined, cli);

	root.render(
		<AccountsSettings
			accounts={f.accounts}
			initialForm="connect"
			onBack={() => undefined}
		/>
	);
	await settle();
	click("account-auth-github-cli");
	await settle();
	expect(root.renderer.findByTestId("account-cli-error")).toBeDefined();
	expect(root.renderer.getAllText()).not.toContain("never-render-cli-failure");
	click("account-cli-refresh");
	await settle();
	expect(root.renderer.findByTestId("account-cli-empty")).toBeDefined();
	click("account-provider-gitlab");
	await settle();
	expect(root.renderer.findByTestId("account-auth-github-cli")).toBeUndefined();
	expect(root.renderer.findByTestId("account-client-id")).toBeDefined();
});

for (const appearance of ["light", "dark"] as const) {
	it(`automatically selects the only CLI account and enables Connect (${appearance})`, async () => {
		const cli = new GitHubCli(async (args) => {
			if (args[1] === "status")
				return JSON.stringify({
					hosts: {
						"github.com": [{ login: "tester", active: true, state: "success" }],
					},
				});

			return "never-render-cli-secret";
		});

		const f = fixture(200, false, undefined, cli);

		root.render(
			<AppThemeContext.Provider
				value={{ ...appThemes[appearance], commitTypeBadges: true }}
			>
				<AccountsSettings
					accounts={f.accounts}
					initialForm="connect"
					onBack={() => undefined}
				/>
			</AppThemeContext.Provider>
		);
		await settle();
		click("account-auth-github-cli");
		await settle();
		const text = root.renderer.getAllText().join("\n");
		const connect = root.renderer.findByTestId("account-connect");

		expect(text).toContain("Ready to connect as tester.");
		expect(root.renderer.getAllText()).toContain("github.com · Selected");
		expect(connect).toBeDefined();
		expect(connect?.customProps?.tabIndex).toBe(0);
		expect(connect?.style.opacity).not.toBe(0.45);
		expect(f.store.load()).toEqual([]);
		expect(f.requests).toEqual([]);

		if (process.env.GPUIX_ACCOUNTS_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_ACCOUNTS_SCREENSHOT}.cli-single-${appearance}.png`
			);

		click("account-connect");
		await settle();
		expect(f.store.load()[0]?.username).toBe("tester");
		expect(f.secrets.size).toBe(0);
	});
}

it("switches an existing app account to CLI without its denied OS vault and keeps CLI errors inside Settings", async () => {
	let token = "";
	let vaultCalls = 0;

	const cli = new GitHubCli(async (args) =>
		args[1] === "status"
			? JSON.stringify({
					hosts: {
						"github.com": [{ login: "tester", active: true, state: "success" }],
					},
				})
			: token
	);

	const f = fixture(200, false, undefined, cli);

	const existing = {
		provider: "github" as const,
		webUrl: "https://github.com/",
		id: "7",
		username: "tester",
	};

	const deny = async () => {
		vaultCalls++;

		throw new Error("OS credential store is unavailable or access was denied");
	};

	const vault = new NativeCredentials({
		readHostingCredential: deny,
		writeHostingCredential: deny,
		deleteHostingCredential: deny,
	});

	const accounts = new Accounts(f.store, vault, f.http, undefined, cli);

	f.store.save([existing]);
	root.render(
		<AccountsSettings
			accounts={accounts}
			initialForm="connect"
			onBack={() => undefined}
		/>
	);
	await settle();
	click("account-auth-github-cli");
	await settle();
	click("account-connect");
	await settle();
	expect(root.renderer.findByTestId("accounts-error")).toBeDefined();
	expect(root.renderer.findByTestId("accounts-settings")).toBeDefined();
	expect(root.renderer.getAllText().join("\n")).not.toContain(
		"Uncaught runtime errors"
	);
	expect(f.store.load()).toEqual([existing]);
	expect(vaultCalls).toBe(0);
	token = "synthetic-cli-credential";
	click("account-connect");
	await settle();
	expect(f.store.load()[0]?.credentialSource).toBe("github-cli");
	expect(f.store.load()[0]?.id).toBe(existing.id);
	expect(root.renderer.findByTestId("accounts-error")).toBeUndefined();
	expect(root.renderer.findByTestId("accounts-settings")).toBeDefined();
	expect(vaultCalls).toBe(0);
});
