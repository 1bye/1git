import { Keybinds, type KeybindOverrides } from "../keybinds/keybinds";
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
	| "new-tab"
	| "close-tab"
	| "settings"
	| `settings:${SettingsSection}`;

export interface RepositoryPaletteAction {
	readonly id: RepositoryPaletteActionId;
	readonly label: string;
	readonly hint: string;
	readonly enabled: boolean;
	readonly settingsSection?: SettingsSection;
}

interface ActionDefinition {
	readonly id: Exclude<RepositoryPaletteActionId, `settings:${string}`>;
	readonly label: string;
	readonly keybind?: string;
}

const actionDefinitions: readonly ActionDefinition[] = [
	{ id: "fetch", label: "Fetch", keybind: "refresh" },
	{ id: "pull", label: "Pull" },
	{ id: "push", label: "Push" },
	{ id: "new-branch", label: "New branch" },
	{ id: "switch-branch", label: "Switch branch" },
	{ id: "stash", label: "Stash" },
	{ id: "external-editor", label: "Open in external editor" },
	{ id: "finder", label: "Reveal in Finder" },
	{ id: "copy-path", label: "Copy path" },
	{ id: "new-tab", label: "New tab", keybind: "new-tab" },
	{ id: "close-tab", label: "Close tab", keybind: "close-tab" },
	{ id: "settings", label: "Open Settings", keybind: "settings" },
];

export interface RepositoryPaletteActionContext {
	readonly hasRepository: boolean;
	readonly canFetch: boolean;
	readonly canBranch: boolean;
	readonly canSynchronize: boolean;
	readonly canStash: boolean;
	readonly canReveal: boolean;
	readonly canClose: boolean;
}

/** The command-palette registry is shared by rendering and dispatch, so labels and hints cannot drift. */
export function repositoryPaletteActions(
	overrides: KeybindOverrides,
	context: RepositoryPaletteActionContext
): readonly RepositoryPaletteAction[] {
	const actions = actionDefinitions.map((definition) => ({
		id: definition.id,
		label: definition.label,
		hint: definition.keybind
			? Keybinds.label(definition.keybind, overrides)
			: "",
		enabled:
			definition.id === "new-tab" || definition.id === "settings"
				? true
				: definition.id === "close-tab"
					? context.canClose
					: definition.id === "finder"
						? context.canReveal
						: definition.id === "external-editor"
							? context.canReveal
							: definition.id === "stash"
								? context.canStash
								: definition.id === "pull" || definition.id === "push"
									? context.canSynchronize
									: definition.id === "fetch"
										? context.canFetch
										: definition.id === "new-branch" ||
											  definition.id === "switch-branch"
											? context.canBranch
											: context.hasRepository,
	})) satisfies readonly RepositoryPaletteAction[];

	return [
		...actions,
		...settingsPagesMetadata.map((page) => ({
			id: `settings:${page.section}` as const,
			label: `Settings · ${page.group === "repository" ? "Repository " : ""}${page.label}`,
			hint: "",
			enabled: page.group === "application" || context.hasRepository,
			settingsSection: page.section,
		})),
	];
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
