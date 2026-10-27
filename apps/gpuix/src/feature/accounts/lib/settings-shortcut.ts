import type { NativeRenderer, WindowKeyEventHandler } from "@gpuix/react";

/** One window's Settings action, removed on unmount. */
export const settingsShortcuts = new WeakMap<NativeRenderer, () => void>();
/** Settings owns Escape while its tab is active. */
export const settingsNavigation = new WeakMap<
	NativeRenderer,
	{ back: () => void }
>();

export function handleSettingsNavigation(
	...[event, renderer]: Parameters<WindowKeyEventHandler>
): boolean {
	const navigation = settingsNavigation.get(renderer);

	if (!navigation) return false;

	if (event.key === "escape") {
		navigation.back();

		return true;
	}

	return false;
}

/** Native menu uses the same action; Ctrl+, is the non-macOS equivalent. */
export function handleSettingsKeyDown(
	...[event, renderer]: Parameters<WindowKeyEventHandler>
): boolean {
	if (
		event.key !== "," ||
		!(event.modifiers?.cmd || event.modifiers?.ctrl) ||
		event.modifiers?.alt ||
		event.modifiers?.shift ||
		event.isHeld
	)
		return false;

	const open = settingsShortcuts.get(renderer);

	if (!open) return false;

	open();

	return true;
}
