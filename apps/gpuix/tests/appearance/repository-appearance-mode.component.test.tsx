/**
 * Covers: real workspace customization, visible drag previews, temporary drafts, save/cancel, Settings return and the last-used repository.
 * Real: App, appearance editor, native rendering/input, palette and session models.
 * Doubles: repository/diff/account/editor reads, native menu selections and session writes; no Git writes or real preferences.
 * Requires: patched native addon and macOS graphics access.
 */
import { afterEach, expect, it, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import { ExternalEditors } from "../../src/feature/editor-settings/external-editors";
import { NativeFileMenu } from "../../src/feature/repository-workspace/lib/native-file-menu";
import { repositoryPatternSources } from "../../src/feature/repository-appearance/pattern-artwork";
import { RepositoryTheme } from "../../src/styles/repository-theme";
import { appThemes } from "../../src/styles/theme";
import { windowOptions } from "../../src/window-options";
import type { WorkspaceSessionDocument } from "../../src/feature/workspace-tabs/lib/workspace-session";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";
import { commitInfo, emptyHistory } from "../_shared/history-page";
import { diffSection } from "../_shared/diff-patch";

const roots = new Set<TestRoot>();
const restores = new Set<() => void>();

afterEach(() => {
	for (const root of roots) root.unmount();

	for (const restore of restores) restore();

	roots.clear();
	restores.clear();
});

function node(root: TestRoot, id: string) {
	const element = root.renderer.findByTestId(id);

	if (!element) throw new Error(`Missing ${id}`);

	return element;
}

function bounds(root: TestRoot, id: string) {
	const result = root.renderer.getElementBounds(node(root, id).id);

	if (!result) throw new Error(`Missing bounds for ${id}`);

	return result;
}

async function settle(root: TestRoot, duration = 0) {
	await Bun.sleep(duration);
	root.renderer.flush();
	await Bun.sleep(0);
	root.renderer.flush();
}

async function click(root: TestRoot, id: string) {
	const box = bounds(root, id);

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2
	);
	await settle(root);
}

async function typeHex(root: TestRoot, value: string, submit = true) {
	root.renderer.scrollTo(
		node(root, "repository-appearance-controls").id,
		0,
		-120
	);
	root.renderer.flush();
	await click(root, "repository-color-custom");
	root.renderer.simulateKeystrokes("cmd-a");
	root.renderer.simulateKeystrokes([...value].join(" "));

	if (submit) root.renderer.simulateKeystrokes("enter");

	await settle(root);
	expect(node(root, "repository-color-custom").customProps?.value).toBe(value);
}

async function fixture(appearance: "light" | "dark" = "dark") {
	const root = createTestRoot({
		width: 1180,
		height: 820,
		onKeyDown: windowOptions.onKeyDown,
	});

	roots.add(root);
	const saved: WorkspaceSessionDocument[] = [];
	const reads: string[] = [];
	const diffReads: string[] = [];

	const accounts = new Accounts(
		new AccountStore("/unused/appearance-mode-accounts.json"),
		{
			async read() {
				return null;
			},
			async write() {
				throw new Error("Unexpected credential write");
			},
			async delete() {
				throw new Error("Unexpected credential deletion");
			},
		}
	);

	const catalog = spyOn(accounts, "load").mockReturnValue([]);
	const menu = spyOn(NativeFileMenu, "showItems").mockReturnValue(undefined);

	restores.add(() => catalog.mockRestore());
	restores.add(() => menu.mockRestore());
	const snapshot = repositorySnapshot([
		changedFile("example.ts"),
		changedFile("other.ts"),
	]);

	const context = Array.from(
		{ length: 160 },
		(_, index) => ` const line${index} = ${index};`
	).join("\n");

	const patch = `diff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n@@ -1,161 +1,161 @@\n-const version = 1;\n+const version = 2;\n${context}\n`;

	root.render(
		<App
			accounts={accounts}
			externalEditors={
				new ExternalEditors(
					"/unused/appearance-mode-editors.json",
					async () => "",
					[]
				)
			}
			initialSession={{
				version: 1,
				activeId: "workspace-1",
				appearance,
				repositoryColors: {
					"/test/project/.git": "#ff0000",
					"/test/other/.git": "#46b8b3",
				},
				repositoryPatterns: { "/test/project/.git": "camping" },
				tabs: [
					{
						id: "workspace-1",
						path: "/test/project",
						draft: "Keep my commit draft",
					},
					{
						id: "workspace-2",
						path: "/test/other",
						draft: "Other commit draft",
					},
				],
			}}
			readRepository={async (path) => {
				reads.push(path);

				return {
					ok: true,
					value: {
						...snapshot,
						repository: {
							...snapshot.repository,
							root: path,
							commonDirectory: `${path}/.git`,
						},
					},
				};
			}}
			readDiff={async (path, change) => {
				diffReads.push(`${path}/${change.path}`);

				return { ok: true, value: [diffSection("working", patch)] };
			}}
			readHistory={emptyHistory}
			readLastCommit={async () => ({
				ok: true,
				value: { commit: commitInfo(), undoUnavailableReason: null },
			})}
			readGitSettings={async () => {
				throw new Error("Appearance must not read Git settings");
			}}
			writeGitSettings={async () => {
				throw new Error("Appearance must not write Git settings");
			}}
			saveSession={(document) => saved.push(document)}
		/>
	);
	await settle(root, 40);

	return { root, saved, reads, diffReads, menu };
}

