import type { WorkspaceTabIconName } from "../workspace-tabs/components/workspace-tab-icon";

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
	{
		section: "application",
		icon: "settings",
		label: "Application",
		group: "application",
	},
	{ section: "spaces", icon: "layers", label: "Spaces", group: "application" },
	{
		section: "appearance",
		icon: "contrast",
		label: "Appearance",
		group: "application",
	},
	{
		section: "keybinds",
		icon: "keyboard",
		label: "Keybinds",
		group: "application",
	},
	{
		section: "privacy",
		icon: "shield",
		label: "Privacy",
		group: "application",
	},
	{
		section: "accounts",
		icon: "userCircle",
		label: "Accounts",
		group: "application",
	},
	{ section: "git", icon: "branch", label: "Git", group: "application" },
	{
		section: "editor",
		icon: "pencil",
		label: "External editor",
		group: "application",
	},
	{ section: "ai", icon: "sparkle", label: "AI", group: "application" },
	{
		section: "repository-remotes",
		icon: "network",
		label: "Remotes",
		group: "repository",
	},
	{
		section: "repository-appearance",
		icon: "palette",
		label: "Appearance",
		group: "repository",
	},
	{
		section: "repository-identity",
		icon: "idCard",
		label: "Commit identity",
		group: "repository",
	},
	{
		section: "repository-ignored-history",
		icon: "history",
		label: "Ignored file history",
		group: "repository",
	},
] as const satisfies readonly {
	readonly section: SettingsSection;
	readonly icon: WorkspaceTabIconName;
	readonly label: string;
	readonly group: "application" | "repository";
}[];
