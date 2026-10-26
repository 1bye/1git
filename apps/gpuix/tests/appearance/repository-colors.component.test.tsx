/**
 * Covers: live appearance customization, custom input/reset, worktree inheritance, matching active-tab surfaces, neutral Home/Settings and retained editing/scroll.
 * Real: App, palette/session models and GPUIX rendering/input.
 * Doubles: repositories, diffs, account catalog, editor discovery, OS menu choices and session saves; no real preferences, Git writes or accounts.
 * Requires: patched native addon and macOS graphics access.
 */
import { afterEach, expect, it, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import { ExternalEditors } from "../../src/feature/editor-settings/external-editors";
import type { WorkspaceSessionDocument } from "../../src/feature/workspace-tabs/lib/workspace-session";
import { RepositoryTheme } from "../../src/styles/repository-theme";
import { appThemes } from "../../src/styles/theme";
import { darkDiffTheme } from "../../src/styles/dark-diff-theme";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";
import { commitInfo } from "../_shared/history-page";
import { diffSection } from "../_shared/diff-patch";
import { windowOptions } from "../../src/window-options";
import { useState } from "react";
import { RepositoryAppearanceEditor } from "../../src/feature/repository-appearance/repository-appearance-editor";
import {
	repositoryPatternPresets,
	RepositoryPatterns,
	type RepositoryPattern,
} from "../../src/feature/repository-appearance/repository-patterns";
import { AppThemeContext } from "../../src/styles/theme";
import { NativeFileMenu } from "../../src/feature/repository-workspace/lib/native-file-menu";

const roots = new Set<TestRoot>();

afterEach(() => {
	for (const root of roots) root.unmount();

	roots.clear();
});

function node(root: TestRoot, id: string) {
	const result = root.renderer.findByTestId(id);

	if (!result) throw new Error(`Missing ${id}`);

	return result;
}

async function settle(root: TestRoot) {
	for (let attempt = 0; attempt < 5; attempt++) {
		await Bun.sleep(0);
		root.renderer.clockFastForward(250);
		root.renderer.advanceTime(1);
		root.renderer.flush();
	}
}

async function click(root: TestRoot, id: string) {
	const bounds = root.renderer.getElementBounds(node(root, id).id);

	if (!bounds) throw new Error(`Missing bounds for ${id}`);

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	await settle(root);
}

function ColorSettingsProbe({
	changed,
}: {
	changed: (color: string | undefined) => void;
}) {
	const [color, setColor] = useState<string>();
	const [pattern, setPattern] = useState<RepositoryPattern>();
	const [section, setSection] = useState<"color" | "pattern">("color");

	return (
		<AppThemeContext value={{ ...appThemes.dark, commitTypeBadges: true }}>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					width: "100%",
					height: "100%",
				}}
			>
				<RepositoryAppearanceEditor
					name="Test repository"
					section={section}
					onSectionChange={setSection}
					onPreview={() => {}}
					onDone={() => {}}
					onCancel={() => {}}
					onBack={() => {}}
					pattern={pattern}
					onPatternChange={setPattern}
					color={color}
					onChange={(next) => {
						setColor(next);
						changed(next);
					}}
				/>
			</div>
		</AppThemeContext>
	);
}

it("selects every pattern by keyboard and resets without changing the color", async () => {
	const root = createTestRoot({ width: 760, height: 640 });

	roots.add(root);
	const changes: (string | undefined)[] = [];

	root.render(<ColorSettingsProbe changed={(color) => changes.push(color)} />);
	await settle(root);

	root.renderer.nativeSimulateKeyDown(
		node(root, "repository-appearance-tab-pattern").id,
		"enter"
	);
	await settle(root);

	for (const preset of repositoryPatternPresets) {
		root.renderer.nativeSimulateKeyDown(
			node(root, `repository-pattern-${preset.id}`).id,
			"enter"
		);
		await settle(root);

		for (const candidate of repositoryPatternPresets)
			expect(
				node(root, `repository-pattern-${candidate.id}`).customProps?.[
					"aria-description"
				]
			).toBe(candidate.id === preset.id ? "Selected" : undefined);
	}

	root.renderer.nativeSimulateKeyDown(
		node(root, "repository-pattern-reset").id,
		"enter"
	);
	await settle(root);

	for (const preset of repositoryPatternPresets)
		expect(
			node(root, `repository-pattern-${preset.id}`).customProps?.[
				"aria-description"
			]
		).toBeUndefined();

	expect(changes).toEqual([]);
});

