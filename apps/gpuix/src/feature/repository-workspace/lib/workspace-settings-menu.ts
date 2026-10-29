import type { SettingsSection } from "../../accounts/accounts-settings";
import type { RepositoryAppearanceSection } from "../../repository-appearance/repository-patterns";
import type { NativeMenuItem } from "./native-file-menu";

/** Explicit destinations for the Settings menu and live repository appearance editor. */
export type WorkspaceSettingsChoice =
	| { kind: "settings"; section: SettingsSection }
	| { kind: "appearance"; section: RepositoryAppearanceSection };

/** Featured Settings links and one entry into live repository customization. */
export class WorkspaceSettingsMenu {
	static items(): NativeMenuItem<WorkspaceSettingsChoice>[] {
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
			page("Help…", "help"),
			{ separator: true },
			{
				label: "Customize appearance…",
				enabled: true,
				value: { kind: "appearance", section: "color" },
			},
			page("Remotes…", "repository-remotes"),
			page("Commit identity…", "repository-identity"),
			page("Ignored file history…", "repository-ignored-history"),
			{ separator: true },
			page("All Settings…", "accounts"),
		];
	}
}
