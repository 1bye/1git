import type { RenderOptions } from "@gpuix/react";

/** Native window chrome and keyboard traversal; application content stays transparent around the workspace. */
export const windowOptions: RenderOptions = {
	height: 820,
	width: 1280,
	minWidth: 980,
	minHeight: 640,
	title: "1git",
	titlebarTransparent: true,
	windowBackground: "blurred",
	trafficLightX: 16,
	trafficLightY: 13,
	onKeyDown(event, renderer) {
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