it("supports keyboard swatches, validates custom hex and resets the color draft", async () => {
	const root = createTestRoot({ width: 760, height: 620 });

	roots.add(root);
	root.renderer.clockPause();
	const changes: (string | undefined)[] = [];

	root.render(<ColorSettingsProbe changed={(color) => changes.push(color)} />);
	await settle(root);
	root.renderer.nativeSimulateKeyDown(
		node(root, "repository-color-teal").id,
		"enter"
	);
	await settle(root);
	expect(changes).toEqual(["#46b8b3"]);

	root.renderer.scrollTo(
		node(root, "repository-appearance-controls").id,
		0,
		-200
	);
	root.renderer.flush();

	for (const [input, valid] of [
		["bad", false],
		["#123456", true],
	] as const) {
		await click(root, "repository-color-custom");
		root.renderer.simulateKeystrokes("cmd-a");
		root.renderer.simulateKeystrokes([...input].join(" "));
		await settle(root);
		expect(changes).toEqual(["#46b8b3"]);
		await click(root, "repository-color-apply");

		if (!valid) {
			expect(root.renderer.getAllText().join("\n")).toContain(
				"Enter a six-digit hex color"
			);
			expect(changes).toEqual(["#46b8b3"]);
		}
	}

	expect(changes).toEqual(["#46b8b3", "#123456"]);
	const reset = node(root, "repository-color-reset").id;

	root.renderer.nativeSimulateKeyDown(reset, "space");
	root.renderer.nativeSimulateKeyUp(reset, "space");
	await settle(root);
	expect(changes).toEqual(["#46b8b3", "#123456", undefined]);
});

