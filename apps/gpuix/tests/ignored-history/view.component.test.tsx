/**
 * Covers: compact monitoring form, native field editing, repository opt-in, local diffs and explicit restore confirmation.
 * Real: App, repository settings, shared native file list, diff viewer and keyboard input.
 * Doubles: ignored-history service, Git reads, account catalog and OS vault; no real keys, secrets or filesystem writes.
 * Requires: patched native addon and macOS graphics access.
 */
import { afterEach, expect, it, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { windowOptions } from "../../src/window-options";
import { App } from "../../src/app";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import {
	IgnoredHistory,
	defaultIgnoredPreferences,
	type IgnoredHistoryState,
} from "../../src/feature/ignored-history/ignored-history";
import { NativeFileMenu } from "../../src/feature/repository-workspace/lib/native-file-menu";
import { repositorySnapshot } from "../_shared/repository-snapshot";
import { commitInfo } from "../_shared/history-page";

let root: TestRoot | undefined;

afterEach(() => {
	root?.unmount();
	root = undefined;
});

function node(id: string) {
	const value = root?.renderer.findByTestId(id);

	if (!value) throw new Error(`Missing ${id}`);

	return value;
}
async function settle() {
	for (let index = 0; index < 8; index++) {
		await Bun.sleep(0);
		root?.renderer.flush();
	}
}
async function press(id: string) {
	root?.renderer.nativeSimulateKeyDown(node(id).id, "enter");
	await settle();
}

it.each([
	["light", 1280],
	["dark", 1280],
	["dark", 720],
] as const)(
	"edits repository monitoring, opens its diff and confirms restore (%s, %dpx)",
	async (appearance, width) => {
		const vault = {
			async read() {
				throw new Error("Unexpected vault read");
			},
			async write() {
				throw new Error("Unexpected vault write");
			},
			async delete() {
				throw new Error("Unexpected vault deletion");
			},
		};

		const accounts = new Accounts(
			new AccountStore("/unused/ignored-accounts.json"),
			vault
		);

		const catalog = spyOn(accounts, "load").mockReturnValue([]);
		const history = new IgnoredHistory(vault, "/unused/ignored-history");
		const baseline = "a".repeat(64);
		const modified = "b".repeat(64);

		let data: IgnoredHistoryState = {
			preferences: { ...defaultIgnoredPreferences, paths: [".env"] },
			files: [],
			bytes: 0,
			skipped: [],
		};

		const preferences = spyOn(history, "preferences").mockImplementation(
			async () => data.preferences
		);

		const refresh = spyOn(history, "refresh").mockImplementation(
			async () => data
		);

		const configure = spyOn(history, "configure").mockImplementation(
			async (_repository, input) => {
				data = {
					...data,
					preferences: input,
					files: [
						{
							path: ".env",
							changed: true,
							baseline,
							versions: [
								{
									id: modified,
									at: "2026-10-16T12:05:00Z",
									size: 60,
									mode: 0o600,
									chunks: [],
									deleted: false,
								},
								{
									id: baseline,
									at: "2026-10-16T12:00:00Z",
									size: 60,
									mode: 0o600,
									chunks: [],
									deleted: false,
								},
							],
						},
					],
				};

				return data;
			}
		);

		const diff = spyOn(history, "diff").mockResolvedValue({
			patch:
				"diff --git a/.env b/.env\n--- a/.env\n+++ b/.env\n@@ -1,2 +1,2 @@\n-API_URL=https://old.example.test\n+API_URL=https://new.example.test\n MODE=development\n",
			message: null,
		});

		const restore = spyOn(history, "restore").mockImplementation(async () => {
			data = {
				...data,
				files: data.files.map((file) => ({ ...file, changed: false })),
			};

			return data;
		});

		const menu = spyOn(NativeFileMenu, "showItems").mockReturnValue({
			kind: "settings",
			section: "repository-ignored-history",
		});

		try {
			root = createTestRoot({
				width,
				height: 900,
				onKeyDown: windowOptions.onKeyDown,
			});
			root.render(
				<App
					accounts={accounts}
					ignoredHistory={history}
					initialSession={{
						version: 1,
						activeId: "workspace-1",
						appearance,
						tabs: [{ id: "workspace-1", path: "/test/project", draft: "" }],
					}}
					readRepository={async () => ({
						ok: true,
						value: repositorySnapshot(),
					})}
					readLastCommit={async () => ({
						ok: true,
						value: { commit: commitInfo(), undoUnavailableReason: null },
					})}
					watchRepository={() => () => {}}
				/>
			);
			await settle();
			expect(root.renderer.findByTestId("view-ignored")).toBeUndefined();
			await press("rail-settings");
			expect(node("ignored-history-settings")).toBeDefined();
			const formBounds = root.renderer.getElementBounds(
				node("ignored-history-settings-form").id
			);

			expect(formBounds).toBeDefined();
			expect(formBounds?.width).toBeLessThanOrEqual(480);
			expect((formBounds?.x ?? 0) + (formBounds?.width ?? 0)).toBeLessThan(
				width
			);

			await press("ignored-history-add-path");
			expect(node("ignored-history-editor")).toBeDefined();
			root.renderer.nativeSimulateKeystrokes(
				node("ignored-history-paths").id,
				"p r i v a t e - c o n f i g"
			);
			await settle();
			await press("ignored-history-add");
			expect(configure).toHaveBeenCalledTimes(1);
			expect(configure.mock.calls[0]?.[1]).toMatchObject({
				enabled: false,
				paths: [".env", "private-config"],
			});
			expect(
				root.renderer.findByTestId("ignored-history-editor")
			).toBeUndefined();
			await press("ignored-history-edit-limits");
			root.renderer.nativeSimulateKeystrokes(
				node("ignored-history-budget").id,
				"cmd-a 2 5 6"
			);
			root.renderer.nativeSimulateKeystrokes(
				node("ignored-history-versions").id,
				"cmd-a 1 0"
			);
			await settle();
			await press("ignored-history-save-limits");
			expect(configure).toHaveBeenCalledTimes(2);
			root.renderer.nativeSimulateKeyDown(
				node("ignored-history-enabled").id,
				"space"
			);
			root.renderer.nativeSimulateKeyUp(
				node("ignored-history-enabled").id,
				"space"
			);
			await settle();
			expect(configure).toHaveBeenCalledTimes(3);
			expect(configure.mock.calls[2]?.[1]).toMatchObject({
				enabled: true,
				paths: [".env", "private-config"],
				budgetBytes: 256 * 1024 ** 2,
				maxVersions: 10,
			});
			expect(
				root.renderer.findByTestId("ignored-history-save")
			).toBeUndefined();
			await press("ignored-history-add-path");
			root.renderer.nativeSimulateKeystrokes(
				node("ignored-history-paths").id,
				"u n s a v e d"
			);
			root.renderer.simulateKeystrokes("escape");
			await settle();
			expect(
				root.renderer.findByTestId("ignored-history-editor")
			).toBeUndefined();
			expect(root.renderer.getFocusedElementId()).toBe(
				node("ignored-history-add-path").id
			);
			expect(configure).toHaveBeenCalledTimes(3);

			if (process.env.GPUIX_IGNORED_SCREENSHOT)
				root.renderer.captureScreenshot(
					`${process.env.GPUIX_IGNORED_SCREENSHOT}-settings-${appearance}-${width}.png`
				);

			await press("settings-title-tab-close");
			expect(node("view-ignored")).toBeDefined();
			const stashBounds = root.renderer.getElementBounds(
				node("view-stashes").id
			);

			const ignoredBounds = root.renderer.getElementBounds(
				node("view-ignored").id
			);

			expect(ignoredBounds?.y).toBeGreaterThan(stashBounds?.y ?? 0);
			await press("view-ignored");
			expect(node("ignored-history-view")).toBeDefined();
			expect(node("ignored-history-diff-content").customProps?.patch).toContain(
				"old.example.test"
			);
			expect(root.renderer.findByTestId("commit-message")).toBeUndefined();

			if (process.env.GPUIX_IGNORED_SCREENSHOT)
				root.renderer.captureScreenshot(
					`${process.env.GPUIX_IGNORED_SCREENSHOT}-${appearance}-${width}.png`
				);

			await press("ignored-history-restore");
			expect(restore).not.toHaveBeenCalled();
			await press("ignored-history-restore-cancel");
			expect(restore).not.toHaveBeenCalled();
			await press("ignored-history-restore");
			await press("ignored-history-restore-confirm");
			expect(restore).toHaveBeenCalledWith(
				expect.objectContaining({ root: "/test/project" }),
				".env",
				baseline,
				modified
			);
			await press("view-changes");
			expect(
				root.renderer.findByTestId("ignored-history-view")
			).toBeUndefined();
		} finally {
			catalog.mockRestore();
			preferences.mockRestore();
			refresh.mockRestore();
			configure.mockRestore();
			diff.mockRestore();
			restore.mockRestore();
			menu.mockRestore();
		}
	}
);
