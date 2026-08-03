export interface CommandLensCommand {
	readonly allowInEditable?: boolean;
	readonly altKey?: boolean;
	readonly key: string;
	readonly label: string;
	readonly onInvoke?: () => Promise<void> | void;
	readonly shiftKey?: boolean;
}

const DIGIT_KEY_PATTERN = /^\d$/;
const LETTER_KEY_PATTERN = /^[a-z]$/i;
const MODIFIER_KEYS = new Set(["Alt", "Control", "Meta", "Shift"]);
const MAXIMUM_NUMBERED_TARGETS = 9;

const normalizeKey = (key: string): string =>
	key.length === 1 ? key.toLocaleLowerCase() : key;

const eventKeyMatches = (
	event: KeyboardEvent,
	command: CommandLensCommand
): boolean => {
	if (
		DIGIT_KEY_PATTERN.test(command.key) &&
		event.code === `Digit${command.key}`
	) {
		return true;
	}
	if (
		event.altKey &&
		LETTER_KEY_PATTERN.test(command.key) &&
		event.code === `Key${command.key.toLocaleUpperCase()}`
	) {
		return true;
	}
	return normalizeKey(event.key) === normalizeKey(command.key);
};

export const isCommandLensModifierKey = (key: string): boolean =>
	MODIFIER_KEYS.has(key);

export const getCommandLensNumberKey = (
	index: number,
	itemCount: number
): string | null => {
	if (index < 0 || index >= itemCount || itemCount <= 0) {
		return null;
	}
	if (index < MAXIMUM_NUMBERED_TARGETS - 1) {
		return String(index + 1);
	}
	if (index === itemCount - 1) {
		return String(MAXIMUM_NUMBERED_TARGETS);
	}
	return null;
};

export const matchesCommandLensCommand = (
	event: KeyboardEvent,
	command: CommandLensCommand
): boolean =>
	event.metaKey &&
	event.altKey === (command.altKey ?? false) &&
	!event.ctrlKey &&
	event.shiftKey === (command.shiftKey ?? false) &&
	eventKeyMatches(event, command);

const visibleKey = (key: string): string => {
	if (key === "ArrowLeft") {
		return "←";
	}
	if (key === "ArrowRight") {
		return "→";
	}
	if (key === "ArrowUp") {
		return "↑";
	}
	if (key === "ArrowDown") {
		return "↓";
	}
	return key.toLocaleUpperCase();
};

export const formatCommandLensCommand = (
	command: CommandLensCommand,
	isOptionActive = false
): readonly string[] => [
	...(command.altKey && !isOptionActive ? ["⌥"] : []),
	...(command.shiftKey ? ["⇧"] : []),
	visibleKey(command.key),
];

export const getCommandLensDisplayCommands = (
	commands: readonly CommandLensCommand[],
	isOptionActive: boolean
): readonly CommandLensCommand[] => {
	const optionCommands = commands.filter((command) => command.altKey);
	if (isOptionActive) {
		return optionCommands;
	}
	const primaryCommands = commands.filter((command) => !command.altKey);
	return primaryCommands.length > 0 ? primaryCommands : optionCommands;
};

export const hasCommandLensOptionMode = (
	commands: readonly CommandLensCommand[]
): boolean =>
	commands.some((command) => command.altKey) &&
	commands.some((command) => !command.altKey);

export const commandLensAriaKeyShortcut = (
	command: CommandLensCommand
): string =>
	[
		"Meta",
		...(command.altKey ? ["Alt"] : []),
		...(command.shiftKey ? ["Shift"] : []),
		command.key,
	].join("+");

export const commandLensCommandSignature = (
	commands: readonly CommandLensCommand[]
): string =>
	commands
		.map(
			(command) =>
				`${commandLensAriaKeyShortcut(command)}:${command.label}:${command.allowInEditable ? "editable" : "standard"}`
		)
		.join("|");
