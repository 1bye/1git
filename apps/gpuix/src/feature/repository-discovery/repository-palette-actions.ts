import type { WorkspaceTabIconName } from "../workspace-tabs/components/workspace-tab-icon";
import {
	keybindCommands,
	Keybinds,
	type KeybindOverrides,
} from "../keybinds/keybinds";
import {
	settingsPagesMetadata,
	type SettingsSection,
} from "../settings/settings-metadata";

export type RepositoryPaletteActionId =
	| "fetch"
	| "pull"
	| "push"
	| "new-branch"
	| "switch-branch"
	| "stash"
	| "external-editor"
	| "finder"
	| "copy-path"
	| "install-launcher"
	| "uninstall-launcher"
	| "new-tab"
	| "close-tab"
	| "settings"
	| `settings:${SettingsSection}`;

export interface RepositoryPaletteAction {
	readonly id: RepositoryPaletteActionId;
	readonly label: string;
	readonly icon: WorkspaceTabIconName;
	readonly hint: string;
	readonly enabled: boolean;
	readonly settingsSection?: SettingsSection;
}

interface ActionDefinition {
	readonly group?: "application" | "repository";
	readonly id: Exclude<RepositoryPaletteActionId, `settings:${string}`>;
	readonly label: string;
	readonly icon: WorkspaceTabIconName;
	readonly keybind?: string;
	readonly hint?: string;
}

const actionDefinitions: readonly ActionDefinition[] = [
	{
		id: "settings",
		icon: "settings",
		group: "application",
		label: "Open Settings",
		keybind: "settings",
	},
	{
		id: "new-tab",
		icon: "add",
		group: "application",
		label: "New tab",
		keybind: "new-tab",
	},
	{
		id: "close-tab",
		icon: "close",
		group: "application",
		label: "Close tab",
		keybind: "close-tab",
	},
	{ id: "fetch", icon: "sync", label: "Fetch", keybind: "refresh" },
	{ id: "pull", icon: "pull", label: "Pull" },
	{ id: "push", icon: "push", label: "Push" },
	{ id: "new-branch", icon: "branch", label: "New branch" },
	{ id: "switch-branch", icon: "branch", label: "Switch branch" },
	{ id: "stash", icon: "archive", label: "Stash" },
	{ id: "external-editor", icon: "pencil", label: "Open in external editor" },
	{ id: "finder", icon: "folder", label: "Reveal in Finder" },
	{ id: "copy-path", icon: "copy", label: "Copy path" },
	{
		id: "install-launcher",
		icon: "terminal",
		group: "application",
		label: "Install 1git command",
		hint: "Packaged app only",
	},
	{
		id: "uninstall-launcher",
		icon: "terminal",
		group: "application",
		label: "Uninstall 1git command",
		hint: "Packaged app only",
	},
];

function isActionEnabled(
	id: ActionDefinition["id"],
	context: RepositoryPaletteActionContext
): boolean {
	switch (id) {
		case "new-tab":
		case "settings":
			return true;
		case "install-launcher":
		case "uninstall-launcher":
			return context.launcherAvailable === true;
		case "close-tab":
			return context.canClose;
		case "external-editor":
		case "finder":
			return context.canReveal;
		case "stash":
			return context.canStash;
		case "pull":
		case "push":
			return context.canSynchronize;
		case "fetch":
			return context.canFetch;
		case "new-branch":
		case "switch-branch":
			return context.canBranch;
		case "copy-path":
			return context.canReveal;
	}
}

function commandLabel(id: string, fallback: string): string {
	return (
		keybindCommands.find((command) => command.id === id)?.label ?? fallback
	);
}

export interface RepositoryPaletteActionContext {
	readonly hasRepository: boolean;
	readonly canFetch: boolean;
	readonly canBranch: boolean;
	readonly canSynchronize: boolean;
	readonly canStash: boolean;
	readonly canReveal: boolean;
	readonly canClose: boolean;
	readonly launcherAvailable?: boolean;
}

/** The command-palette registry is shared by rendering and dispatch, so labels and hints cannot drift. */
export function repositoryPaletteActions(
	overrides: KeybindOverrides,
	context: RepositoryPaletteActionContext
): readonly RepositoryPaletteAction[] {
	return (["application", "repository"] as const).flatMap((group) => {
		const actions = actionDefinitions
			.filter((definition) => (definition.group ?? "repository") === group)
			.map((definition) => ({
				icon: definition.icon,
				id: definition.id,
				label: definition.keybind
					? commandLabel(definition.keybind, definition.label)
					: definition.label,
				hint: definition.keybind
					? Keybinds.label(definition.keybind, overrides)
					: (definition.hint ?? ""),
				enabled: isActionEnabled(definition.id, context),
			})) satisfies readonly RepositoryPaletteAction[];

		return [
			...actions,
			...settingsPagesMetadata
				.filter((page) => page.group === group)
				.map((page) => ({
					icon: page.icon,
					id: `settings:${page.section}` as const,
					label: `Settings · ${page.group === "repository" ? "Repository " : ""}${page.label}`,
					hint: "",
					enabled: page.group === "application" || context.hasRepository,
					settingsSection: page.section,
				})),
		];
	});
}

/** Action search intentionally mirrors repository search while keeping disabled commands visible. */
export function searchRepositoryPaletteActions(
	actions: readonly RepositoryPaletteAction[],
	query: string
): readonly RepositoryPaletteAction[] {
	const words = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);

	if (!words.length) return actions;

	return actions
		.flatMap((action, order) => {
			const text = `${action.label} ${action.id}`.toLocaleLowerCase();
			let score = 0;

			for (const word of words) {
				if (action.label.toLocaleLowerCase() === word) score += 100;
				else if (action.label.toLocaleLowerCase().startsWith(word)) score += 60;
				else if (text.includes(word)) score += 40;
				else return [];
			}

			return [{ action, score, order }];
		})
		.sort((left, right) => right.score - left.score || left.order - right.order)
		.map(({ action }) => action);
}
