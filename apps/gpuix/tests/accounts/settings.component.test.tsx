/**
 * Covers: width-capped Accounts sections, illustrated empty state, split setup, pinned actions, preserved workspace state, token masking, connection/removal and keyboard navigation.
 * Real: App, Accounts, providers, disposable metadata file and native layout/editing/accessibility.
 * Doubles: HTTP and credential vault; no real account, token or network.
 * Requires: built local native addon and macOS graphics access.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import { windowOptions } from "../../src/window-options";
import { AccountAuthorization } from "../../src/feature/accounts/lib/account-authorization";
import { appTokens } from "../../src/styles/tokens";
import { AccountsSettings } from "../../src/feature/accounts/accounts-settings";
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

function fixture(status = 200, device = false) {
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
				secrets.delete(key);
			},
		},
		http,
		new AccountAuthorization(http, async () => undefined)
	);

	return { accounts, store, secrets, requests };
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

it("shows compact icon navigation and aligns the Settings tab with the Accounts content", async () => {
	const f = fixture();

	root.render(<App accounts={f.accounts} preview />);
	await settle();
	const workspaceTab = root.renderer.findByTestId("slot-workspace-1")!;
	const workspaceTabBounds = root.renderer.getElementBounds(workspaceTab.id)!;
	const workspaceSurface = root.renderer.findByTestId("surface-workspace-1")!;

	root.renderer.simulateKeystrokes("cmd-,");
	await settle();
	const sidebar = root.renderer.findByTestId("settings-navigation");
	const title = root.renderer.findByTestId("settings-title-tab");
	const accounts = root.renderer.findByTestId("settings-accounts");
	const back = root.renderer.findByTestId("settings-back")!;
	const backIcon = root.renderer.findByTestId("settings-back-icon");
	const accountsIcon = root.renderer.findByTestId("settings-accounts-icon");
	const titleLabel = root.renderer.findByTestId("settings-title-tab-label");
	const heading = root.renderer.findByTestId("accounts-heading");

	expect(sidebar).toBeDefined();
	expect(title).toBeDefined();
	expect(accounts).toBeDefined();
	expect(backIcon).toBeDefined();
	expect(accountsIcon).toBeDefined();
	expect(titleLabel).toBeDefined();
	expect(heading).toBeDefined();
	const sidebarBounds = root.renderer.getElementBounds(sidebar!.id)!;
	const titleBounds = root.renderer.getElementBounds(title!.id)!;
	const accountsBounds = root.renderer.getElementBounds(accounts!.id)!;
	const backBounds = root.renderer.getElementBounds(back.id)!;
	const backIconBounds = root.renderer.getElementBounds(backIcon!.id)!;
	const accountsIconBounds = root.renderer.getElementBounds(accountsIcon!.id)!;
	const titleLabelBounds = root.renderer.getElementBounds(titleLabel!.id)!;
	const headingBounds = root.renderer.getElementBounds(heading!.id)!;

	expect(backBounds.x).toBeGreaterThanOrEqual(sidebarBounds.x);
	expect(backBounds.x + backBounds.width).toBeLessThanOrEqual(
		sidebarBounds.x + sidebarBounds.width
	);
	expect(backBounds.y + backBounds.height).toBeLessThan(accountsBounds.y);
	expect(backBounds.y).toBeGreaterThanOrEqual(sidebarBounds.y);
	expect(backBounds.height).toBe(appTokens.layout.smallControlHeight);
	expect(accountsBounds.height).toBe(appTokens.layout.smallControlHeight);
	expect(backIconBounds.width).toBe(14);
	expect(accountsIconBounds.width).toBe(14);
	expect(accountsIconBounds.x).toBe(backIconBounds.x);
	expect(titleBounds.x).toBeGreaterThan(sidebarBounds.x + sidebarBounds.width);
	expect(Math.abs(titleLabelBounds.x - headingBounds.x)).toBeLessThanOrEqual(2);
	expect(titleBounds.width).toBe(workspaceTabBounds.width);
	expect(titleBounds.height).toBe(workspaceTabBounds.height);
	expect(titleBounds.y + titleBounds.height).toBe(sidebarBounds.y);
	expect(
		root.renderer.findByTestId("settings-title-tab-surface")?.customProps
			?.source
	).toBe(workspaceSurface.customProps?.source);
	expect(root.renderer.getFocusedElementId()).toBe(back.id);

	click("settings-back-icon");
	await settle();
	expect(root.renderer.findByTestId("settings-view")).toBeUndefined();
	expect(root.renderer.findByTestId("slot-workspace-1")?.id).toBe(
		workspaceTab.id
	);
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
	expect(root.renderer.getPaintedText().join("\n")).toContain(
		"tester · GitHub"
	);
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
				(contentBounds.y + contentBounds.height / 2)
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
	expect(tokenBounds.width).toBe(browserBounds.width);
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

it("numbers provider and method before dynamic instructions and places Advanced after all steps", async () => {
	const f = fixture();

	root.render(
		<AccountsSettings accounts={f.accounts} onBack={() => undefined} />
	);
	await settle();
	click("account-add");
	await settle();
	const browserText = root.renderer.getAllText().join("\n");

	expect(browserText.indexOf("1. Choose a provider")).toBeLessThan(
		browserText.indexOf("2. Choose how to connect")
	);
	expect(browserText.indexOf("2. Choose how to connect")).toBeLessThan(
		browserText.indexOf("3. Register an application")
	);
	expect(browserText.indexOf("3. Register an application")).toBeLessThan(
		browserText.indexOf("4. Configure the application")
	);
	expect(browserText.indexOf("4. Configure the application")).toBeLessThan(
		browserText.indexOf("5. Paste the Client ID")
	);
	expect(browserText.indexOf("5. Paste the Client ID")).toBeLessThan(
		browserText.indexOf("Advanced")
	);

	click("account-auth-token");
	await settle();
	const tokenText = root.renderer.getAllText().join("\n");

	expect(tokenText).toContain("3. Create an access token");
	expect(tokenText).toContain("4. Choose permissions");
	expect(tokenText).toContain("5. Paste your access token");
	expect(tokenText).not.toContain("Register an application");
	expect(tokenText.indexOf("5. Paste your access token")).toBeLessThan(
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

it("preserves a native commit draft and list scroll while Settings blocks hidden-tab shortcuts", async () => {
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
	click("settings-back");
	await settle();
	expect(root.renderer.findByTestId("commit-message")?.id).toBe(editor.id);
	expect(root.renderer.findByTestId("commit-message")?.customProps?.value).toBe(
		"draft"
	);
	expect(root.renderer.getScrollOffset(list.id)).toEqual(offset);
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
	expect(root.renderer.getAllText().join("")).toContain("tester · GitHub");
	expect(f.secrets.size).toBe(1);
	expect([...f.secrets.values()][0]).toContain("never-render-oauth-refresh");
	expect(readFileSync(f.store.path, "utf8")).not.toContain("never-render");
	expect(JSON.stringify(root.renderer.toJSON())).not.toContain("never-render");
});

it("cancels a pending device sign-in without storing an account", async () => {
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
	click("accounts-cancel");
	await settle();
	expect(root.renderer.findByTestId("account-device-code")).toBeUndefined();
	expect(f.secrets.size).toBe(0);
	expect(
		f.requests.some((url) => url.endsWith("/login/oauth/access_token"))
	).toBe(false);
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
	expect(root.renderer.getAllText().join("")).toContain("tester · GitHub");
	expect(root.renderer.findByTestId("account-setup-panel")).toBeUndefined();
	expect(f.secrets.size).toBe(1);
	expect(readFileSync(f.store.path, "utf8")).not.toContain("synthetic");
	const key = AccountStore.key(f.store.load()[0]!);

	click(`account-remove-${key}`);
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
	expect(root.renderer.getAllText().join("\n")).toContain(
		"Redirect URI: http://127.0.0.1:9876/oauth/callback"
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
