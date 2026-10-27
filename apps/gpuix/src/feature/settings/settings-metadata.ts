/** Settings navigation metadata shared by Settings and command surfaces without importing UI modules. */
export type SettingsSection =
	| "application"
	| "spaces"
	| "appearance"
	| "keybinds"
	| "accounts"
	| "privacy"
	| "ai"
	| "git"
	| "editor"
	| "repository-remotes"
	| "repository-ignored-history"
	| "repository-appearance"
	| "repository-identity";

export const settingsPagesMetadata = [
	{ section: "application", label: "Application", group: "application" },
	{ section: "spaces", label: "Spaces", group: "application" },
	{ section: "appearance", label: "Appearance", group: "application" },
	{ section: "keybinds", label: "Keybinds", group: "application" },
	{ section: "privacy", label: "Privacy", group: "application" },
	{ section: "accounts", label: "Accounts", group: "application" },
	{ section: "git", label: "Git", group: "application" },
	{ section: "editor", label: "External editor", group: "application" },
	{ section: "ai", label: "AI", group: "application" },
	{ section: "repository-remotes", label: "Remotes", group: "repository" },
	{
		section: "repository-appearance",
		label: "Appearance",
		group: "repository",
	},
	{
		section: "repository-identity",
		label: "Commit identity",
		group: "repository",
	},
	{
		section: "repository-ignored-history",
		label: "Ignored file history",
		group: "repository",
	},
] as const satisfies readonly {
	readonly section: SettingsSection;
	readonly label: string;
	readonly group: "application" | "repository";
}[];
