import type { NativeRenderer, WindowKeyEventHandler } from "@gpuix/react";

/** The mounted workspace owns its filter shortcut; registrations end with that workspace. */
export const repositoryFilterShortcuts = new WeakMap<
	NativeRenderer,
	(close: boolean) => boolean
>();

/** Called after modal keyboard handling so filtering cannot steal an overlay's focus. */
export function handleRepositoryFilterKeyDown(
	...[event, renderer]: Parameters<WindowKeyEventHandler>
): boolean {
	const escape =
		event.key === "escape" &&
		!event.modifiers?.cmd &&
		!event.modifiers?.ctrl &&
		!event.modifiers?.alt;

	if (
		!escape &&
		(event.key !== "f" ||
			!event.modifiers?.cmd ||
			event.modifiers?.shift ||
			event.modifiers?.alt ||
			event.modifiers?.ctrl)
	)
		return false;

	const open = repositoryFilterShortcuts.get(renderer);

	if (!open) return false;

	return open(escape);
}
