/**
 * Covers: featured settings destinations, color submenu selection/reset and dismissal.
 * Real: settings menu construction and native menu serialization/selection.
 * Doubles: AppKit tracking returns an explicit item index; no native window or preference writes.
 * Requires: none.
 */
import { expect, it, mock } from "bun:test";
import { WorkspaceSettingsMenu } from "../../src/feature/repository-workspace/lib/workspace-settings-menu";
import { NativeFileMenu } from "../../src/feature/repository-workspace/lib/native-file-menu";
import { repositoryColorPresets } from "../../src/feature/repository-appearance/repository-colors";

it("links directly to featured pages and keeps colors in a single submenu", () => {
	const items = WorkspaceSettingsMenu.items("#a478ef");

	const expected = [
		["Appearance…", "appearance"],
		["Accounts…", "accounts"],
		["AI…", "ai"],
		["Remotes…", "repository-remotes"],
		["Commit identity…", "repository-identity"],
		["All Settings…", "accounts"],
	] as const;

	for (const [label, section] of expected) {
		const bridge = mock(
			(labels: string[], _enabled: boolean[], parents: number[]) => {
				const index = labels.indexOf(label);

				expect(parents[index]).toBe(-1);

				return index;
			}
		);

		expect(
			NativeFileMenu.showItems({ showContextMenuItems: bridge }, items, 40, 600)
		).toEqual({ kind: "settings", section });
	}

	expect(items.filter((item) => "children" in item)).toHaveLength(1);
	const submenu = items.find((item) => "children" in item);

	expect(submenu?.label).toBe("Repository color");

	for (const preset of repositoryColorPresets) {
		const child = submenu?.children.find((item) =>
			item.label.endsWith(preset.name)
		);

		expect(child?.value).toEqual({ kind: "color", color: preset.color });
		expect(child?.label.startsWith("✓ ")).toBe(preset.color === "#a478ef");
	}
});

it("distinguishes resetting from cancelling and routes custom colors to the full page", () => {
	const items = WorkspaceSettingsMenu.items(undefined);
	let label = "✓ Default color";
	const bridge = (labels: string[]) => labels.indexOf(label);
	const renderer = { showContextMenuItems: bridge };

	expect(NativeFileMenu.showItems(renderer, items, 0, 0)).toEqual({
		kind: "color",
		color: undefined,
	});
	label = "Custom color…";
	expect(NativeFileMenu.showItems(renderer, items, 0, 0)).toEqual({
		kind: "settings",
		section: "repository-appearance",
	});
	label = "Dismissed";
	expect(NativeFileMenu.showItems(renderer, items, 0, 0)).toBeUndefined();
	label = "";
	expect(NativeFileMenu.showItems(renderer, items, 0, 0)).toBeUndefined();
	const custom = WorkspaceSettingsMenu.items("#123456").find(
		(item) => "children" in item
	);

	expect(custom?.children.some((item) => item.label.startsWith("✓ "))).toBe(
		false
	);
});
