import type { RenderOptions } from "@gpuix/react";
import {
	handleSettingsKeyDown,
	handleSettingsNavigation,
} from "./feature/accounts/lib/settings-shortcut";
import { handlePopoverKeyDown } from "@1git/gpuix-ui/popover";
import { handleRepositoryAppearanceKeyDown } from "./feature/repository-appearance/repository-appearance-shortcut";
import { handleRepositoryFilterKeyDown } from "./feature/repository-workspace/lib/repository-filter-shortcut";
import { handleWorkspaceKeyDown } from "./feature/repository-workspace/lib/repository-filter-shortcut";
import { handleCloneNavigation } from "./feature/repository-workspace/lib/repository-filter-shortcut";

/** Native window chrome and keyboard traversal; application content stays transparent around the workspace. */
export const windowOptions: RenderOptions = {
	height: 820,
	width: 1280,
	// Fit half/quarter-screen layouts requested through macOS accessibility APIs.
	minWidth: 640,
	minHeight: 420,
	title: "1git",
	titlebarTransparent: true,
	appOwnsTitlebarDrag: true,
	windowBackground: "blurred",
	trafficLightX: 16,
	trafficLightY: 13,
	onKeyDown(event, renderer) {
		if (handlePopoverKeyDown(event, renderer)) return;

		if (handleRepositoryAppearanceKeyDown(event, renderer)) return;

		if (handleSettingsKeyDown(event, renderer)) return;

		if (handleSettingsNavigation(event, renderer)) return;

		if (handleCloneNavigation(event, renderer)) return;

		if (handleRepositoryFilterKeyDown(event, renderer)) return;

		if (handleWorkspaceKeyDown(event, renderer)) return;

		if (
			event.key !== "tab" ||
			event.modifiers?.cmd ||
			event.modifiers?.ctrl ||
			event.modifiers?.alt
		)
			return;

		if (event.modifiers?.shift) renderer.focusPrevious?.();
		else renderer.focusNext?.();
	},
};
