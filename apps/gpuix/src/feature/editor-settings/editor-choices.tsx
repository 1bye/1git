import { useAppTheme } from "../../styles/theme";
import { SettingsGroupRow } from "../settings/settings-group";
import { WorkspaceTabIcon } from "../workspace-tabs/components/workspace-tab-icon";
import { EditorApplicationIcon } from "./editor-application-icon";
import type { EditorApplication } from "./external-editors";

/** Keyboard-activatable editor rows for overall defaults and private rule drafts. */
export function EditorChoices({
	applications,
	selected,
	disabled,
	prefix = "editor-choice",
	onChoose,
}: {
	applications: readonly EditorApplication[];
	selected: string | null;
	disabled: boolean;
	prefix?: string;
	onChoose: (path: string | null) => void;
}) {
	const { tokens } = useAppTheme();

	return (
		<div
			role="group"
			aria-label="Editor"
			style={{ display: "flex", flexDirection: "column" }}
		>
			{[
				{ path: null, name: "System default", available: true },
				...applications,
			].map((app, index) => (
				<SettingsGroupRow
					key={app.path ?? "system"}
					testId={`${prefix}-${index}`}
					label={app.name}
					description={!app.available ? "Unavailable" : undefined}
					leading={
						<EditorApplicationIcon
							application={app.path ? { ...app, path: app.path } : undefined}
							testId={`${prefix}-icon-${index}`}
						/>
					}
					selected={selected === app.path}
					aria-description={
						selected === app.path ? "Selected editor" : undefined
					}
					disabled={disabled || !app.available}
					onPress={() => onChoose(app.path)}
					trailing={
						selected === app.path ? (
							<WorkspaceTabIcon name="check" color={tokens.colors.focusRing} />
						) : undefined
					}
				/>
			))}
		</div>
	);
}
