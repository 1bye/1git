import type { EventPayload, NativeRenderer } from "@gpuix/react";

/** Application commands share their defaults between the shortcut router and Settings. */
export const keybindCommands: readonly KeybindCommand[] = [
	{
		id: "settings",
		label: "Open Settings",
		group: "Application",
		key: "cmd-,",
		aliases: ["ctrl-,"],
		fixed: true,
		description: "Uses the standard macOS Settings menu shortcut.",
	},
	{
		id: "quick-open",
		label: "Find repository or action",
		group: "Application",
		key: "cmd-p",
	},
	{ id: "open", label: "Open repository", group: "Application", key: "cmd-o" },
	{
		id: "refresh",
		label: "Fetch repository",
		group: "Application",
		key: "cmd-r",
	},
	{
		id: "new-tab",
		label: "New tab",
		group: "Tabs",
		key: "cmd-t",
	},
	{
		id: "previous-space",
		label: "Previous space",
		group: "Spaces",
		key: "ctrl-cmd-left",
	},
	{
		id: "next-space",
		label: "Next space",
		group: "Spaces",
		key: "ctrl-cmd-right",
	},
	{
		id: "close-tab",
		label: "Close tab",
		group: "Tabs",
		key: "cmd-w",
	},
	{ id: "previous-tab", label: "Previous tab", group: "Tabs", key: "cmd-left" },
	{ id: "next-tab", label: "Next tab", group: "Tabs", key: "cmd-right" },
	...["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((number) => ({
		id: `tab-${number}`,
		label: `Switch to tab ${number}`,
		group: "Tabs",
		key: `cmd-${number}`,
	})),
	{
		id: "find",
		label: "Find / filter",
		group: "Repository",
		key: "cmd-f",
		aliases: ["ctrl-f"],
	},
	{
		id: "commit",
		label: "Commit checked changes",
		group: "Repository",
		key: "cmd-enter",
		description:
			"While the commit message is focused. Previews in sample workspaces.",
	},
	{
		id: "expand-diff",
		label: "Expand unchanged diff lines",
		group: "Repository",
		key: "e",
		description: "While the diff is focused.",
	},
];

/** A shortcut's action and the context in which it is available. */
export interface KeybindCommand {
	readonly id: string;
	readonly label: string;
	readonly group: string;
	readonly key: string;
	readonly aliases?: readonly string[];
	readonly description?: string;
	readonly fixed?: boolean;
}

/** Only customized command IDs are saved; missing entries use the current defaults. */
export type KeybindOverrides = Readonly<Record<string, string>>;

const modifiers = ["ctrl", "alt", "shift", "cmd"] as const;

