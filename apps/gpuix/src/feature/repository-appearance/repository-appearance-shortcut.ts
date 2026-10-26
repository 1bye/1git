import type { NativeRenderer, WindowKeyEventHandler } from "@gpuix/react";

/** One window's active color drag or temporary editor; Escape cancels the innermost operation. */
export const repositoryAppearanceCancel = new WeakMap<
	NativeRenderer,
	() => void
>();

/** Cancels appearance editing before ordinary workspace Escape handlers run. */
export function handleRepositoryAppearanceKeyDown(
	...[event, renderer]: Parameters<WindowKeyEventHandler>
): boolean {
	const cancel = repositoryAppearanceCancel.get(renderer);

	if (
		!cancel ||
		event.key !== "escape" ||
		event.isHeld ||
		event.modifiers?.cmd ||
		event.modifiers?.ctrl ||
		event.modifiers?.alt ||
		event.modifiers?.shift
	)
		return false;

	cancel();

	return true;
}
