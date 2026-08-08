import { useSyncExternalStore } from "react";

export interface KeyboardModifiers {
	readonly altKey: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly shiftKey: boolean;
}

const NO_KEYBOARD_MODIFIERS: KeyboardModifiers = {
	altKey: false,
	ctrlKey: false,
	metaKey: false,
	shiftKey: false,
};
const modifierListeners = new Set<() => void>();
let keyboardModifiers = NO_KEYBOARD_MODIFIERS;

const modifiersFromEvent = (event: KeyboardEvent): KeyboardModifiers => ({
	altKey: event.altKey,
	ctrlKey: event.ctrlKey,
	metaKey: event.metaKey,
	shiftKey: event.shiftKey,
});

const hasSameModifiers = (
	current: KeyboardModifiers,
	next: KeyboardModifiers
): boolean =>
	current.altKey === next.altKey &&
	current.ctrlKey === next.ctrlKey &&
	current.metaKey === next.metaKey &&
	current.shiftKey === next.shiftKey;

const notifyModifierListeners = (): void => {
	for (const listener of modifierListeners) {
		listener();
	}
};

const setKeyboardModifiers = (nextModifiers: KeyboardModifiers): void => {
	if (hasSameModifiers(keyboardModifiers, nextModifiers)) {
		return;
	}
	keyboardModifiers = nextModifiers;
	notifyModifierListeners();
};

const updateModifiers = (event: KeyboardEvent): void => {
	setKeyboardModifiers(modifiersFromEvent(event));
};

const resetModifiers = (): void => {
	setKeyboardModifiers(NO_KEYBOARD_MODIFIERS);
};

const resetHiddenModifiers = (): void => {
	if (document.visibilityState === "hidden") {
		resetModifiers();
	}
};

const subscribeToKeyboardModifiers = (listener: () => void): (() => void) => {
	modifierListeners.add(listener);
	if (modifierListeners.size === 1) {
		window.addEventListener("keydown", updateModifiers);
		window.addEventListener("keyup", updateModifiers);
		window.addEventListener("blur", resetModifiers);
		document.addEventListener("visibilitychange", resetHiddenModifiers);
	}

	return () => {
		modifierListeners.delete(listener);
		if (modifierListeners.size !== 0) {
			return;
		}
		window.removeEventListener("keydown", updateModifiers);
		window.removeEventListener("keyup", updateModifiers);
		window.removeEventListener("blur", resetModifiers);
		document.removeEventListener("visibilitychange", resetHiddenModifiers);
		keyboardModifiers = NO_KEYBOARD_MODIFIERS;
	};
};

const getKeyboardModifiers = (): KeyboardModifiers => keyboardModifiers;

export const useKeyboardModifiers = (): KeyboardModifiers =>
	useSyncExternalStore(
		subscribeToKeyboardModifiers,
		getKeyboardModifiers,
		getKeyboardModifiers
	);
