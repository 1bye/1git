/**
 * Covers: real workspace customization, live color and pattern controls, visible keyboard/drag behavior, save/cancel, restoration and Settings return.
 * Real: App, appearance editor, native rendering/input, palette and session models.
 * Doubles: repository/diff/account/editor reads, Shuffle entropy, native menu selections and session writes; no Git writes or real preferences.
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
import { RepositoryPatternArtwork } from "../../src/feature/repository-appearance/pattern-artwork";
import {
	RepositoryPatterns,
	defaultPatternAdjustments,
} from "../../src/feature/repository-appearance/repository-patterns";
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

async function fixture(
	appearance: "light" | "dark" = "dark",
	patterns: WorkspaceSessionDocument["repositoryPatterns"] = {
		"/test/project/.git": "camping",
	},
	size = { width: 1180, height: 820 }
) {
	const root = createTestRoot({
		...size,
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
				repositoryPatterns: patterns,
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
		expect(root.renderer.findByTestId("repository-color-wheel")).toBeDefined();
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
			RepositoryPatternArtwork.create(
				"cosmic",
				RepositoryPatterns.defaultSeed("/test/project/.git")
			).source
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
			true
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
			"/test/project/.git": {
				id: "cosmic",
				seed: RepositoryPatterns.defaultSeed("/test/project/.git"),
			},
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
		RepositoryPatternArtwork.create(
			"camping",
			RepositoryPatterns.defaultSeed("/test/project/.git")
		).source
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

it.each(["light", "dark"] as const)(
	"previews Shuffle in the %s workspace, keeps its seed through color edits and saves or cancels it",
	async (appearance) => {
		const directory = "/test/project/.git";
		const other = { id: "cosmic", seed: 99 } as const;

		const { root, saved, menu } = await fixture(appearance, {
			[directory]: "camping",
			"/test/other/.git": other,
		});

		const shuffle = spyOn(RepositoryPatterns, "shuffleSeed").mockReturnValue(
			42
		);

		restores.add(() => shuffle.mockRestore());
		menu.mockReturnValueOnce({ kind: "appearance", section: "pattern" });
		await click(root, "rail-settings");
		const original = node(root, "repository-pattern-tile-0").customProps
			?.source;

		await click(root, "repository-pattern-shuffle");
		expect(
			node(root, "repository-pattern-tile-0").customProps?.source
		).not.toBe(original);
		await click(root, "repository-pattern-forest");
		const shuffled = RepositoryPatternArtwork.create("forest", 42);

		expect(node(root, "repository-pattern-tile-0").customProps?.source).toBe(
			shuffled.cornerSource
		);
		expect(
			node(root, "repository-pattern-preview-forest").customProps?.source
		).toBe(shuffled.previewSource);
		await click(root, "repository-appearance-tab-color");
		await click(root, "repository-color-teal");
		expect(node(root, "repository-pattern-tile-0").customProps?.source).toBe(
			shuffled.cornerSource
		);
		await click(root, "repository-appearance-tab-pattern");
		expect(
			node(root, "repository-pattern-preview-forest").customProps?.source
		).toBe(shuffled.previewSource);

		for (const document of saved)
			expect(document.repositoryPatterns?.[directory]).toBe("camping");

		const screenshot = process.env.GPUIX_APPEARANCE_MODE_SCREENSHOT;

		if (screenshot)
			root.renderer.captureScreenshot(
				`${screenshot}-patterns-${appearance}.png`
			);

		await click(root, "repository-appearance-done");
		await settle(root, 250);
		expect(saved.at(-1)?.repositoryPatterns).toEqual({
			[directory]: { id: "forest", seed: 42 },
			"/test/other/.git": other,
		});
		expect(saved.at(-1)?.repositoryColors?.[directory]).toBe("#46b8b3");
		menu.mockReturnValueOnce({ kind: "appearance", section: "pattern" });
		await click(root, "rail-settings");
		expect(
			node(root, "repository-pattern-preview-forest").customProps?.source
		).toBe(shuffled.previewSource);
		shuffle.mockReturnValue(84);
		await click(root, "repository-pattern-shuffle");
		expect(
			node(root, "repository-pattern-tile-0").customProps?.source
		).not.toBe(shuffled.cornerSource);
		root.renderer.simulateKeystrokes("escape");
		await settle(root, 250);
		expect(node(root, "repository-pattern-tile-0").customProps?.source).toBe(
			shuffled.cornerSource
		);
		expect(saved.at(-1)?.repositoryPatterns?.[directory]).toEqual({
			id: "forest",
			seed: 42,
		});
		menu.mockReturnValueOnce({ kind: "appearance", section: "pattern" });
		await click(root, "rail-settings");
		await click(root, "repository-pattern-shuffle");
		await click(root, "repository-appearance-back");
		await click(root, "repository-appearance-customize");
		await click(root, "repository-appearance-tab-pattern");
		expect(
			node(root, "repository-pattern-preview-forest").customProps?.source
		).toBe(shuffled.previewSource);
		await click(root, "repository-pattern-reset");
		const shuffles = shuffle.mock.calls.length;

		await click(root, "repository-pattern-shuffle");
		expect(shuffle).toHaveBeenCalledTimes(shuffles);
		expect(
			root.renderer.findByTestId("repository-pattern-layer")
		).toBeUndefined();
		await click(root, "repository-appearance-done");
		await settle(root, 250);
		expect(saved.at(-1)?.repositoryPatterns).toEqual({
			"/test/other/.git": other,
		});
	}
);

it("restores a saved seed and keeps it when customizing colors and patterns", async () => {
	const directory = "/test/project/.git";

	const adjustments = {
		...defaultPatternAdjustments,
		layout: "hero",
		size: 80,
		strength: 30,
	} as const;

	const { root, saved, menu } = await fixture("dark", {
		[directory]: { id: "forest", seed: 42, adjustments },
	});

	expect(node(root, "repository-pattern-tile-0").customProps?.source).toBe(
		RepositoryPatternArtwork.create("forest", 42, adjustments).cornerSource
	);
	menu.mockReturnValueOnce({ kind: "appearance", section: "color" });
	await click(root, "rail-settings");
	await click(root, "repository-color-violet");
	await settle(root, 250);
	expect(node(root, "repository-pattern-tile-0").customProps?.source).toBe(
		RepositoryPatternArtwork.create("forest", 42, adjustments).cornerSource
	);
	await click(root, "repository-appearance-tab-pattern");
	await click(root, "repository-pattern-cosmic");
	await click(root, "repository-appearance-done");
	await settle(root, 250);
	expect(node(root, "repository-pattern-tile-0").customProps?.source).toBe(
		RepositoryPatternArtwork.create("cosmic", 42, adjustments).cornerSource
	);
	expect(saved.at(-1)?.repositoryPatterns?.[directory]).toEqual({
		id: "cosmic",
		seed: 42,
		adjustments,
	});
	const shuffle = spyOn(RepositoryPatterns, "shuffleSeed").mockReturnValue(84);

	restores.add(() => shuffle.mockRestore());
	menu.mockReturnValueOnce({ kind: "appearance", section: "pattern" });
	await click(root, "rail-settings");
	await click(root, "repository-pattern-shuffle");
	expect(node(root, "repository-pattern-tile-0").customProps?.source).toBe(
		RepositoryPatternArtwork.create("cosmic", 84, adjustments).cornerSource
	);
	await click(root, "repository-appearance-done");
	await settle(root, 250);
	expect(saved.at(-1)?.repositoryPatterns?.[directory]).toEqual({
		id: "cosmic",
		seed: 84,
		adjustments,
	});
});

it.each(["light", "dark"] as const)(
	"previews all pattern controls live in a minimum %s window and saves or resets the full draft",
	async (appearance) => {
		const { root, saved, menu } = await fixture(appearance, undefined, {
			width: 980,
			height: 640,
		});

		const directory = "/test/project/.git";
		const seed = RepositoryPatterns.defaultSeed(directory);

		const original = node(root, "repository-pattern-tile-0").customProps
			?.source;

		const keyboard = async (id: string, key: string) => {
			await settle(root);
			root.renderer.nativeSimulateKeyDown(node(root, id).id, key);
			await settle(root);
		};

		menu.mockReturnValueOnce({ kind: "appearance", section: "pattern" });
		await click(root, "rail-settings");
		const otherPreview = node(root, "repository-pattern-preview-rose")
			.customProps?.source;

		expect(
			node(root, "repository-pattern-adjust").customProps?.["aria-expanded"]
		).toBe(false);
		expect(
			root.renderer.findByTestId("repository-pattern-adjustment-controls")
		).toBeUndefined();
		const disclosure = bounds(root, "repository-pattern-adjust");

		expect(disclosure.width).toBe(304);
		expect(disclosure.height).toBeGreaterThanOrEqual(40);

		await keyboard("repository-pattern-adjust", "enter");
		await settle(root, 10);
		expect(
			node(root, "repository-pattern-adjust").customProps?.["aria-expanded"]
		).toBe(true);
		expect(node(root, "repository-pattern-adjustment-controls")).toBeDefined();
		const visibleControls = bounds(root, "repository-appearance-controls");

		for (const name of ["density", "size", "strength", "variation"]) {
			const slider = bounds(root, `repository-pattern-${name}`);

			expect(slider.y).toBeGreaterThanOrEqual(visibleControls.y);
			expect(slider.y + slider.height).toBeLessThanOrEqual(
				visibleControls.y + visibleControls.height
			);
		}

		await keyboard("repository-pattern-layout-hero", "enter");
		expect(
			node(root, "repository-pattern-tile-0").customProps?.source
		).not.toBe(original);
		await keyboard("repository-pattern-layout-clusters", "enter");
		await keyboard("repository-pattern-density", "home");
		await keyboard("repository-pattern-size", "end");
		await keyboard("repository-pattern-strength", "home");
		expect(node(root, "repository-pattern-tile-0").style.opacity).toBe(0);
		const geometry = node(root, "repository-pattern-tile-0").customProps
			?.source;

		await keyboard("repository-pattern-strength", "shift-right");
		expect(node(root, "repository-pattern-tile-0").customProps?.source).toBe(
			geometry
		);
		await keyboard("repository-pattern-variation", "home");
		expect(
			node(root, "repository-pattern-preview-rose").customProps?.source
		).toBe(otherPreview);
		const adjustments = {
			layout: "clusters",
			density: 0,
			size: 100,
			strength: 10,
			variation: 0,
		} as const;

		expect(node(root, "repository-pattern-tile-0").customProps?.source).toBe(
			RepositoryPatternArtwork.create("camping", seed, adjustments).cornerSource
		);
		expect(node(root, "repository-pattern-tile-0").style.opacity).toBeCloseTo(
			(appearance === "dark" ? 0.24 : 0.18) * 0.2
		);
		const done = bounds(root, "repository-appearance-done");

		expect(done.y + done.height).toBeLessThanOrEqual(640);

		for (const document of saved)
			expect(document.repositoryPatterns?.[directory]).toBe("camping");

		const screenshot = process.env.GPUIX_APPEARANCE_MODE_SCREENSHOT;

		if (screenshot)
			root.renderer.captureScreenshot(
				`${screenshot}-controls-${appearance}.png`
			);

		await click(root, "repository-appearance-done");
		await settle(root, 250);
		expect(saved.at(-1)?.repositoryPatterns?.[directory]).toEqual({
			id: "camping",
			seed,
			adjustments,
		});
		menu.mockReturnValueOnce({ kind: "appearance", section: "pattern" });
		await click(root, "rail-settings");
		await keyboard("repository-pattern-adjust", "enter");
		await settle(root, 10);
		expect(
			node(root, "repository-pattern-density").customProps?.["aria-valuetext"]
		).toBe("0 percent");
		expect(
			node(root, "repository-pattern-size").customProps?.["aria-valuetext"]
		).toBe("100 percent");
		await keyboard("repository-pattern-adjustments-reset", "enter");
		expect(node(root, "repository-pattern-tile-0").customProps?.source).toBe(
			original
		);

		if (screenshot)
			root.renderer.captureScreenshot(
				`${screenshot}-controls-reset-${appearance}.png`
			);

		root.renderer.simulateKeystrokes("escape");
		await settle(root, 250);
		expect(node(root, "repository-pattern-tile-0").customProps?.source).toBe(
			RepositoryPatternArtwork.create("camping", seed, adjustments).cornerSource
		);
		expect(saved.at(-1)?.repositoryPatterns?.[directory]).toEqual({
			id: "camping",
			seed,
			adjustments,
		});
	}
);

it("drags pattern sliders beyond their bounds while keeping the workspace visible and the seed stable", async () => {
	const { root, saved, menu } = await fixture();
	const directory = await mkdtemp(join(tmpdir(), "1git-pattern-controls-"));

	try {
		menu.mockReturnValueOnce({ kind: "appearance", section: "pattern" });
		await click(root, "rail-settings");
		root.renderer.scrollIntoView(node(root, "repository-pattern-adjust").id);
		await settle(root);
		await click(root, "repository-pattern-adjust");
		await settle(root, 20);
		const box = bounds(root, "repository-pattern-density");

		root.renderer.nativeSimulateMouseDown(
			box.x + box.width / 2,
			box.y + box.height / 2
		);
		await settle(root);
		root.renderer.nativeSimulateMouseMove(
			box.x + box.width + 50,
			box.y + box.height / 2,
			0
		);
		await settle(root);
		expect(
			node(root, "repository-pattern-density").customProps?.["aria-valuetext"]
		).toBe("100 percent");
		expect(node(root, "repository-pattern-drag")).toBeDefined();
		const screenshot = join(directory, "held.png");

		root.renderer.captureScreenshot(screenshot);
		const stats = await sharp(screenshot).stats();

		expect(stats.channels.some((channel) => channel.stdev > 10)).toBe(true);
		root.renderer.nativeSimulateMouseUp(
			box.x + box.width + 50,
			box.y + box.height / 2
		);
		await settle(root);
		expect(
			root.renderer.findByTestId("repository-pattern-drag")
		).toBeUndefined();
		const seed = RepositoryPatterns.defaultSeed("/test/project/.git");

		expect(node(root, "repository-pattern-tile-0").customProps?.source).toBe(
			RepositoryPatternArtwork.create("camping", seed, {
				...defaultPatternAdjustments,
				density: 100,
			}).cornerSource
		);

		for (const document of saved)
			expect(document.repositoryPatterns?.["/test/project/.git"]).toBe(
				"camping"
			);

		root.renderer.simulateKeystrokes("escape");
		await settle(root, 250);
		expect(node(root, "repository-pattern-tile-0").customProps?.source).toBe(
			RepositoryPatternArtwork.create("camping", seed).cornerSource
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

it("applies Settings colours without losing the saved pattern or leaving Settings", async () => {
	const { root, saved } = await fixture("dark", {
		"/test/project/.git": {
			id: "cosmic",
			seed: 123,
			adjustments: { ...defaultPatternAdjustments, strength: 70 },
		},
	});

	root.renderer.simulateKeystrokes("cmd-,");
	await settle(root);
	await click(root, "settings-repository-appearance");
	expect(node(root, "repository-appearance-preview")).toBeDefined();
	const previousColor = node(root, "repository-appearance-preview").style
		.backgroundColor;

	await click(root, "repository-color-violet");
	await settle(root, 250);
	expect(
		node(root, "repository-appearance-preview").style.backgroundColor
	).not.toBe(previousColor);
	expect(node(root, "settings-view")).toBeDefined();
	expect(saved.at(-1)?.repositoryColors?.["/test/project/.git"]).toBe(
		"#a478ef"
	);
	expect(saved.at(-1)?.repositoryPatterns?.["/test/project/.git"]).toEqual({
		id: "cosmic",
		seed: 123,
		adjustments: { ...defaultPatternAdjustments, strength: 70 },
	});
	expect(
		node(root, "repository-color-violet").customProps?.["aria-description"]
	).toBe("Selected");
	await click(root, "repository-color-reset");
	await settle(root, 250);
	expect(
		saved.at(-1)?.repositoryColors?.["/test/project/.git"]
	).toBeUndefined();
	expect(
		saved.at(-1)?.repositoryPatterns?.["/test/project/.git"]
	).toMatchObject({ id: "cosmic", seed: 123 });
});

it.each(["light", "dark"] as const)(
	"edits full appearance controls inside minimum-width %s Settings and opens the live editor from Preview",
	async (appearance) => {
		const commonDirectory = "/test/project/.git";

		const { root, saved, reads, diffReads } = await fixture(
			appearance,
			{
				[commonDirectory]: {
					id: "cosmic",
					seed: 123,
					adjustments: { ...defaultPatternAdjustments, strength: 70 },
				},
			},
			{ width: 640, height: 820 }
		);

		root.renderer.simulateKeystrokes("cmd-,");
		await settle(root);
		await click(root, "settings-repository-appearance");
		await settle(root, 250);
		const repositoryReads = reads.length;
		const initialDiffReads = diffReads.length;

		const reveal = async (id: string) => {
			const scroll = node(root, "repository-appearance-scroll").id;

			const viewport = bounds(root, "repository-appearance-scroll");
			const target = bounds(root, id);

			if (
				target.y >= viewport.y &&
				target.y + target.height <= viewport.y + viewport.height
			)
				return;

			const offset = root.renderer.getScrollOffset(scroll)?.[1] ?? 0;

			root.renderer.scrollTo(scroll, 0, offset - (target.y - viewport.y - 8));
			await settle(root);
		};

		const type = async (id: string, value: string, submit = true) => {
			await reveal(id);
			await click(root, id);
			root.renderer.simulateKeystrokes("cmd-a");
			root.renderer.simulateKeystrokes([...value].join(" "));

			if (submit) root.renderer.simulateKeystrokes("enter");

			await settle(root, 250);
		};

		const color = () => saved.at(-1)?.repositoryColors?.[commonDirectory];

		const previewColor = () =>
			node(root, "repository-appearance-preview").style.backgroundColor;

		const savedPattern = () =>
			saved.at(-1)?.repositoryPatterns?.[commonDirectory];

		await type("repository-color-custom", "invalid");
		expect(
			node(root, "repository-color-custom").customProps?.["aria-invalid"]
		).toBe(true);
		await click(root, "repository-appearance-customize");
		expect(node(root, "settings-view")).toBeDefined();
		const originalColor = color();

		await type("repository-color-custom", "#2488cc", false);
		expect(previewColor()).toBe(
			RepositoryTheme.create(appThemes[appearance], "#2488cc").colors.chrome
		);
		expect(color()).toBe(originalColor);
		root.renderer.simulateKeystrokes("enter");
		await settle(root, 250);
		expect(color()).toBe("#2488cc");
		expect(savedPattern()).toMatchObject({
			id: "cosmic",
			seed: 123,
			adjustments: { strength: 70 },
		});

		await type("repository-color-hue", "180");
		expect(node(root, "repository-color-hue").customProps?.value).toBe("180");
		expect(color()).not.toBe("#2488cc");
		const committedColor = color();
		const committedPreview = previewColor();
		const saveCount = saved.length;

		await reveal("repository-color-wheel");
		const wheel = bounds(root, "repository-color-wheel");

		root.renderer.nativeSimulateMouseDown(
			wheel.x + wheel.width * 0.75,
			wheel.y + wheel.height * 0.25
		);
		await settle(root, 250);
		expect(previewColor()).not.toBe(committedPreview);
		expect(saved).toHaveLength(saveCount);
		root.renderer.nativeSimulateKeyDown(
			node(root, "repository-color-wheel").id,
			"escape"
		);
		root.renderer.nativeSimulateMouseUp(
			wheel.x + wheel.width / 2,
			wheel.y + wheel.height / 2
		);
		await settle(root, 250);
		expect(previewColor()).toBe(committedPreview);
		expect(color()).toBe(committedColor);
		expect(node(root, "settings-view")).toBeDefined();

		await reveal("repository-appearance-tab-pattern");
		await click(root, "repository-appearance-tab-pattern");
		await reveal("repository-pattern-forest");
		await click(root, "repository-pattern-forest");
		await settle(root, 250);
		expect(savedPattern()).toMatchObject({
			id: "forest",
			seed: 123,
			adjustments: { strength: 70 },
		});
		expect(color()).toBe(committedColor);
		const shuffle = spyOn(RepositoryPatterns, "shuffleSeed").mockReturnValue(
			987
		);

		restores.add(() => shuffle.mockRestore());
		await reveal("repository-pattern-shuffle");
		await click(root, "repository-pattern-shuffle");
		await reveal("repository-pattern-adjust");
		await click(root, "repository-pattern-adjust");
		await settle(root, 20);
		await reveal("repository-pattern-density");
		await click(root, "repository-pattern-density");
		root.renderer.simulateKeystrokes("end");
		await settle(root, 250);
		expect(savedPattern()).toMatchObject({
			id: "forest",
			seed: 987,
			adjustments: { density: 100, strength: 70 },
		});
		const slider = bounds(root, "repository-pattern-density");
		const pane = bounds(root, "repository-appearance-scroll");

		expect(slider.x + slider.width).toBeLessThanOrEqual(pane.x + pane.width);
		await reveal("repository-pattern-layout-clusters");
		await click(root, "repository-pattern-layout-clusters");
		await settle(root, 250);
		expect(savedPattern()).toMatchObject({
			id: "forest",
			seed: 987,
			adjustments: { layout: "clusters", density: 100 },
		});
		expect(reads).toHaveLength(repositoryReads);
		expect(diffReads).toHaveLength(initialDiffReads);

		const screenshots = process.env.GPUIX_SETTINGS_LAYOUT_SCREENSHOTS;

		if (screenshots)
			root.renderer.captureScreenshot(
				join(screenshots, `${appearance}-640-repository-pattern-controls.png`)
			);

		const action = bounds(root, "repository-appearance-customize");
		const preview = bounds(root, "repository-appearance-preview");

		expect(action.x).toBeGreaterThanOrEqual(preview.x);
		expect(action.y).toBeGreaterThanOrEqual(preview.y + preview.height);
		await reveal("repository-appearance-tab-color");
		await click(root, "repository-appearance-tab-color");
		await type("repository-color-custom", "#cc8844", false);
		expect(color()).toBe(committedColor);
		await click(root, "repository-appearance-customize");
		expect(root.renderer.findByTestId("settings-view")).toBeUndefined();
		expect(node(root, "repository-appearance-editor")).toBeDefined();
		expect(node(root, "repository-color-custom").customProps?.value).toBe(
			"#cc8844"
		);
		await click(root, "repository-appearance-tab-pattern");
		expect(
			node(root, "repository-pattern-forest").customProps?.["aria-description"]
		).toBe("Selected");
		root.renderer.simulateKeystrokes("escape");
		await settle(root, 250);
		expect(color()).toBe(committedColor);
		expect(savedPattern()).toMatchObject({
			id: "forest",
			seed: 987,
			adjustments: { layout: "clusters", density: 100 },
		});
	},
	60000
);
