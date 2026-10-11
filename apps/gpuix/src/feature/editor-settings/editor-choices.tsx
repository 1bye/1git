import { useAppTheme } from "../../styles/theme";
import { spacing, typography } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";

import { WorkspaceTabIcon } from "../workspace-tabs/components/workspace-tab-icon";
import type { EditorApplication } from "./external-editors";

/** Shared keyboard-activatable application choices for overall defaults and rule drafts. */
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
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;

	return (
		<div
			role="group"
			aria-label="Editor"
			style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}
		>
			{[
				{ path: null, name: "System default", available: true },
				...applications,
			].map((app, index) => (
				<Button
					key={app.path ?? "system"}
					testId={`${prefix}-${index}`}
					aria-label={app.name}
					aria-description={
						selected === app.path ? "Selected editor" : undefined
					}
					tokens={appTokens}
					size="sm"
					variant={selected === app.path ? "secondary" : "ghost"}
					disabled={disabled || !app.available}
					onPress={() => onChoose(app.path)}
					style={{ justifyContent: "flex-start" }}
				>
					<text
						style={{
							...typography.md,
							color: appTokens.colors.text,
							flexGrow: 1,
							minWidth: 0,
							whiteSpace: "nowrap",
							textOverflow: "ellipsis",
							pointerEvents: "none",
						}}
					>
						{app.name}
					</text>
					{!app.available ? (
						<text
							style={{ ...typography.xs, color: appTokens.colors.textMuted }}
						>
							Unavailable
						</text>
					) : null}
					{selected === app.path ? (
						<WorkspaceTabIcon name="check" color={appTokens.colors.accent} />
					) : null}
				</Button>
			))}
		</div>
	);
}
