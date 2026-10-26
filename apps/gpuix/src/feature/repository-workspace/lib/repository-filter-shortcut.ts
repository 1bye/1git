import type { NativeRenderer, WindowKeyEventHandler } from "@gpuix/react";
import { Keybinds } from "../../keybinds/keybinds";

const workspaceCommands: Readonly<Record<string, string>> = {
	"quick-open": "p",
	open: "o",
	refresh: "r",
	"close-tab": "w",
	"previous-tab": "left",
	"next-tab": "right",
	"previous-space": "previous-space",
	"next-space": "next-space",
	...Object.fromEntries(
		["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((number) => [
			`tab-${number}`,
			number,
		])
	),
};

/** App-owned window actions, registered only while the app is mounted. */
export const workspaceShortcuts = new WeakMap<
	NativeRenderer,
	(key: string) => void
>();

/** Full-page cloning owns Escape and search without trapping tab navigation. */
export const cloneNavigation = new WeakMap<
	NativeRenderer,
	{ back: () => void; search: () => void }
>();

export function handleCloneNavigation(
	...[event, renderer]: Parameters<WindowKeyEventHandler>
): boolean {
	const navigation = cloneNavigation.get(renderer);

	if (!navigation || event.isHeld) return false;

	if (
		event.key === "escape" &&
		!event.modifiers?.cmd &&
		!event.modifiers?.ctrl &&
		!event.modifiers?.alt &&
		!event.modifiers?.shift
	) {
		navigation.back();

		return true;
	}

	if (Keybinds.matches(event, "find", renderer)) {
		navigation.search();

		return true;
	}

	return false;
}

export function handleWorkspaceKeyDown(
	...[event, renderer]: Parameters<WindowKeyEventHandler>
): boolean {
	if (
		event.isHeld ||
		(!event.modifiers?.cmd && !event.modifiers?.ctrl && !event.modifiers?.alt)
	)
		return false;

	const command = Object.entries(workspaceCommands).find(([id]) =>
		Keybinds.matches(event, id, renderer)
	);

	if (!command) return false;

	workspaceShortcuts.get(renderer)?.(command[1]);

	return true;
}

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

	if (!escape && !Keybinds.matches(event, "find", renderer)) return false;

	const open = repositoryFilterShortcuts.get(renderer);

	if (!open) return false;

	return open(escape);
}
