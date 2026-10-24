import type { SettingsSection } from "../../accounts/accounts-settings";
import { repositoryColorPresets } from "../../repository-appearance/repository-colors";
import {
	repositoryPatternPresets,
	type RepositoryPattern,
	type RepositoryAppearanceSection,
} from "../../repository-appearance/repository-patterns";
import type { NativeMenuItem } from "./native-file-menu";

/** Only explicit menu choices can navigate settings or change the local repository accent. */
export type WorkspaceSettingsChoice =
	| { kind: "settings"; section: SettingsSection }
	| { kind: "appearance"; section: RepositoryAppearanceSection }
	| { kind: "color"; color: string | undefined }
	| { kind: "pattern"; pattern: RepositoryPattern | undefined };

/** Featured settings links and a native color submenu, using the same presets as Settings. */
export class WorkspaceSettingsMenu {
	static items(
		color: string | undefined,
		pattern?: RepositoryPattern
	): NativeMenuItem<WorkspaceSettingsChoice>[] {
		const page = (
			label: string,
			section: SettingsSection
		): NativeMenuItem<WorkspaceSettingsChoice> => ({
			label,
			enabled: true,
			value: { kind: "settings", section },
		});

		return [
			page("Appearance…", "appearance"),
			page("Accounts…", "accounts"),
			page("Spaces…", "spaces"),
			page("AI…", "ai"),
			{ separator: true },
			{
				label: "Repository color",
				enabled: true,
				children: [
					...repositoryColorPresets.map((preset) => ({
						label: `${color === preset.color ? "✓ " : ""}${preset.name}`,
						enabled: true,
						value: { kind: "color" as const, color: preset.color },
					})),
					{
						label: `${color === undefined ? "✓ " : ""}Default color`,
						enabled: true,
						value: { kind: "color", color: undefined },
					},
					{
						label: "Custom color…",
						enabled: true,
						value: { kind: "appearance", section: "color" },
					},
				],
			},
			{
				label: "Repository pattern",
				enabled: true,
				children: [
					...repositoryPatternPresets.map((preset) => ({
						label: `${pattern === preset.id ? "✓ " : ""}${preset.name}`,
						enabled: true,
						value: { kind: "pattern" as const, pattern: preset.id },
					})),
					{
						label: `${pattern === undefined ? "✓ " : ""}No pattern`,
						enabled: true,
						value: { kind: "pattern", pattern: undefined },
					},
					{
						label: "Choose pattern…",
						enabled: true,
						value: { kind: "appearance", section: "pattern" },
					},
				],
			},
			page("Remotes…", "repository-remotes"),
			page("Commit identity…", "repository-identity"),
			page("Ignored file history…", "repository-ignored-history"),
			{ separator: true },
			page("All Settings…", "accounts"),
		];
	}
}
