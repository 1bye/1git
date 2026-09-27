/** The pinned addon owns AppKit tracking and confirmation; React receives only explicit choices. */
export class NativeFileMenu {
	static show(
		renderer: object,
		labels: string[],
		enabled: boolean[],
		x: number,
		y: number
	): number {
		if (
			!("showContextMenu" in renderer) ||
			typeof renderer.showContextMenu !== "function"
		)
			throw new Error(
				"Native context menus require the updated macOS build. Restart the app after building native support."
			);

		return renderer.showContextMenu(labels, enabled, x, y);
	}
	static confirm(renderer: object, path: string): boolean {
		if (
			!("confirmFileDiscard" in renderer) ||
			typeof renderer.confirmFileDiscard !== "function"
		)
			throw new Error(
				"Native discard confirmation is unavailable. No files were changed."
			);

		return renderer.confirmFileDiscard(path);
	}
}
