import { createContext, use } from "react";
import type {
	CommandLensHintLayout,
	CommandLensPlacement,
} from "@/feature/command-lens/lib/command-lens-geometry.js";
import type { CommandLensNavigationOrientation } from "@/feature/command-lens/lib/command-lens-navigation.js";
import type { CommandLensCommand } from "@/feature/command-lens/lib/command-lens-shortcut.js";

export interface CommandLensTargetOptions {
	readonly commands: readonly CommandLensCommand[];
	readonly disabled?: boolean;
	readonly highlightInsetBlock?: number;
	readonly highlightInsetInline?: number;
	readonly highlightOutset?: number;
	readonly hintLayout?: CommandLensHintLayout;
	readonly id: string;
	readonly navigationDefault?: boolean;
	readonly navigationGroup?: string;
	readonly navigationOrder?: number;
	readonly navigationOrientation?: CommandLensNavigationOrientation;
	readonly placement?: CommandLensPlacement;
	readonly plainArrowNavigation?: boolean;
	readonly radius?: number;
}

export interface CommandLensTargetSource extends CommandLensTargetOptions {
	readonly element: HTMLElement | null;
}

export type CommandLensTargetReader = () => CommandLensTargetSource;

export interface CommandLensContextValue {
	readonly refreshTarget: (id: string, revision: string) => void;
	readonly registerTarget: (
		id: string,
		readTarget: CommandLensTargetReader
	) => () => void;
	readonly requestMeasurement: () => void;
}

export const CommandLensContext = createContext<CommandLensContextValue | null>(
	null
);

export const useCommandLensContext = (): CommandLensContextValue => {
	const context = use(CommandLensContext);
	if (!context) {
		throw new Error(
			"Command Lens targets must be used inside CommandLensProvider."
		);
	}
	return context;
};
