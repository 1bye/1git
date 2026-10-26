/**
 * Covers: live light/dark selection, persisted preference, retained drafts, inclusion, selection and native diff scroll; dark chrome, syntax, popovers and keyboard choice.
 * Real: App, native rendering/input, theme and session models.
 * Doubles: repository/diff reads, account catalog, editor discovery and session save; no user preferences, credentials or Git writes.
 * Requires: patched native addon and macOS graphics access.
 */
import { afterEach, expect, it, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { InstalledFonts } from "../../src/feature/appearance-settings/installed-fonts";
import { App } from "../../src/app";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import { ExternalEditors } from "../../src/feature/editor-settings/external-editors";
import type { WorkspaceSessionDocument } from "../../src/feature/workspace-tabs/lib/workspace-session";
import {
	appColors,
	appControlTokens,
	type AppAppearance,
} from "../../src/styles/tokens";
import { darkDiffTheme } from "../../src/styles/dark-diff-theme";
import { windowOptions } from "../../src/window-options";
import { NativeFileMenu } from "../../src/feature/repository-workspace/lib/native-file-menu";
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

function fixture(
	appearance?: "light" | "dark" | "system",
	commitTypeBadges?: boolean,
	smoothTransitions?: boolean,
	initialSystemAppearance: AppAppearance = "light",
	showScrollbars?: boolean,
	showGrain?: boolean
) {
	const root = createTestRoot({
		width: 1100,
		height: 760,
		onKeyDown: windowOptions.onKeyDown,
	});

	roots.add(root);
	root.renderer.clockPause();
	const nativeAppearances: AppAppearance[] = [];
	let systemAppearance = initialSystemAppearance;

	Object.assign(root.renderer, {
		getSystemAppearance: () => systemAppearance,
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
	let historyReads = 0;

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
				commitTypeBadges,
				smoothTransitions,
				showScrollbars,
				showGrain,
			}}
			readRepository={async () => ({ ok: true, value: snapshot })}
			readHistory={async () => {
				historyReads++;

				return {
					ok: true,
					value: {
						commits: [
							{
								...commitInfo(),
								summary: "refactor(db): generate schema baseline",
							},
						],
						hasMore: false,
						nextOffset: null,
					},
				};
			}}
			readTags={async () => ({ ok: true, value: [] })}
			readCommitFiles={async () => ({ ok: true, value: [] })}
			readDiff={async (_root, change) => {
				reads.push(change.path);

				return { ok: true, value: [diffSection("working", patch)] };
			}}
			readLastCommit={async () => ({
				ok: true,
				value: {
					commit: {
						...commitInfo(),
						summary: "feat(core): keep the last commit",
					},
					undoUnavailableReason: null,
				},
			})}
			saveSession={(document) => saved.push(document)}
		/>
	);

	return {
		root,
		saved,
		catalog,
		reads: () => reads.filter((path) => path === "example.ts").length,
		historyReads: () => historyReads,
		nativeAppearances,
		setSystemAppearance: (value: AppAppearance) => {
			systemAppearance = value;
		},
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

async function openSettings(root: TestRoot): Promise<void> {
	const menu = spyOn(NativeFileMenu, "showItems").mockReturnValueOnce({
		kind: "settings",
		section: "accounts",
	});

	try {
		click(root, "rail-settings");
		await settle(root);
	} finally {
		menu.mockRestore();
	}
}

it("enables smooth transitions by default and restores a saved disabled choice", async () => {
	const { root, saved, catalog } = fixture("light");

	try {
		await settle(root);
		await openSettings(root);
		click(root, "settings-appearance");
		const toggle = node(root, "appearance-smooth-transitions");

		expect(toggle.customProps?.["aria-checked"]).toBe(true);
		root.renderer.nativeSimulateKeyDown(toggle.id, "space");
		root.renderer.nativeSimulateKeyUp(toggle.id, "space");
		root.renderer.flush();
		expect(
			node(root, "appearance-smooth-transitions").customProps?.["aria-checked"]
		).toBe(false);
		await Bun.sleep(230);
		root.renderer.flush();
		expect(saved.at(-1)?.smoothTransitions).toBe(false);
		expect(saved.at(-1)?.tabs[0]?.draft).toBe("Keep my draft");
	} finally {
		catalog.mockRestore();
	}

	const restored = fixture("dark", undefined, false);

	try {
		await settle(restored.root);
		await openSettings(restored.root);
		click(restored.root, "settings-appearance");
		expect(
			node(restored.root, "appearance-smooth-transitions").customProps?.[
				"aria-checked"
			]
		).toBe(false);
		click(restored.root, "appearance-smooth-transitions");
		await Bun.sleep(230);
		restored.root.renderer.flush();
		expect(restored.saved.at(-1)?.smoothTransitions).toBe(true);
	} finally {
		restored.catalog.mockRestore();
	}
});

it("switches in Settings without losing a draft, selected file, inclusion or diff scroll and saves the choice", async () => {
	const { root, saved, reads, catalog, nativeAppearances } = fixture();

	await settle(root);
	expect(nativeAppearances).toEqual(["light"]);
	click(root, "entry-example.ts");
	await settle(root);
	click(root, "include-example.ts");
	const content = node(root, "diff-viewport-content").id;

	root.renderer.scrollTo(content, 0, -420);
	root.renderer.flush();
	const scroll = root.renderer.getScrollOffset(content);
	const count = reads();

	await openSettings(root);
	click(root, "settings-appearance");
	click(root, "appearance-dark");
	await Bun.sleep(220);
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
	expect(node(root, "commit-message").customProps?.theme).toMatchObject({
		caret: appColors.dark.brand,
	});
	expect(node(root, "commit-submit").style.backgroundColor).toBe(
		appControlTokens.dark.colors.accent
	);

	const commitLabel = root.renderer.getElement(
		node(root, "commit-submit").children[0] ?? -1
	);

	const inclusionBox = root.renderer.getElement(
		node(root, "include-example.ts").children[0] ?? -1
	);

	const inclusionMark = root.renderer.getElement(
		inclusionBox?.children[0] ?? -1
	);

	expect(commitLabel?.style.color).toBe(appColors.dark.brand);
	expect(inclusionBox?.style.backgroundColor).toBe(
		appControlTokens.dark.colors.accent
	);
	expect(inclusionBox?.style.borderColor).toBe(
		inclusionBox?.style.backgroundColor
	);
	expect(inclusionMark?.style.color).toBe(appColors.dark.brand);

	for (const [testId, borderColor] of [
		["include-all", appControlTokens.dark.colors.accent],
		["include-other.ts", appControlTokens.dark.colors.border],
	] as const) {
		const box = root.renderer.getElement(node(root, testId).children[0] ?? -1);

		expect(box?.style.borderColor).toBe(borderColor);
	}

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

	await openSettings(root);
	click(root, "settings-appearance");
	click(root, "appearance-light");
	click(root, "view-changes");
	await Bun.sleep(220);
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

it("toggles and persists commit badges in Appearance without reloading history or changing its selection", async () => {
	const { root, saved, catalog, historyReads } = fixture("dark");

	try {
		await settle(root);
		expect(
			root.renderer.findByTestId("last-commit-summary-badge")
		).toBeDefined();
		click(root, "view-history");
		await settle(root);
		const id = commitInfo().oid;
		const badgeId = `commit-subject-${id}-badge`;

		expect(root.renderer.findByTestId(badgeId)).toBeDefined();
		click(root, `entry-${id}`);
		await settle(root);
		const reads = historyReads();

		await openSettings(root);
		click(root, "settings-appearance");
		expect(
			node(root, "appearance-commit-type-badges").customProps?.["aria-checked"]
		).toBe(true);
		expect(
			root.renderer.findByTestId("appearance-commit-preview-feat-badge")
		).toBeDefined();
		root.renderer.nativeSimulateKeyDown(
			node(root, "appearance-commit-type-badges").id,
			"space"
		);
		root.renderer.nativeSimulateKeyUp(
			node(root, "appearance-commit-type-badges").id,
			"space"
		);
		root.renderer.flush();
		expect(root.renderer.getAllText()).toContain(
			"feat(core): add workspace shortcuts"
		);
		await Bun.sleep(230);
		root.renderer.flush();
		expect(saved.at(-1)?.commitTypeBadges).toBe(false);
		expect(saved.at(-1)?.tabs[0]?.draft).toBe("Keep my draft");

		click(root, "view-history");
		await settle(root);
		expect(root.renderer.findByTestId(badgeId)).toBeUndefined();
		expect(node(root, `entry-${id}`).customProps?.["aria-selected"]).toBe(true);
		expect(root.renderer.getAllText()).toContain(
			"refactor(db): generate schema baseline"
		);
		expect(historyReads()).toBe(reads);

		await openSettings(root);
		click(root, "settings-appearance");
		root.renderer.scrollIntoView(
			node(root, "appearance-commit-type-badges").id
		);
		root.renderer.advanceTime(1);
		click(root, "appearance-commit-type-badges");
		await Bun.sleep(230);
		root.renderer.flush();
		expect(saved.at(-1)?.commitTypeBadges).toBe(true);

		if (process.env.GPUIX_COMMIT_SETTINGS_SCREENSHOT)
			root.renderer.captureScreenshot(
				process.env.GPUIX_COMMIT_SETTINGS_SCREENSHOT
			);
	} finally {
		catalog.mockRestore();
	}
});

it("restores disabled badges from a saved session", async () => {
	const { root, catalog } = fixture("light", false);

	try {
		await settle(root);
		expect(
			root.renderer.findByTestId("last-commit-summary-badge")
		).toBeUndefined();
		expect(root.renderer.getAllText()).toContain(
			"feat(core): keep the last commit"
		);
		click(root, "view-history");
		await settle(root);
		expect(
			root.renderer.findByTestId(`commit-subject-${commitInfo().oid}-badge`)
		).toBeUndefined();
		expect(root.renderer.getAllText()).toContain(
			"refactor(db): generate schema baseline"
		);
		await openSettings(root);
		click(root, "settings-appearance");
		expect(
			node(root, "appearance-commit-type-badges").customProps?.["aria-checked"]
		).toBe(false);
	} finally {
		catalog.mockRestore();
	}
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
	await openSettings(first.root);
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

it("follows system changes in Auto, persists the preference and honors manual overrides", async () => {
	const { root, saved, catalog, nativeAppearances, setSystemAppearance } =
		fixture("system", undefined, false, "dark");

	try {
		await settle(root);
		expect(nativeAppearances).toEqual(["dark"]);
		await openSettings(root);
		click(root, "settings-appearance");
		expect(
			node(root, "appearance-system").customProps?.["aria-description"]
		).toBe("Selected");
		setSystemAppearance("light");
		await Bun.sleep(1050);
		await settle(root);
		expect(nativeAppearances.at(-1)).toBe("light");
		expect(saved.at(-1)?.appearance).toBe("system");
		expect(saved.at(-1)?.tabs[0]?.draft).toBe("Keep my draft");
		click(root, "appearance-dark");
		await settle(root);
		await Bun.sleep(1050);
		await settle(root);
		expect(nativeAppearances.at(-1)).toBe("dark");
		expect(saved.at(-1)?.appearance).toBe("dark");
		click(root, "appearance-system");
		await settle(root);
		expect(nativeAppearances.at(-1)).toBe("light");
	} finally {
		catalog.mockRestore();
	}
});

it.each([
	{ savedChoice: undefined, initial: true },
	{ savedChoice: false, initial: false },
])(
	"defaults pane scrollbars on, preserves saved preferences and persists toggles (%j)",
	async ({ savedChoice, initial }) => {
		const { root, catalog, saved } = fixture(
			"light",
			undefined,
			undefined,
			"light",
			savedChoice
		);

		try {
			await settle(root);
			await openSettings(root);
			click(root, "settings-appearance");
			expect(
				node(root, "appearance-scrollbars").customProps?.["aria-checked"]
			).toBe(initial);
			click(root, "appearance-scrollbars");
			await Bun.sleep(230);
			await settle(root);
			expect(saved.at(-1)?.showScrollbars).toBe(!initial);
			expect(saved.at(-1)?.tabs[0]?.draft).toBe("Keep my draft");
			click(root, "appearance-scrollbars");
			await Bun.sleep(230);
			await settle(root);
			expect(saved.at(-1)?.showScrollbars).toBe(initial);
		} finally {
			catalog.mockRestore();
		}
	}
);

it.each([
	{ appearance: "light", savedChoice: undefined, initial: true },
	{ appearance: "dark", savedChoice: undefined, initial: true },
	{ appearance: "light", savedChoice: false, initial: false },
	{ appearance: "dark", savedChoice: false, initial: false },
] as const)(
	"defaults grain on, restores its saved choice and toggles it without resetting the workspace (%j)",
	async ({ appearance, savedChoice, initial }) => {
		const { root, catalog, saved } = fixture(
			appearance,
			undefined,
			false,
			"light",
			undefined,
			savedChoice
		);

		try {
			await settle(root);
			expect(!!root.renderer.findByTestId("repository-chrome-grain")).toBe(
				initial
			);
			click(root, "entry-example.ts");
			await settle(root);
			const content = node(root, "diff-viewport-content").id;

			await openSettings(root);
			click(root, "settings-appearance");
			expect(node(root, "appearance-grain").customProps?.["aria-checked"]).toBe(
				initial
			);
			click(root, "appearance-grain");
			await Bun.sleep(230);
			await settle(root);
			expect(saved.at(-1)?.showGrain).toBe(!initial);
			expect(!!root.renderer.findByTestId("repository-chrome-grain")).toBe(
				!initial
			);

			if (process.env.GPUIX_GRAIN_SETTINGS_SCREENSHOT && initial)
				root.renderer.captureScreenshot(
					`${process.env.GPUIX_GRAIN_SETTINGS_SCREENSHOT}-${appearance}.png`
				);

			root.renderer.nativeSimulateKeyDown(
				node(root, "appearance-grain").id,
				"space"
			);
			root.renderer.nativeSimulateKeyUp(
				node(root, "appearance-grain").id,
				"space"
			);
			await Bun.sleep(230);
			await settle(root);
			expect(saved.at(-1)?.showGrain).toBe(initial);
			expect(!!root.renderer.findByTestId("repository-chrome-grain")).toBe(
				initial
			);
			click(root, "view-changes");
			await settle(root);
			expect(node(root, "diff-viewport-content").id).toBe(content);
			expect(node(root, "commit-message").customProps?.value).toBe(
				"Keep my draft"
			);
		} finally {
			catalog.mockRestore();
		}
	}
);

it("saves text size and installed fonts while retaining the draft and diff instance", async () => {
	const { root, catalog, saved } = fixture("light", undefined, false);

	const fontCatalog = spyOn(InstalledFonts, "list").mockReturnValue([
		"Courier",
		"Helvetica Neue",
		"Menlo",
	]);

	try {
		await settle(root);
		click(root, "entry-example.ts");
		await settle(root);
		const content = node(root, "diff-viewport-content").id;

		await openSettings(root);
		click(root, "settings-appearance");
		root.renderer.scrollTo(
			node(root, "appearance-settings-scroll").id,
			0,
			-10000
		);
		root.renderer.advanceTime(1);
		root.renderer.nativeSimulateKeyDown(
			node(root, "appearance-font-size").id,
			"end"
		);
		root.renderer.nativeSimulateKeyDown(
			node(root, "appearance-font-size").id,
			"left"
		);
		root.renderer.nativeSimulateKeyDown(
			node(root, "appearance-font-size").id,
			"left"
		);
		await settle(root);

		for (const [id, value] of [
			["appearance-ui-font", "Helvetica Neue"],
			["appearance-code-font", "Courier"],
		] as const) {
			root.renderer.scrollIntoView(node(root, id).id);
			root.renderer.advanceTime(1);
			click(root, id);
			await settle(root);
			click(root, `${id}-${value}`);
			await settle(root);
		}

		await Bun.sleep(230);
		await settle(root);
		expect(saved.at(-1)?.typography).toEqual({
			fontSize: 16,
			fontFamily: "Helvetica Neue",
			codeFontFamily: "Courier",
		});
		expect(saved.at(-1)?.tabs[0]?.draft).toBe("Keep my draft");
		click(root, "view-changes");
		await settle(root);
		expect(node(root, "diff-viewport-content").id).toBe(content);
		expect(
			node(root, "diff-viewport-content").customProps?.theme
		).toMatchObject({
			fontMono: "Courier",
			fontSans: "Helvetica Neue",
			metrics: { diffTextSize: (11 * 4) / 3 },
		});
	} finally {
		fontCatalog.mockRestore();
		catalog.mockRestore();
	}
});
