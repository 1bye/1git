import type { SettingsSection } from "../../accounts/accounts-settings";
import { repositoryColorPresets } from "../../repository-appearance/repository-colors";
import type { NativeMenuItem } from "./native-file-menu";

/** Only explicit menu choices can navigate settings or change the local repository accent. */
export type WorkspaceSettingsChoice =
	| { kind: "settings"; section: SettingsSection }
	| { kind: "color"; color: string | undefined };

/** Featured settings links and a native color submenu, using the same presets as Settings. */
export class WorkspaceSettingsMenu {
	static items(
		color: string | undefined
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
						value: { kind: "settings", section: "repository-appearance" },
					},
				],
			},
			page("Remotes…", "repository-remotes"),
			page("Commit identity…", "repository-identity"),
			{ separator: true },
			page("All Settings…", "accounts"),
		];
	}
}
