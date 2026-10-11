import { createContext, useContext } from "react";
import type { UiTokens } from "@1git/gpuix-ui/tokens";
import {
	appColors,
	appControlTokens,
	type AppAppearance,
	type AppColors,
} from "./tokens";

/** A complete palette for one window, shared by application views and native controls. */
export interface AppTheme {
	readonly appearance: AppAppearance;
	readonly colors: AppColors;
	readonly tokens: UiTokens;
}

export const appThemes: Readonly<Record<AppAppearance, AppTheme>> = {
	light: {
		appearance: "light",
		colors: appColors.light,
		tokens: appControlTokens.light,
	},
	dark: {
		appearance: "dark",
		colors: appColors.dark,
		tokens: appControlTokens.dark,
	},
};

export const AppThemeContext = createContext<
	AppTheme & {
		readonly setAppearance?: (appearance: AppAppearance) => void;
		readonly commitTypeBadges: boolean;
		readonly setCommitTypeBadges?: (enabled: boolean) => void;
	}
>({ ...appThemes.light, commitTypeBadges: true });

/** All consumers follow the owning window; switching appearance never remounts its workspaces. */
export function useAppTheme() {
	return useContext(AppThemeContext);
}

/** Evaluate style definitions once per palette, outside scrolling and render hot paths. */
export function createThemedStyles<Styles>(
	factory: (theme: AppTheme) => Styles
): Readonly<Record<AppAppearance, Styles>> {
	return { light: factory(appThemes.light), dark: factory(appThemes.dark) };
}
