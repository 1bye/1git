import { createContext, use, type Dispatch, type SetStateAction } from "react";
import type { KeybindOverrides } from "./keybinds";

/** The active window's shortcut preferences; isolated controls fall back to the standard shortcuts. */
export const KeybindContext = createContext<{
	overrides: KeybindOverrides;
	setOverrides?: Dispatch<SetStateAction<KeybindOverrides>>;
}>({ overrides: {} });

/** Reads current shortcuts for settings and contextual hints in the same render. */
export const useKeybinds = () => use(KeybindContext);