const keyPattern =
	/^(?:[a-z0-9,.;/[\]\\'`=-]|enter|space|left|right|up|down|home|end|pageup|pagedown|backspace|delete|f(?:[1-9]|1[0-9]|2[0-4]))$/;

const bindingPattern = /^(?<prefix>(?:(?:ctrl|alt|shift|cmd)-)*)(?<key>.+)$/;

const reserved = new Set([
	"cmd-a",
	"cmd-c",
	"cmd-x",
	"cmd-v",
	"cmd-z",
	"shift-cmd-z",
	"cmd-q",
	"cmd-h",
	"alt-cmd-h",
	"cmd-m",
	"cmd-space",
	"ctrl-a",
	"ctrl-c",
	"ctrl-x",
	"ctrl-v",
	"ctrl-z",
	"ctrl-shift-z",
	"cmd-left",
	"cmd-right",
	"cmd-up",
	"cmd-down",
	"shift-cmd-left",
	"shift-cmd-right",
	"shift-cmd-up",
	"shift-cmd-down",
	"cmd-backspace",
	"cmd-delete",
	"alt-left",
	"alt-right",
	"alt-shift-left",
	"alt-shift-right",
	"alt-backspace",
	"alt-delete",
	"ctrl-left",
	"ctrl-right",
	"ctrl-up",
	"ctrl-down",
]);

const symbols: Readonly<Record<string, string>> = {
	ctrl: "⌃",
	alt: "⌥",
	shift: "⇧",
	cmd: "⌘",
	enter: "↩",
	space: "Space",
	left: "←",
	right: "→",
	up: "↑",
	down: "↓",
	home: "Home",
	end: "End",
	pageup: "Page Up",
	pagedown: "Page Down",
	backspace: "⌫",
	delete: "⌦",
};

const windows = new WeakMap<NativeRenderer, KeybindOverrides>();

/** Temporary shortcut capture belongs to one native window and is removed when its dialog closes. */
export const keybindRecordings = new WeakMap<
	NativeRenderer,
	(event: EventPayload) => boolean
>();

/** Validates saved/user shortcuts and matches native events without changing platform editing keys. */
export class Keybinds {
	static register(
		renderer: NativeRenderer,
		overrides: KeybindOverrides
	): () => void {
		windows.set(renderer, overrides);

		return () => {
			if (windows.get(renderer) === overrides) windows.delete(renderer);
		};
	}

	static binding(command: KeybindCommand, overrides: KeybindOverrides): string {
		return overrides[command.id] ?? command.key;
	}

	static bindings(
		command: KeybindCommand,
		overrides: KeybindOverrides
	): readonly string[] {
		const binding = overrides[command.id];

		return binding ? [binding] : [command.key, ...(command.aliases ?? [])];
	}

	static label(id: string, overrides: KeybindOverrides): string {
		const command = keybindCommands.find((item) => item.id === id);

		return command
			? this.bindings(command, overrides).map(Keybinds.format).join(" / ")
			: "";
	}

	static fromEvent(
		event: Pick<EventPayload, "key" | "modifiers">
	): string | null {
		const key = event.key?.toLowerCase();

		if (!key || !keyPattern.test(key)) return null;

		return [
			...modifiers.filter((modifier) => event.modifiers?.[modifier]),
			key,
		].join("-");
	}

	static matches(
		event: EventPayload,
		id: string,
		renderer: NativeRenderer
	): boolean {
		if (event.isHeld) return false;

		const command = keybindCommands.find((item) => item.id === id);
		const key = this.fromEvent(event);

		return (
			!!command &&
			key !== null &&
			this.bindings(command, windows.get(renderer) ?? {}).includes(key)
		);
	}

	static format(binding: string): string {
		const parts = bindingPattern.exec(binding)?.groups;
		const key = parts?.key ?? binding;

		const prefix = (parts?.prefix ?? "")
			.split("-")
			.filter(Boolean)
			.map((modifier) => symbols[modifier])
			.join("");

		return `${prefix}${symbols[key] ?? key.toUpperCase()}`;
	}

	static error(
		overrides: KeybindOverrides,
		id: string,
		binding: string
	): string | null {
		const command = keybindCommands.find((item) => item.id === id);
		const match = bindingPattern.exec(binding);
		const prefix = match?.groups?.prefix ?? "";
		const key = match?.groups?.key ?? "";
		const pressed = prefix.split("-").filter(Boolean);

		const canonical = [
			...modifiers.filter((modifier) => pressed.includes(modifier)),
			key,
		].join("-");

		if (!command || !keyPattern.test(key) || canonical !== binding)
			return "Choose a supported key combination.";

		if (command.fixed)
			return "This shortcut follows the macOS Settings menu and cannot be changed.";

		if (
			binding !== command.key &&
			!pressed.some((modifier) => modifier !== "shift")
		)
			return "Include Command, Control, or Option so typing and navigation keep working.";

		if (reserved.has(binding) && binding !== command.key)
			return "This shortcut is reserved for macOS or text editing.";

		const conflict = keybindCommands.find(
			(item) =>
				item.id !== id && this.bindings(item, overrides).includes(binding)
		);

		return conflict ? `Already used by ${conflict.label}.` : null;
	}

	static parse(value: unknown): KeybindOverrides {
		if (typeof value !== "object" || value === null || Array.isArray(value))
			return {};

		const overrides: Record<string, string> = {};

		for (const command of keybindCommands) {
			const binding: unknown = Reflect.get(value, command.id);

			if (typeof binding === "string" && binding !== command.key)
				overrides[command.id] = binding;
		}

		for (const [id, binding] of Object.entries(overrides)) {
			if (this.error(overrides, id, binding)) return {};
		}

		return overrides;
	}
}