it.each(["light", "dark"] as const)(
	"matches the active tab to its repo and worktree without losing edits (%s)",
	async (appearance) => {
		const root = createTestRoot({
			width: 1150,
			height: 760,
			onKeyDown: windowOptions.onKeyDown,
		});

		roots.add(root);
		root.renderer.clockPause();
		const saved: WorkspaceSessionDocument[] = [];
		const reads: string[] = [];

		const accounts = new Accounts(
			new AccountStore("/unused/repo-colors-accounts.json"),
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

		const snapshot = repositorySnapshot([
			changedFile("example.ts"),
			changedFile("other.ts"),
		]);

		const context = Array.from(
			{ length: 120 },
			(_, index) => ` const line${index} = ${index};`
		).join("\n");

		const patch = `diff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n@@ -1,121 +1,121 @@\n-const version = 1;\n+const version = 2;\n${context}\n`;

		try {
			root.render(
				<App
					accounts={accounts}
					externalEditors={
						new ExternalEditors(
							"/unused/repo-colors-editors.json",
							async () => "",
							[]
						)
					}
					initialSession={{
						version: 1,
						activeId: "workspace-1",
						appearance,
						repositoryColors: { "/test/other/.git": "#46b8b3" },
						tabs: [
							{
								id: "workspace-1",
								path: "/test/project",
								draft: "Keep main draft",
							},
							{ id: "workspace-2", path: "/test/other", draft: "Other draft" },
							{
								id: "workspace-3",
								path: "/test/linked",
								draft: "Linked draft",
							},
						],
					}}
					readRepository={async (path) => ({
						ok: true,
						value: {
							...snapshot,
							repository: {
								...snapshot.repository,
								root: path,
								commonDirectory:
									path === "/test/other"
										? "/test/other/.git"
										: "/test/project/.git",
							},
						},
					})}
					readDiff={async (_root, change) => {
						reads.push(change.path);

						return { ok: true, value: [diffSection("working", patch)] };
					}}
					readLastCommit={async () => ({
						ok: true,
						value: { commit: commitInfo(), undoUnavailableReason: null },
					})}
					readGitSettings={async () => {
						throw new Error("Appearance must not read Git configuration");
					}}
					writeGitSettings={async () => {
						throw new Error("Appearance must not write Git configuration");
					}}
					saveSession={(document) => saved.push(document)}
				/>
			);
			await settle(root);
			expect(node(root, "app-shell").style.backgroundColor).toBe("transparent");
			await click(root, "entry-example.ts");
			await click(root, "include-example.ts");
			const viewport = node(root, "diff-viewport-content").id;

			root.renderer.scrollTo(viewport, 0, -420);
			root.renderer.flush();

			const scroll = root.renderer.getScrollOffset(viewport);

			const previousReads = reads.filter(
				(path) => path === "example.ts"
			).length;

			const tabSource = node(root, "surface-workspace-1").customProps?.source;

			menu.mockReturnValueOnce({ kind: "appearance", section: "color" });
			await click(root, "rail-settings");
			await click(root, "repository-color-violet");
			await click(root, "repository-appearance-tab-pattern");
			await click(root, "repository-pattern-rose");
			await click(root, "repository-appearance-done");
			expect(node(root, "repository-pattern-layer").style.pointerEvents).toBe(
				"none"
			);
			expect(root.renderer.findByTestId("settings-view")).toBeUndefined();
			const screenshot = process.env.GPUIX_REPO_COLOR_SCREENSHOT;

			expect(root.renderer.getFocusedElementId()).toBe(
				node(root, "rail-settings").id
			);
			menu.mockReturnValueOnce({ kind: "appearance", section: "color" });
			await click(root, "rail-settings");
			expect(root.renderer.findByTestId("settings-view")).toBeUndefined();
			expect(node(root, "repository-appearance-editor")).toBeDefined();
			expect(
				node(root, "repository-color-violet").customProps?.["aria-description"]
			).toBe("Selected");
			expect(node(root, "repository-color-custom").customProps?.value).toBe(
				"#a478ef"
			);
			await click(root, "repository-appearance-tab-pattern");
			root.renderer.nativeSimulateKeyDown(
				node(root, "repository-pattern-rose").id,
				"enter"
			);
			await settle(root);
			expect(
				node(root, "repository-pattern-rose").customProps?.["aria-description"]
			).toBe("Selected");
			root.renderer.nativeSimulateKeyDown(
				node(root, "repository-pattern-cosmic").id,
				"enter"
			);
			await settle(root);
			expect(
				node(root, "repository-pattern-cosmic").customProps?.[
					"aria-description"
				]
			).toBe("Selected");
			await click(root, "repository-appearance-tab-color");
			expect(
				node(root, "repository-color-violet").customProps?.["aria-description"]
			).toBe("Selected");

			if (screenshot)
				root.renderer.captureScreenshot(
					`${screenshot}-${appearance}-editor.png`
				);

			await click(root, "repository-appearance-done");
			await Bun.sleep(230);
			root.renderer.flush();
			expect(saved.at(-1)?.repositoryColors).toEqual({
				"/test/project/.git": "#a478ef",
				"/test/other/.git": "#46b8b3",
			});
			expect(saved.at(-1)?.repositoryPatterns).toEqual({
				"/test/project/.git": {
					id: "cosmic",
					seed: RepositoryPatterns.defaultSeed("/test/project/.git"),
				},
			});
			const patternSource = node(root, "repository-pattern-tile-0").customProps
				?.source;

			await click(root, "view-changes");
			const themed = RepositoryTheme.create(appThemes[appearance], "#a478ef");

			expect(node(root, "app-shell").style.backgroundColor).toBe(
				themed.colors.chrome
			);
			expect(node(root, "commit-submit").style.backgroundColor).toBe(
				themed.tokens.colors.accent
			);
			expect(node(root, "commit-message").customProps?.value).toBe(
				"Keep main draft"
			);
			expect(node(root, "surface-workspace-1").customProps?.source).toContain(
				`fill="${themed.colors.editorSurface}"`
			);
			expect(node(root, "workspace-home-icon").style.color).toBe(
				appThemes[appearance].colors.editorMuted
			);
			expect(node(root, "repository-chrome-grain").style.pointerEvents).toBe(
				"none"
			);
			expect(node(root, "diff-viewport-content").id).toBe(viewport);
			expect(root.renderer.getScrollOffset(viewport)).toEqual(scroll);
			expect(node(root, "include-other.ts").customProps?.["aria-checked"]).toBe(
				false
			);
			expect(reads.filter((path) => path === "example.ts")).toHaveLength(
				previousReads
			);

			if (appearance === "dark")
				expect(
					node(root, "diff-viewport-content").customProps?.theme
				).toMatchObject({
					diffAddBg: darkDiffTheme.diffAddBg,
					diffDelBg: darkDiffTheme.diffDelBg,
					syntax: darkDiffTheme.syntax,
					accent: themed.tokens.colors.accent,
				});

			if (screenshot)
				root.renderer.captureScreenshot(
					`${screenshot}-${appearance}-workspace.png`
				);

			const diffBounds = root.renderer.getElementBounds(viewport);

			if (!diffBounds) throw new Error("Missing colored diff bounds");

			root.renderer.resetDebugFrameOverlayStats();
			const frames: number[] = [];

			for (let tick = 0; tick < 40; tick++) {
				const start = performance.now();

				root.renderer.dispatchScrollWheel(
					diffBounds.x + 100,
					diffBounds.y + 50,
					0,
					-8
				);
				root.renderer.flush();
				frames.push(performance.now() - start);
			}

			const p90 = frames.toSorted((left, right) => left - right)[36] ?? 0;
			const draw = root.renderer.getDebugFrameOverlayStats();

			process.stdout.write(
				`Colored ${appearance} workspace: wheel p90=${p90.toFixed(2)}ms draw p90=${draw.p90Ms?.toFixed(2)}ms\n`
			);
			expect(p90).toBeLessThan(16.7);
			expect(draw.p90Ms).toBeLessThan(12);

			await click(root, "workspace-2");
			// Palette blending uses real time, independently of the native motion clock.
			await Bun.sleep(230);
			await settle(root);
			expect(node(root, "surface-workspace-2").customProps?.source).toContain(
				`fill="${RepositoryTheme.create(appThemes[appearance], "#46b8b3").colors.editorSurface}"`
			);
			expect(
				root.renderer.findByTestId("repository-pattern-layer")
			).toBeUndefined();
			expect(node(root, "app-shell").style.backgroundColor).toBe(
				RepositoryTheme.create(appThemes[appearance], "#46b8b3").colors.chrome
			);
			expect(node(root, "commit-message").customProps?.value).toBe(
				"Other draft"
			);
			await click(root, "workspace-3");
			await Bun.sleep(230);
			await settle(root);
			expect(node(root, "surface-workspace-3").customProps?.source).toContain(
				`fill="${themed.colors.editorSurface}"`
			);
			expect(node(root, "repository-pattern-layer")).toBeDefined();
			expect(node(root, "repository-pattern-tile-0").customProps?.source).toBe(
				patternSource
			);
			expect(node(root, "app-shell").style.backgroundColor).toBe(
				themed.colors.chrome
			);
			expect(node(root, "commit-message").customProps?.value).toBe(
				"Linked draft"
			);
			await click(root, "workspace-home");
			await Bun.sleep(230);
			await settle(root);
			expect(
				root.renderer.findByTestId("repository-pattern-layer")
			).toBeUndefined();
			expect(node(root, "app-shell").style.backgroundColor).toBe("transparent");
			expect(
				root.renderer.findByTestId("repository-chrome-grain")
			).toBeDefined();
			await click(root, "workspace-1");
			await click(root, "rail-settings");
			expect(root.renderer.findByTestId("settings-view")).toBeUndefined();
			expect(
				node(root, "entry-example.ts").customProps?.["aria-selected"]
			).toBe(true);
			menu.mockReturnValueOnce({ kind: "appearance", section: "color" });
			root.renderer.nativeSimulateKeyDown(
				node(root, "rail-settings").id,
				"space"
			);
			root.renderer.nativeSimulateKeyUp(
				node(root, "rail-settings").id,
				"space"
			);
			await settle(root);
			await click(root, "repository-color-reset");
			await click(root, "repository-appearance-done");
			await Bun.sleep(230);
			await settle(root);
			expect(node(root, "app-shell").style.backgroundColor).toBe("transparent");
			expect(node(root, "commit-message").customProps?.value).toBe(
				"Keep main draft"
			);
			expect(node(root, "surface-workspace-1").customProps?.source).toBe(
				tabSource
			);
			expect(node(root, "repository-chrome-grain").style.pointerEvents).toBe(
				"none"
			);
			menu.mockReturnValueOnce({ kind: "appearance", section: "color" });
			await click(root, "rail-settings");
			await click(root, "repository-appearance-tab-pattern");
			await click(root, "repository-pattern-rose");
			expect(node(root, "app-shell").style.backgroundColor).toBe("transparent");
			await click(root, "repository-pattern-reset");
			await click(root, "repository-appearance-done");
			expect(
				root.renderer.findByTestId("repository-pattern-layer")
			).toBeUndefined();
			root.renderer.simulateKeystrokes("cmd-,");
			await settle(root);
			expect(node(root, "settings-view")).toBeDefined();
			root.renderer.simulateKeystrokes("escape");
			await settle(root);
			expect(root.renderer.getFocusedElementId()).toBe(
				node(root, "rail-settings").id
			);
		} finally {
			catalog.mockRestore();
			menu.mockRestore();
		}
	}
);
