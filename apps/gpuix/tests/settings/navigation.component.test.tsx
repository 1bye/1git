/**
 * Covers: every Settings destination in both themes, distinct navigation glyphs,
 * and full-height editors with pinned actions.
 * Real: Settings shell, pages, form state and native rendering/input.
 * Doubles: disposable stores, account catalog, editor discovery and Git/model reads.
 * Requires: built native addon and macOS graphics access; no network or user preferences.
 */
import { useState, type Ref } from "react";
import { windowOptions } from "../../src/window-options";
import type { SpacesSettingsHandle } from "../../src/feature/spaces/space-manager";
import type { WorkspaceSpace } from "../../src/feature/spaces/workspace-spaces";
import { afterEach, expect, test, spyOn, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestRoot } from "@gpuix/react/testing";
import { AppThemeContext, appThemes } from "../../src/styles/theme";
import { AccountsSettings } from "../../src/feature/accounts/accounts-settings";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import { ExternalEditors } from "../../src/feature/editor-settings/external-editors";
import { AiProvider } from "../../src/feature/ai/ai-provider";
import { AiIntegration } from "../../src/feature/ai/lib/ai-integration";
import { AiSettingsStore } from "../../src/feature/ai/lib/ai-settings-store";
import { IgnoredHistory } from "../../src/feature/ignored-history/ignored-history";
import { SpacesSettings } from "../../src/feature/spaces/space-manager";

function SpaceFixture({ ref }: { ref?: Ref<SpacesSettingsHandle> }) {
	const [editor, setEditor] = useState<{ space?: WorkspaceSpace }>();

	return (
		<SpacesSettings
			ref={ref}
			editor={editor}
			onCancel={() => setEditor(undefined)}
			onSave={() => setEditor(undefined)}
			spaces={[
				{
					id: "default",
					name: "Default",
					icon: "layers",
					activeId: null,
					repositories: [],
					discovery: { folders: [], hidden: [] },
					library: { starred: [], view: "tiles" },
				},
			]}
			activeId="default"
			onCreate={() => setEditor({})}
			onEdit={(space) => setEditor({ space })}
			onSelect={() => {}}
			onDelete={() => {}}
		/>
	);
}

const roots: ReturnType<typeof createTestRoot>[] = [];
const directories: string[] = [];

afterEach(() => {
	for (const root of roots) root.unmount();

	for (const directory of directories)
		rmSync(directory, { recursive: true, force: true });

	roots.length = 0;
	directories.length = 0;
	mock.restore();
});

