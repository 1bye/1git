/**
 * Covers: optional icon paths, submenu index alignment, and disabled/separator actions.
 * Real: menu flattening and action selection.
 * Doubles: AppKit bridge captures data; no application icon loading or menu tracking.
 * Requires: none.
 */
import { expect, it, mock } from "bun:test";
import { NativeFileMenu } from "../../src/feature/repository-workspace/lib/native-file-menu";

it("aligns selective icons with native labels while preserving submenu choices", () => {
	const bridge = mock(() => 4);

	const chosen = NativeFileMenu.showItems(
		{ showContextMenuItems: bridge },
		[
			{ label: "Copy", enabled: true, value: "copy" },
			{ separator: true },
			{
				label: "Finder",
				enabled: true,
				value: "finder",
				iconPath: "/System/Library/CoreServices/Finder.app",
			},
			{
				label: "Open With",
				enabled: true,
				children: [
					{
						label: "Zed",
						enabled: true,
						value: "zed",
						iconPath: "/Applications/Zed.app",
					},
					{ label: "System default", enabled: true, value: "default" },
				],
			},
		],
		12,
		34
	);

	expect(chosen).toBe("zed");
	expect(bridge).toHaveBeenCalledWith(
		["Copy", "", "Finder", "Open With", "Zed", "System default"],
		[true, false, true, true, true, true],
		[-1, -1, -1, -1, 3, 3],
		12,
		34,
		[
			"",
			"",
			"/System/Library/CoreServices/Finder.app",
			"",
			"/Applications/Zed.app",
			"",
		]
	);
});

it("keeps disabled icon-bearing children and separators non-selectable", () => {
	const bridge = mock(() => 1);
	const renderer = { showContextMenuItems: bridge };

	expect(
		NativeFileMenu.showItems(
			renderer,
			[
				{
					label: "Open With",
					enabled: false,
					children: [
						{
							label: "Zed",
							enabled: true,
							value: "zed",
							iconPath: "/Applications/Zed.app",
						},
					],
				},
			],
			0,
			0
		)
	).toBeUndefined();
	expect(
		NativeFileMenu.showItems(
			renderer,
			[{ label: "Copy", enabled: true, value: "copy" }, { separator: true }],
			0,
			0
		)
	).toBeUndefined();
});