it.each(["light", "dark"] as const)(
	"edits the mounted %s workspace without persisting drafts and saves only on Done",
	async (appearance) => {
		const { root, saved, reads, diffReads } = await fixture(appearance);

		await click(root, "entry-example.ts");
		const viewport = node(root, "diff-viewport-content").id;

		root.renderer.scrollTo(viewport, 0, -320);
		root.renderer.flush();
		const scroll = root.renderer.getScrollOffset(viewport);
		const repositoryReads = reads.length;

		const initialDiffReads = diffReads.filter((path) =>
			path.endsWith("/example.ts")
		).length;

		root.renderer.simulateKeystrokes("cmd-,");
		await settle(root);
		await click(root, "settings-repository-appearance");
		expect(
			root.renderer.findByTestId("repository-color-preview")
		).toBeUndefined();
		expect(
			root.renderer.findByTestId("repository-color-wheel")
		).toBeUndefined();
		await click(root, "repository-appearance-customize");
		expect(root.renderer.findByTestId("settings-view")).toBeUndefined();
		expect(node(root, "repository-appearance-editor")).toBeDefined();
		expect(node(root, "app-shell").style.visibility).not.toBe("hidden");
		expect(node(root, "diff-viewport-content").id).toBe(viewport);
		expect(root.renderer.getScrollOffset(viewport)).toEqual(scroll);
		expect(node(root, "commit-message").customProps?.value).toBe(
			"Keep my commit draft"
		);
		expect(reads).toHaveLength(repositoryReads);
		expect(
			diffReads.filter((path) => path.endsWith("/example.ts"))
		).toHaveLength(initialDiffReads);
		const wheel = bounds(root, "repository-color-wheel");

		root.renderer.nativeSimulateMouseDown(
			wheel.x + wheel.width / 2,
			wheel.y + wheel.height / 2
		);
		await settle(root);
		expect(node(root, "app-shell").style.backgroundColor).toBe(
			RepositoryTheme.create(appThemes[appearance], "#ffffff").colors.chrome
		);
		root.renderer.nativeSimulateMouseMove(
			wheel.x - 24,
			wheel.y + wheel.height / 2,
			0
		);
		root.renderer.nativeSimulateMouseUp(
			wheel.x - 24,
			wheel.y + wheel.height / 2
		);
		await settle(root, 230);
		expect(node(root, "app-shell").style.backgroundColor).toBe(
			RepositoryTheme.create(appThemes[appearance], "#00ffff").colors.chrome
		);
		await click(root, "repository-appearance-tab-pattern");
		await click(root, "repository-pattern-cosmic");
		expect(node(root, "repository-pattern-tile-1").customProps?.source).toBe(
			repositoryPatternSources.cosmic
		);

		for (const document of saved) {
			expect(document.repositoryColors?.["/test/project/.git"]).toBe("#ff0000");
			expect(document.repositoryPatterns?.["/test/project/.git"]).toBe(
				"camping"
			);
		}

		// The uncovered file list remains usable while the appearance panel is open.
		await click(root, "include-other.ts");
		expect(node(root, "repository-appearance-editor")).toBeDefined();
		expect(node(root, "include-other.ts").customProps?.["aria-checked"]).toBe(
			false
		);
		await click(root, "repository-appearance-tab-color");
		const screenshot = process.env.GPUIX_APPEARANCE_MODE_SCREENSHOT;

		if (screenshot)
			root.renderer.captureScreenshot(`${screenshot}-${appearance}.png`);

		await click(root, "repository-appearance-done");
		await settle(root, 250);
		expect(
			root.renderer.findByTestId("repository-appearance-editor")
		).toBeUndefined();
		expect(saved.at(-1)?.repositoryColors).toEqual({
			"/test/project/.git": "#00ffff",
			"/test/other/.git": "#46b8b3",
		});
		expect(saved.at(-1)?.repositoryPatterns).toEqual({
			"/test/project/.git": "cosmic",
		});
		expect(node(root, "diff-viewport-content").id).toBe(viewport);
		expect(root.renderer.getScrollOffset(viewport)).toEqual(scroll);
		expect(node(root, "commit-message").customProps?.value).toBe(
			"Keep my commit draft"
		);
	}
);

