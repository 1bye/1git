import type { RefCallback } from "react";
import { createContext, use } from "react";
import type { LiquidMenuAnchorGeometry } from "../lib/liquid-menu-geometry.js";

export interface LiquidMenuContextValue {
	readonly activeSubmenuId: string | null;
	readonly anchor: () => Element | null;
	readonly anchorGeometry: LiquidMenuAnchorGeometry;
	readonly hasSubmenuSurface: boolean;
	readonly hasSurface: boolean;
	readonly isOpen: boolean;
	readonly isSubmenuOpen: boolean;
	readonly menuElement: HTMLElement | null;
	readonly onPresenceChange: (isPresent: boolean) => void;
	readonly onSubmenuOpenChange: (submenuId: string, isOpen: boolean) => void;
	readonly onSubmenuPresenceChange: (isPresent: boolean) => void;
	readonly outlineWidth: number;
	readonly setMenuElement: RefCallback<HTMLElement>;
	readonly setSubmenuElement: RefCallback<HTMLElement>;
	readonly setSubmenuTriggerElement: RefCallback<HTMLElement>;
	readonly submenuElement: HTMLElement | null;
	readonly submenuTriggerElement: HTMLElement | null;
}

export interface LiquidMenuSubContextValue {
	readonly setContentElement: RefCallback<HTMLElement>;
	readonly setTriggerElement: RefCallback<HTMLElement>;
}

export const LiquidMenuContext = createContext<LiquidMenuContextValue | null>(
	null
);
export const LiquidMenuSubContext =
	createContext<LiquidMenuSubContextValue | null>(null);

export const useLiquidMenuContext = (): LiquidMenuContextValue => {
	const context = use(LiquidMenuContext);
	if (!context) {
		throw new Error(
			"Liquid menu components must be used inside LiquidMenuRoot."
		);
	}
	return context;
};

export const useLiquidMenuSubContext = (): LiquidMenuSubContextValue => {
	const context = use(LiquidMenuSubContext);
	if (!context) {
		throw new Error(
			"Liquid submenu components must be used inside LiquidMenuSub."
		);
	}
	return context;
};