test.each([
	["light", 1080],
	["dark", 1080],
	["light", 720],
	["dark", 720],
] as const)(
	"opens every Settings page and editor in %s at %dpx",
	async (appearance, width) => {
		const directory = mkdtempSync(join(tmpdir(), "1git-settings-layout-"));

		directories.push(directory);
		const root = createTestRoot({
			width,
			height: 760,
			onKeyDown: windowOptions.onKeyDown,
		});

		roots.push(root);
		root.renderer.clockPause();
		const vault = {
			read: async () => null,
			write: async () => {
				throw new Error("Unexpected credential write");
			},
			delete: async () => {
				throw new Error("Unexpected credential deletion");
			},
		};

		const accounts = new Accounts(
			new AccountStore(join(directory, "accounts.json")),
			vault
		);

		spyOn(accounts, "load").mockReturnValue([]);
		const editors = new ExternalEditors(
			join(directory, "editors.json"),
			async () => "",
			[]
		);

		const ai = new AiIntegration(
			new AiSettingsStore(join(directory, "ai.json")),
			vault
		);

		spyOn(ai, "models").mockResolvedValue([
			{ value: "test-model", label: "Test model" },
		]);
		const history = new IgnoredHistory(vault, join(directory, "history"));

		const repository = {
			root: "/test/repository",
			gitDirectory: "/test/repository/.git",
			commonDirectory: "/test/repository/.git",
		};

		root.render(
			<AppThemeContext
				value={{ ...appThemes[appearance], commitTypeBadges: true }}
			>
				<AiProvider service={ai}>
					<AccountsSettings
						accounts={accounts}
						externalEditors={editors}
						initialSection="spaces"
						onBack={() => {}}
						onReplayTips={() => {}}
						onSetup={() => {}}
						repositorySettings={{
							root: repository.root,
							name: "Example",
							disabled: false,
						}}
						readGitSettings={async () => ({
							ok: true,
							value: {
								identity: { name: "Alex", email: "alex@example.test" },
								custom: true,
								remotes: [
									{
										name: "origin",
										defaultBranch: "main",
										fetchUrls: ["https://example.test/repo.git"],
										pushUrls: ["https://example.test/repo.git"],
									},
								],
							},
						})}
						repositoryAppearance={{}}
						repositoryAppearanceName="Example repository with a long name"
						onCustomizeRepositoryAppearance={() => {}}
						onChangeRepositoryAppearance={() => {}}
						ignoredHistory={{ history, repository, onRefresh: async () => {} }}
						spacesSettings={<SpaceFixture />}
					/>
				</AiProvider>
			</AppThemeContext>
		);
		const settle = async () => {
			for (let pass = 0; pass < 5; pass++) {
				await Bun.sleep(0);
				root.renderer.flush();
			}

			root.renderer.clockFastForward(200);
			root.renderer.advanceTime(1);
		};

		const node = (id: string) => {
			const element = root.renderer.findByTestId(id);

			if (!element) throw new Error(`Missing ${id}`);

			return element;
		};

		const press = async (id: string) => {
			root.renderer.focusElement(node(id).id);
			root.renderer.simulateKeystrokes("enter");
			await settle();
		};

		const capture = (name: string) => {
			const output = process.env.GPUIX_SETTINGS_LAYOUT_SCREENSHOTS;

			if (output)
				root.renderer.captureScreenshot(
					join(output, `${appearance}-${width}-${name}.png`)
				);
		};

		await settle();
		const pages = [
			["spaces", "spaces-settings"],
			["appearance", "appearance-settings"],
			["keybinds", "keybinds-settings"],
			["privacy", "privacy-settings"],
			["accounts", "accounts-list-panel"],
			["git", "git-settings-page"],
			["editor", "editor-settings-page"],
			["ai", "ai-list-panel"],
			["repository-remotes", "git-settings-page"],
			["repository-appearance", "repository-appearance"],
			["repository-identity", "git-settings-page"],
			["repository-ignored-history", "ignored-history-settings"],
		] as const;

		const icons = pages.map(
			([section]) => node(`settings-${section}-icon`).customProps?.source
		);

		expect(
			icons.every((source) => typeof source === "string" && source.length > 0)
		).toBe(true);
		expect(new Set(icons).size).toBe(pages.length);

		for (const [section, page] of pages) {
			await press(`settings-${section}`);

			const bounds = root.renderer.getElementBounds(node(page).id);

			expect(bounds?.height).toBeGreaterThan(300);
			capture(section);

			if (section === "repository-appearance") {
				const controls = root.renderer.getElementBounds(
					node("repository-appearance-controls").id
				)!;

				const preview = root.renderer.getElementBounds(
					node("repository-appearance-preview-panel").id
				)!;

				const workspace = root.renderer.getElementBounds(
					node("repository-appearance-preview").id
				)!;

				expect(preview.x).toBeGreaterThanOrEqual(controls.x + controls.width);
				expect(workspace.x).toBeGreaterThan(preview.x);
				expect(preview.height).toBeGreaterThan(500);

				const customize = root.renderer.getElementBounds(
					node("repository-appearance-customize").id
				)!;

				const wheel = root.renderer.getElementBounds(
					node("repository-color-wheel").id
				)!;

				expect(customize.x).toBeGreaterThanOrEqual(preview.x);
				expect(customize.y).toBeGreaterThanOrEqual(
					workspace.y + workspace.height
				);
				expect(customize.x + customize.width).toBeLessThanOrEqual(
					preview.x + preview.width
				);
				expect(wheel.x + wheel.width).toBeLessThanOrEqual(
					controls.x + controls.width
				);

				const part = (name: string) =>
					root.renderer.getElementBounds(
						node(`repository-appearance-preview-${name}`).id
					)!;

				const lights = part("traffic-lights");
				const tab = part("tab");
				const label = part("tab-label");
				const rail = part("rail");
				const files = part("files");
				const diff = part("diff");
				const commit = part("commit");

				expect(lights.width).toBeGreaterThan(0);
				expect(lights.x + lights.width).toBeLessThan(tab.x);
				expect(lights.y + lights.height).toBeLessThanOrEqual(rail.y);
				expect(tab.y + tab.height).toBeLessThanOrEqual(files.y);
				expect(label.height).toBeLessThanOrEqual(tab.height);
				expect(rail.x + rail.width).toBeLessThanOrEqual(files.x);
				expect(files.x + files.width).toBeLessThanOrEqual(diff.x);
				expect(files.width).toBeGreaterThan(60);
				expect(diff.width).toBeGreaterThan(60);
				expect(diff.x + diff.width).toBeLessThanOrEqual(
					workspace.x + workspace.width
				);
				expect(commit.y).toBeGreaterThan(files.y + files.height / 2);
				expect(commit.x + commit.width).toBeLessThanOrEqual(diff.x);
			}

			if (section === "appearance") {
				for (const id of [
					"appearance-ui-font-row",
					"appearance-code-font-row",
				]) {
					expect(
						root.renderer.getElementBounds(node(id).id)!.height
					).toBeLessThan(100);
				}

				root.renderer.scrollTo(
					node("appearance-settings-scroll").id,
					0,
					-10000
				);
				await settle();
				capture("appearance-help");
			}
		}

		for (const [section, open, panel, footer] of [
			["spaces", "space-create", "space-editor", "space-editor-footer"],
			[
				"repository-ignored-history",
				"ignored-history-add-path",
				"ignored-history-editor",
				"ignored-history-editor-footer",
			],
			[
				"repository-ignored-history",
				"ignored-history-edit-limits",
				"ignored-history-editor",
				"ignored-history-editor-footer",
			],
			[
				"accounts",
				"account-add",
				"account-setup-panel",
				"account-setup-footer",
			],
			["git", "identity-edit", "identity-editor", "git-settings-editor-footer"],
			[
				"repository-remotes",
				"remote-add",
				"remote-editor",
				"git-settings-editor-footer",
			],
			["editor", "editor-rule-add", "editor-rule-editor", "editor-rule-footer"],
			["ai", "ai-add", "ai-setup-panel", "ai-settings-footer"],
		] as const) {
			await press(`settings-${section}`);
			await press(open);
			const pane = root.renderer.getElementBounds(node(panel).id)!;
			const actions = root.renderer.getElementBounds(node(footer).id)!;

			expect(pane.height).toBeGreaterThan(500);
			expect(actions.y + actions.height).toBeCloseTo(pane.y + pane.height, 0);
			capture(`${section}-editor`);
			root.renderer.simulateKeystrokes("escape");
			await settle();
			expect(root.renderer.findByTestId(panel)).toBeUndefined();
		}
	}
);
