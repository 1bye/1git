import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const readSource = (relativePath: string): string =>
	readFileSync(new URL(relativePath, import.meta.url), "utf8");

const styles = readSource("../src/renderer/src/styles.css");

const IDLE_CONNECTED_TRIGGER_SELECTOR =
	/\[data-liquid-trigger\]:not\(\s*\[data-liquid-connected-fill="none"\]\s*\)\[data-liquid-state="idle"\]:hover/;

const OPEN_CONNECTED_TRIGGER_SELECTOR =
	/\[data-liquid-trigger\]:not\(\s*\[data-liquid-connected-fill="none"\]\s*\)\[data-liquid-state="open"\]/;

const CLOSING_CONNECTED_TRIGGER_SELECTOR =
	/\[data-liquid-trigger\]:not\(\s*\[data-liquid-connected-fill="none"\]\s*\)\[data-liquid-state="closing"\]/;

const CONNECTED_BUTTON_GEOMETRY =
	"anchorGeometry={LIQUID_MENU_CONNECTED_BUTTON_ANCHOR_GEOMETRY}";

describe("liquid trigger styles", () => {
	test("uses the hover token while triggers are idle", () => {
		const consumers = [
			"../src/renderer/src/fixture/desktop-toolbar/components/repository-menu.tsx",
			"../src/renderer/src/fixture/repository-workspace/components/repository-workspace-toolbar.tsx",
			"../src/renderer/src/fixture/repository-item/components/repository-item.tsx",
			"../src/renderer/src/fixture/repository-workspace/components/repository-history-context-menu.tsx",
			"../src/renderer/src/fixture/repository-workspace/components/repository-file-list.tsx",
		];

		for (const consumer of consumers) {
			const source = readSource(consumer);

			expect(source).toContain("hover:bg-hover");
			expect(source).not.toContain("hover:bg-white");
		}
	});

	test("keeps open and closing anchors connected to the surface", () => {
		expect(styles).toMatch(OPEN_CONNECTED_TRIGGER_SELECTOR);
		expect(styles).toMatch(CLOSING_CONNECTED_TRIGGER_SELECTOR);
		expect(styles).toContain('[data-name="WorkspaceTabMenuPill"]');
		expect(styles).toContain("background-color: var(--liquid-active-trigger);");
		expect(styles).toMatch(IDLE_CONNECTED_TRIGGER_SELECTOR);
		expect(styles).not.toContain(
			'[data-liquid-trigger][data-liquid-state="idle"]:hover'
		);
		expect(styles).not.toContain(
			'[data-name="RepositoryMenuTrigger"][data-liquid-menu-anchor-state="active"]'
		);
	});

	test("keeps the dimmed backdrop clickable across app drag regions", () => {
		const surface = readSource(
			"../src/renderer/src/fixture/liquid-menu/components/liquid-menu-surface.tsx"
		);

		expect(surface).toContain('className="pointer-events-auto"');
		expect(surface).toContain("data-desktop-interactive");
		expect(surface).toContain("onBackdropPress(event.nativeEvent)");
		expect(styles).toContain(
			'body:has([data-name="LiquidMenuBackdropLayer"]) [data-desktop-drag]'
		);
	});

	test("shares the rounded-lg anchor geometry across connected buttons", () => {
		const consumers = [
			"../src/renderer/src/fixture/desktop-toolbar/components/repository-menu.tsx",
			"../src/renderer/src/fixture/repository-workspace/components/repository-workspace-toolbar.tsx",
		];

		for (const consumer of consumers) {
			const source = readSource(consumer);

			expect(source).toContain("LIQUID_MENU_CONNECTED_BUTTON_ANCHOR_GEOMETRY");
			expect(source).toContain(CONNECTED_BUTTON_GEOMETRY);
		}
	});

	test("exposes semantic color tokens for surface consumers", () => {
		for (const token of [
			"--liquid-active-trigger",
			"--liquid-dim",
			"--liquid-hover",
			"--liquid-outline",
			"--liquid-surface",
		]) {
			expect(styles).toContain(token);
		}

		const workspaceTab = readSource(
			"../src/renderer/src/fixture/desktop-toolbar/components/workspace-tab.tsx"
		);

		const fileList = readSource(
			"../src/renderer/src/fixture/repository-workspace/components/repository-file-list.tsx"
		);

		expect(workspaceTab).toContain('data-liquid-connected-fill="none"');
		expect(fileList).toContain('contextUsesSelection ? "none" : undefined');
	});

	test("keeps each workspace tab on one unified liquid trigger", () => {
		const workspaceTab = readSource(
			"../src/renderer/src/fixture/desktop-toolbar/components/workspace-tab.tsx"
		);

		const trigger = workspaceTab.slice(
			workspaceTab.indexOf("function WorkspaceTabTrigger"),
			workspaceTab.indexOf("function WorkspaceChangedFiles")
		);

		expect(trigger.match(/<LiquidMenuTrigger/g)).toHaveLength(1);
		expect(trigger).toContain("<RepositoryOwnerThumbnail");
		expect(trigger).toContain("<WorkspaceTabName");
		expect(trigger).toContain("await activate();");
		expect(trigger).toContain("onOpenActions();");
		expect(trigger).toContain("event.defaultPrevented");
		expect(trigger).toContain("if (!isActive)");
		expect(trigger.match(/event\.preventBaseUIHandler\(\)/g)).toHaveLength(3);
		expect(workspaceTab).not.toContain("WorkspaceTabNameButton");
		expect(workspaceTab).not.toContain("isMenuTrigger");
	});

	test("animates every surfaced content variant through the shared marker", () => {
		expect(styles).toContain(
			'[data-liquid-content][data-open][data-liquid-surface="true"]'
		);
		expect(styles).toContain(
			'[data-name="LiquidMenuSubContent"][data-liquid-content][data-open][data-liquid-surface="true"]'
		);
		expect(styles).toMatch(
			/\[data-liquid-content\]\s*\{\s*animation-delay:\s*0ms\s*!important;/
		);
	});

	test("uses shared disabled styling for submenu triggers", () => {
		const dropdownMenu = readSource(
			"../../../packages/ui/src/components/dropdown-menu.tsx"
		);

		const submenuTrigger = dropdownMenu.slice(
			dropdownMenu.indexOf("function DropdownMenuSubTrigger"),
			dropdownMenu.indexOf("function DropdownMenuSubContent")
		);

		expect(submenuTrigger).toContain("data-disabled:pointer-events-none");
		expect(submenuTrigger).toContain("data-disabled:opacity-50");
	});
});
