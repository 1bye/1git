import { createContext, useContext } from "react";
import type { UiTokens } from "@1git/gpuix-ui/tokens";
import type { RepositoryPattern } from "../feature/repository-appearance/repository-patterns";
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
	readonly repositoryColor?: string;
	readonly repositoryPattern?: RepositoryPattern;
	readonly repositoryPatternSeed?: number;
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
		readonly smoothTransitions?: boolean;
		readonly setSmoothTransitions?: (enabled: boolean) => void;
	}
>({ ...appThemes.light, commitTypeBadges: true });

/** All consumers follow the owning window; switching appearance never remounts its workspaces. */
export function useAppTheme() {
	return useContext(AppThemeContext);
}

/** Evaluate style definitions once per palette, outside scrolling and render hot paths. */
export function createThemedStyles<Styles>(
	factory: (theme: AppTheme) => Styles
): Readonly<Record<AppAppearance, Styles>> & {
	get: (theme: AppTheme) => Styles;
} {
	const light = factory(appThemes.light);
	const dark = factory(appThemes.dark);

	const cache = new WeakMap<AppTheme, Styles>([
		[appThemes.light, light],
		[appThemes.dark, dark],
	]);

	return {
		light,
		dark,
		get(theme) {
			const existing = cache.get(theme);

			if (existing !== undefined) return existing;

			const styles = factory(theme);

			cache.set(theme, styles);

			return styles;
		},
	};
}