it.each(["light", "dark"] as const)(
	"keeps the %s workspace and editor painted while dragging color and brightness",
	async (appearance) => {
		const { root, menu } = await fixture(appearance);
		const directory = await mkdtemp(join(tmpdir(), "1git-color-drag-"));

		try {
			menu.mockReturnValueOnce({ kind: "appearance", section: "color" });
			await click(root, "rail-settings");
			const editor = bounds(root, "repository-appearance-editor");
			const entry = bounds(root, "entry-example.ts");

			for (const id of [
				"repository-color-wheel",
				"repository-color-brightness-slider",
			]) {
				const box = bounds(root, id);
				const x = box.x + box.width / 2;
				const y = box.y + box.height / 2;

				root.renderer.nativeSimulateMouseDown(x, y);
				await settle(root);
				const endX = box.x + box.width * 0.7;

				root.renderer.nativeSimulateMouseMove(endX, y, 0);
				await settle(root);
				expect(node(root, "repository-color-drag")).toBeDefined();
				const held = join(directory, "held.png");
				const released = join(directory, "released.png");

				root.renderer.captureScreenshot(held);
				const screenshot = process.env.GPUIX_APPEARANCE_MODE_SCREENSHOT;

				if (screenshot)
					root.renderer.captureScreenshot(
						`${screenshot}-drag-${id}-${appearance}.png`
					);

				root.renderer.nativeSimulateMouseUp(endX, y);
				await settle(root);
				expect(
					root.renderer.findByTestId("repository-color-drag")
				).toBeUndefined();
				root.renderer.captureScreenshot(released);
				const metadata = await sharp(released).metadata();
				const scale = (metadata.width ?? 1180) / 1180;

				// The capture layer must leave both repository content and the editor visible.
				for (const region of [
					{ x: editor.x + 16, y: editor.y + 16, width: 230, height: 32 },
					entry,
				]) {
					const extract = {
						left: Math.round(region.x * scale),
						top: Math.round(region.y * scale),
						width: Math.floor(region.width * scale),
						height: Math.floor(region.height * scale),
					};

					const during = await sharp(held).extract(extract).raw().toBuffer();
					const after = await sharp(released).extract(extract).raw().toBuffer();
					let maximumDifference = 0;

					for (let index = 0; index < after.length; index++)
						maximumDifference = Math.max(
							maximumDifference,
							Math.abs((during[index] ?? 0) - (after[index] ?? 0))
						);

					expect(maximumDifference).toBeLessThanOrEqual(1);
				}
			}
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}
);

it("cancels from the workspace with Escape and returns from the editor to the same Settings page", async () => {
	const { root, saved, menu } = await fixture();

	menu.mockReturnValueOnce({ kind: "appearance", section: "color" });
	await click(root, "rail-settings");
	await typeHex(root, "#00ff00");
	await click(root, "repository-appearance-tab-pattern");
	await click(root, "repository-pattern-forest");
	root.renderer.nativeSimulateKeyDown(
		node(root, "commit-message").id,
		"escape"
	);
	await settle(root, 250);
	expect(
		root.renderer.findByTestId("repository-appearance-editor")
	).toBeUndefined();
	expect(node(root, "app-shell").style.backgroundColor).toBe(
		RepositoryTheme.create(appThemes.dark, "#ff0000").colors.chrome
	);
	expect(node(root, "repository-pattern-tile-1").customProps?.source).toBe(
		repositoryPatternSources.camping
	);
	expect(saved.at(-1)?.repositoryColors?.["/test/project/.git"]).toBe(
		"#ff0000"
	);

	menu.mockReturnValueOnce({ kind: "appearance", section: "pattern" });
	await click(root, "rail-settings");
	expect(node(root, "repository-pattern-camping")).toBeDefined();
	expect(root.renderer.findByTestId("repository-color-wheel")).toBeUndefined();
	await click(root, "repository-pattern-cosmic");
	await click(root, "repository-appearance-back");
	expect(
		root.renderer.findByTestId("repository-appearance-editor")
	).toBeUndefined();
	expect(node(root, "settings-view")).toBeDefined();
	expect(node(root, "repository-appearance-customize")).toBeDefined();
	await click(root, "repository-appearance-customize");
	await click(root, "repository-appearance-tab-pattern");
	expect(
		node(root, "repository-pattern-camping").customProps?.["aria-description"]
	).toBe("Selected");
});

it("validates pending hex input on Done and saves a valid value without requiring Apply", async () => {
	const { root, saved, menu } = await fixture();

	menu.mockReturnValueOnce({ kind: "appearance", section: "color" });
	await click(root, "rail-settings");
	await typeHex(root, "oops", false);
	await click(root, "repository-appearance-done");
	expect(node(root, "repository-appearance-editor")).toBeDefined();
	expect(root.renderer.getAllText().join("\n")).toContain(
		"Enter a six-digit hex color"
	);
	expect(saved.at(-1)?.repositoryColors?.["/test/project/.git"]).toBe(
		"#ff0000"
	);
	await typeHex(root, "#123456", false);
	await click(root, "repository-appearance-done");
	await settle(root, 250);
	expect(
		root.renderer.findByTestId("repository-appearance-editor")
	).toBeUndefined();
	expect(saved.at(-1)?.repositoryColors?.["/test/project/.git"]).toBe(
		"#123456"
	);
});

it("uses the last repository from Home and discards a draft when switching to another repository", async () => {
	const { root, saved } = await fixture();

	await click(root, "workspace-2");
	await settle(root, 230);
	await click(root, "workspace-home");
	root.renderer.simulateKeystrokes("cmd-,");
	await settle(root);
	await click(root, "settings-repository-appearance");
	await click(root, "repository-appearance-customize");
	expect(node(root, "commit-message").customProps?.value).toBe(
		"Other commit draft"
	);
	expect(node(root, "repository-color-custom").customProps?.value).toBe(
		"#46b8b3"
	);
	await click(root, "repository-color-blue");
	await click(root, "workspace-1");
	await settle(root, 250);
	expect(
		root.renderer.findByTestId("repository-appearance-editor")
	).toBeUndefined();
	expect(saved.at(-1)?.repositoryColors).toEqual({
		"/test/project/.git": "#ff0000",
		"/test/other/.git": "#46b8b3",
	});
});

it("restores focus to the repository gear if the original file control is removed while customizing", async () => {
	const { root } = await fixture();

	await click(root, "entry-example.ts");
	expect(root.renderer.getFocusedElementId()).toBe(
		node(root, "entry-example.ts").id
	);
	root.renderer.simulateKeystrokes("cmd-,");
	await settle(root);
	await click(root, "settings-repository-appearance");
	await click(root, "repository-appearance-customize");
	await click(root, "view-history");
	await settle(root, 40);
	expect(root.renderer.findByTestId("entry-example.ts")).toBeUndefined();
	expect(node(root, "repository-appearance-editor")).toBeDefined();
	await click(root, "repository-appearance-done");
	expect(root.renderer.getFocusedElementId()).toBe(
		node(root, "rail-settings").id
	);
});
