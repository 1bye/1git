/** Native file menus have groups and one level of folder choices; separators are never selectable. */
export type NativeMenuItem<T> =
	| { separator: true }
	| { label: string; enabled: boolean; value: T }
	| {
			label: string;
			enabled: boolean;
			children: { label: string; enabled: boolean; value: T }[];
	  };

/** The pinned addon owns AppKit tracking and confirmation; React receives only explicit choices. */
export class NativeFileMenu {
	static showItems<T>(
		renderer: object,
		items: NativeMenuItem<T>[],
		x: number,
		y: number
	): T | undefined {
		if (
			!("showContextMenuItems" in renderer) ||
			typeof renderer.showContextMenuItems !== "function"
		)
			throw new Error(
				"Grouped native menus require the updated macOS build. Restart the app after building native support."
			);

		const labels: string[] = [];
		const enabled: boolean[] = [];
		const parents: number[] = [];
		const choices: (T | undefined)[] = [];

		for (const item of items) {
			const index = labels.length;

			labels.push("separator" in item ? "" : item.label);
			enabled.push("separator" in item ? false : item.enabled);
			parents.push(-1);
			choices.push("value" in item ? item.value : undefined);

			if ("children" in item)
				for (const child of item.children) {
					labels.push(child.label);
					enabled.push(item.enabled && child.enabled);
					parents.push(index);
					choices.push(child.value);
				}
		}

		const index: number = renderer.showContextMenuItems(
			labels,
			enabled,
			parents,
			x,
			y
		);

		return enabled[index] ? choices[index] : undefined;
	}

	static confirmIgnore(renderer: object, pattern: string): boolean {
		if (
			!("confirmIgnoreRule" in renderer) ||
			typeof renderer.confirmIgnoreRule !== "function"
		)
			throw new Error(
				"Native ignore confirmation is unavailable. No files were changed."
			);

		return renderer.confirmIgnoreRule(pattern);
	}

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
