/**
 * Covers: live light/dark selection, persisted preference, retained drafts, inclusion, selection and native diff scroll; dark chrome, syntax, popovers and keyboard choice.
 * Real: App, native rendering/input, theme and session models.
 * Doubles: repository/diff reads, account catalog, editor discovery and session save; no user preferences, credentials or Git writes.
 * Requires: patched native addon and macOS graphics access.
 */
import { afterEach, expect, it, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import { ExternalEditors } from "../../src/feature/editor-settings/external-editors";
import type { WorkspaceSessionDocument } from "../../src/feature/workspace-tabs/lib/workspace-session";
import { appColors, type AppAppearance } from "../../src/styles/tokens";
import { darkDiffTheme } from "../../src/styles/dark-diff-theme";
import { windowOptions } from "../../src/window-options";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";
import { diffSection } from "../_shared/diff-patch";
import { commitInfo } from "../_shared/history-page";

const roots = new Set<TestRoot>();

afterEach(() => {
	for (const root of roots) root.unmount();

	roots.clear();
});

function fixture(appearance?: "light" | "dark") {
	const root = createTestRoot({
		width: 1100,
		height: 760,
		onKeyDown: windowOptions.onKeyDown,
	});

	roots.add(root);
	root.renderer.clockPause();
	const nativeAppearances: AppAppearance[] = [];

	Object.assign(root.renderer, {
		setWindowAppearance(appearance: AppAppearance) {
			nativeAppearances.push(appearance);
		},
	});

	const accounts = new Accounts(
		new AccountStore("/unused/theme-accounts.json"),
		{
			async read() {
				return null;
			},
			async write() {
				throw new Error("No credential writes expected");
			},
			async delete() {
				throw new Error("No credential deletion expected");
			},
		}
	);

	const catalog = spyOn(accounts, "load").mockReturnValue([]);

	const snapshot = repositorySnapshot([
		changedFile("example.ts"),
		changedFile("other.ts"),
	]);

	const context = Array.from(
		{ length: 120 },
		(_, index) => ` const line${index} = ${index};`
	).join("\n");

	const patch = `diff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n@@ -1,122 +1,122 @@\n-${"const version = 1;"}\n+${"const version = 2;"}\n${context}\n const tail = true;\n`;
	const saved: WorkspaceSessionDocument[] = [];
	const reads: string[] = [];

	root.render(
		<App
			accounts={accounts}
			externalEditors={
				new ExternalEditors("/unused/theme-editors.json", async () => "", [])
			}
			initialSession={{
				version: 1,
				tabs: [
					{ id: "workspace-1", path: "/test/project", draft: "Keep my draft" },
				],
				activeId: "workspace-1",
				appearance,
			}}
			readRepository={async () => ({ ok: true, value: snapshot })}
			readDiff={async (_root, change) => {
				reads.push(change.path);

				return { ok: true, value: [diffSection("working", patch)] };
			}}
			readLastCommit={async () => ({
				ok: true,
				value: { commit: commitInfo(), undoUnavailableReason: null },
			})}
			saveSession={(document) => saved.push(document)}
		/>
	);

	return {
		root,
		saved,
		catalog,
		reads: () => reads.filter((path) => path === "example.ts").length,
		nativeAppearances,
	};
}

function node(root: TestRoot, testId: string) {
	const found = root.renderer.findByTestId(testId);

	if (!found) throw new Error(`Missing ${testId}`);

	return found;
}

function click(root: TestRoot, testId: string): void {
	const bounds = root.renderer.getElementBounds(node(root, testId).id);

	if (!bounds) throw new Error(`Missing bounds for ${testId}`);

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	root.renderer.flush();
}

async function settle(root: TestRoot): Promise<void> {
	for (let attempt = 0; attempt < 5; attempt++) {
		await Bun.sleep(0);
		root.renderer.clockFastForward(250);
		root.renderer.advanceTime(1);
		root.renderer.flush();
	}
}

it("switches in Settings without losing a draft, selected file, inclusion or diff scroll and saves the choice", async () => {
	const { root, saved, reads, catalog, nativeAppearances } = fixture();

	await settle(root);
	expect(nativeAppearances).toEqual(["light"]);
	click(root, "entry-example.ts");
	await settle(root);
	click(root, "include-other.ts");
	const content = node(root, "diff-viewport-content").id;

	root.renderer.scrollTo(content, 0, -420);
	root.renderer.flush();
	const scroll = root.renderer.getScrollOffset(content);
	const count = reads();

	click(root, "rail-settings");
	await settle(root);
	click(root, "settings-appearance");
	click(root, "appearance-dark");
	await settle(root);
	expect(nativeAppearances).toEqual(["light", "dark"]);
	expect(node(root, "appearance-dark").customProps?.["aria-description"]).toBe(
		"Selected"
	);
	expect(node(root, "settings-view").style.backgroundColor).toBe(
		appColors.dark.chrome
	);
	expect(
		node(root, "settings-title-tab-surface").customProps?.source
	).toContain(appColors.dark.editorSurface);
	await Bun.sleep(230);
	root.renderer.flush();
	expect(saved.at(-1)?.appearance).toBe("dark");
	expect(saved.at(-1)?.tabs[0]?.draft).toBe("Keep my draft");

	click(root, "view-changes");
	await settle(root);
	expect(node(root, "app-shell").style.backgroundColor).toBe("transparent");
	expect(node(root, "diff-viewport-content").id).toBe(content);
	expect(root.renderer.getScrollOffset(content)).toEqual(scroll);
	expect(node(root, "entry-example.ts").customProps?.["aria-selected"]).toBe(
		true
	);
	expect(node(root, "include-other.ts").customProps?.["aria-checked"]).toBe(
		false
	);
	expect(node(root, "commit-message").customProps?.value).toBe("Keep my draft");
	expect(reads()).toBe(count);
	expect(node(root, "filename-example.ts").style.color).toBe(
		appColors.dark.editorInk
	);
	expect(node(root, "workspace-home-icon").style.color).toBe(
		appColors.dark.editorMuted
	);
	expect(node(root, "surface-workspace-1").customProps?.source).toContain(
		appColors.dark.editorSurface
	);
	expect(node(root, "diff-viewport-content").customProps?.theme).toMatchObject(
		darkDiffTheme
	);

	if (process.env.GPUIX_DARK_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_DARK_SCREENSHOT);

	click(root, "rail-settings");
	await settle(root);
	click(root, "settings-appearance");
	click(root, "appearance-light");
	click(root, "view-changes");
	await settle(root);
	expect(nativeAppearances).toEqual(["light", "dark", "light"]);
	expect(node(root, "filename-example.ts").style.color).toBe(
		appColors.light.editorInk
	);
	expect(node(root, "diff-viewport-content").id).toBe(content);
	expect(node(root, "diff-viewport-content").customProps?.theme).toMatchObject({
		appearance: "light",
		bg: appColors.light.editorSurface,
	});
	catalog.mockRestore();
});

it("restores dark appearance and keeps popovers readable", async () => {
	const { root, catalog, nativeAppearances } = fixture("dark");

	await settle(root);
	expect(nativeAppearances).toEqual(["dark"]);
	click(root, "entry-example.ts");
	await settle(root);
	click(root, "diff-settings");
	await settle(root);
	expect(node(root, "diff-settings-panel").style.backgroundColor).toBe(
		appColors.dark.editorSurface
	);
	expect(node(root, "diff-settings-icon").style.color).toBe(
		appColors.dark.editorMuted
	);

	if (process.env.GPUIX_DARK_POPOVER_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_DARK_POPOVER_SCREENSHOT);

	catalog.mockRestore();
});

it("supports keyboard selection without leaking appearance into another session", async () => {
	const first = fixture("dark");

	await settle(first.root);
	click(first.root, "rail-settings");
	await settle(first.root);
	click(first.root, "settings-appearance");
	first.root.renderer.nativeSimulateKeyDown(
		node(first.root, "appearance-light").id,
		"space"
	);
	first.root.renderer.nativeSimulateKeyUp(
		node(first.root, "appearance-light").id,
		"space"
	);
	first.root.renderer.flush();
	await settle(first.root);
	expect(
		node(first.root, "appearance-light").customProps?.["aria-description"]
	).toBe("Selected");
	click(first.root, "appearance-dark");
	expect(node(first.root, "settings-view").style.backgroundColor).toBe(
		appColors.dark.chrome
	);

	if (process.env.GPUIX_DARK_SETTINGS_SCREENSHOT)
		first.root.renderer.captureScreenshot(
			process.env.GPUIX_DARK_SETTINGS_SCREENSHOT
		);

	first.catalog.mockRestore();
	first.root.unmount();
	roots.delete(first.root);
	const second = fixture("light");

	await settle(second.root);
	expect(node(second.root, "app-shell").style.backgroundColor).toBe(
		appColors.light.chrome
	);
	second.catalog.mockRestore();
});
