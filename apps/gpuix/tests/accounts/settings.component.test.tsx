/**
 * Covers: in-window Settings, preserved workspace state, token masking, connection/removal and keyboard navigation.
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
	click("account-auth-method");
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
	click("account-auth-method");
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

it("selects GitLab with the native dropdown and preserves keyboard navigation in Settings", async () => {
	const f = fixture();

	root.render(<App accounts={f.accounts} />);
	await settle();
	root.renderer.simulateKeystrokes("cmd-,");
	await settle();
	click("account-add");
	await settle();
	click("account-provider");
	await settle();
	click("account-provider-gitlab");
	await settle();

	expect(root.renderer.getPaintedText().join("\n")).toContain(
		"https://gitlab.com"
	);
	expect(root.renderer.findByTestId("account-provider-gitlab")).toBeUndefined();
	root.renderer.focusElement(
		root.renderer.findByTestId("account-provider")!.id
	);
	root.renderer.simulateKeystrokes("space");
	await settle();
	root.renderer.simulateKeystrokes("up");
	await settle();
	root.renderer.simulateKeystrokes("enter");
	await settle();
	expect(root.renderer.getPaintedText().join("\n")).toContain(
		"https://github.com"
	);
});
