/**
 * Covers: featured Settings destinations, a single customization action and dismissal.
 * Real: Settings menu construction and native menu serialization/selection.
 * Doubles: AppKit tracking returns an explicit item index; no native window or preference writes.
 * Requires: none.
 */
import { expect, it, mock } from "bun:test";
import { WorkspaceSettingsMenu } from "../../src/feature/repository-workspace/lib/workspace-settings-menu";
import { NativeFileMenu } from "../../src/feature/repository-workspace/lib/native-file-menu";

it("links directly to featured Settings pages", () => {
	const items = WorkspaceSettingsMenu.items();

	const expected = [
		["Appearance…", "appearance"],
		["Accounts…", "accounts"],
		["Spaces…", "spaces"],
		["AI…", "ai"],
		["Help…", "help"],
		["Remotes…", "repository-remotes"],
		["Commit identity…", "repository-identity"],
		["Ignored file history…", "repository-ignored-history"],
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
});

it("opens the live editor with one top-level customization action and no submenus", () => {
	const items = WorkspaceSettingsMenu.items();

	const bridge = mock(
		(labels: string[], enabled: boolean[], parents: number[]) => {
			const index = labels.indexOf("Customize appearance…");

			expect(index).toBeGreaterThanOrEqual(0);
			expect(enabled[index]).toBe(true);
			expect(parents[index]).toBe(-1);
			expect(labels).not.toContain("Repository color");
			expect(labels).not.toContain("Repository pattern");

			return index;
		}
	);

	expect(items.filter((item) => "children" in item)).toHaveLength(0);
	expect(
		NativeFileMenu.showItems({ showContextMenuItems: bridge }, items, 40, 600)
	).toEqual({ kind: "appearance", section: "color" });
});

it("leaves dismissal and separators without an action", () => {
	const items = WorkspaceSettingsMenu.items();

	for (const label of ["Dismissed", ""]) {
		const renderer = {
			showContextMenuItems: (labels: string[]) => labels.indexOf(label),
		};

		expect(NativeFileMenu.showItems(renderer, items, 0, 0)).toBeUndefined();
	}
});
