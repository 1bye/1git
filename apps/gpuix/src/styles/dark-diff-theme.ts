import type { GpuixTheme } from "@gpuix/react";
import { appControlTokens } from "./tokens";

/** GitHub Dark Default token roles; diff backgrounds, metrics and selection stay independent. */
export const darkDiffTheme: GpuixTheme & { diffInclusionText: string } = {
	appearance: "dark",
	border: "#343841",
	text: "#e6edf3",
	textMuted: "#a4acb7",
	textFaint: "#8e96a3",
	accent: appControlTokens.dark.colors.accent,
	diffInclusionText: appControlTokens.dark.colors.onAccent,
	diffAdd: "#e6edf3",
	diffDel: "#e6edf3",
	diffAddBg: "#25392d",
	diffDelBg: "#422a30",
	diffAddWordBg: "#365940",
	diffDelWordBg: "#703b46",
	diffHunkBg: "#25282f",
	// https://github.com/primer/github-vscode-theme/blob/main/src/theme.js
	// Native kinds merge language-specific scopes; comments use a brighter Primer gray for changed-row contrast.
	syntax: {
		comment: "#b1bac4",
		keyword: "#ff7b72",
		string: "#a5d6ff",
		stringSpecial: "#a5d6ff",
		escape: "#ff7b72",
		number: "#79c0ff",
		boolean: "#79c0ff",
		typeName: "#ffa657",
		typeBuiltin: "#79c0ff",
		constructor: "#ffa657",
		function: "#d2a8ff",
		functionBuiltin: "#79c0ff",
		macroName: "#d2a8ff",
		property: "#e6edf3",
		constant: "#79c0ff",
		variable: "#e6edf3",
		variableSpecial: "#79c0ff",
		parameter: "#e6edf3",
		operator: "#ff7b72",
		punctuation: "#e6edf3",
		tag: "#7ee787",
		attribute: "#79c0ff",
		label: "#ffa657",
		invalid: "#ffa198",
	},
};
