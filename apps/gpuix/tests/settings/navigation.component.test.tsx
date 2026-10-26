/**
 * Covers: every Settings destination in both themes, distinct navigation glyphs,
 * and full-height editors with pinned actions.
 * Real: Settings shell, pages, form state and native rendering/input.
 * Doubles: disposable stores, account catalog, editor discovery and Git/model reads.
 * Requires: built native addon and macOS graphics access; no network or user preferences.
 */
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

test.each(["light", "dark"] as const)(
	"opens every Settings page and editor in %s",
	async (appearance) => {
		const directory = mkdtempSync(join(tmpdir(), "1git-settings-layout-"));

		directories.push(directory);
		const root = createTestRoot({ width: 1080, height: 760 });

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
						repositoryAppearanceName="Example"
						ignoredHistory={{ history, repository, onRefresh: async () => {} }}
						spacesSettings={
							<SpacesSettings
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
								onCreate={() => {}}
								onEdit={() => {}}
								onSelect={() => {}}
								onDelete={() => {}}
							/>
						}
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
			root.renderer.nativeSimulateKeyDown(node(id).id, "enter");
			await settle();
		};

		const capture = (name: string) => {
			const output = process.env.GPUIX_SETTINGS_LAYOUT_SCREENSHOTS;

			if (output)
				root.renderer.captureScreenshot(
					join(output, `${appearance}-${name}.png`)
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

			if (section === "appearance") {
				root.renderer.scrollTo(node(page).id, 0, -10000);
				await settle();
				capture("appearance-help");
			}
		}

		for (const [section, open, panel, footer, cancel] of [
			[
				"accounts",
				"account-add",
				"account-setup-panel",
				"account-setup-footer",
				"accounts-cancel",
			],
			[
				"git",
				"identity-edit",
				"identity-editor",
				"git-settings-editor-footer",
				"identity-cancel",
			],
			[
				"repository-remotes",
				"remote-add",
				"remote-editor",
				"git-settings-editor-footer",
				"remote-cancel",
			],
			[
				"editor",
				"editor-rule-add",
				"editor-rule-editor",
				"editor-rule-footer",
				"editor-rule-cancel",
			],
			[
				"ai",
				"ai-add",
				"ai-setup-panel",
				"ai-settings-footer",
				"ai-cancel-editor",
			],
		] as const) {
			await press(`settings-${section}`);
			await press(open);
			const pane = root.renderer.getElementBounds(node(panel).id)!;
			const actions = root.renderer.getElementBounds(node(footer).id)!;

			expect(pane.height).toBeGreaterThan(500);
			expect(actions.y + actions.height).toBeCloseTo(pane.y + pane.height, 0);
			capture(`${section}-editor`);
			await press(cancel);
			expect(root.renderer.findByTestId(panel)).toBeUndefined();
		}
	}
);
