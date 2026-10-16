import { MachineLocation } from "../../machines/machine-location";
import { Button } from "@1git/gpuix-ui/button";
import { radius, spacing, typography } from "@1git/design-tokens";
import type { EventPayload } from "@gpuix/react";
import { useAppTheme } from "../../../styles/theme";
import type { RepositoryFolderGroup } from "../../repository-discovery/repository-library";

/** A physical scan folder, never a move/delete operation on the filesystem. */
export function RepositoryFolderTile({
	group,
	status,
	onOpen,
	onMenu,
}: {
	group: RepositoryFolderGroup;
	status?: string;
	onOpen: () => void;
	onMenu: (event: EventPayload) => void;
}) {
	const { tokens } = useAppTheme();

	return (
		<Button
			testId={`welcome-folder-${group.id}`}
			tokens={tokens}
			variant="ghost"
			aria-label={`Open ${group.name}, ${group.paths.length} ${group.paths.length === 1 ? "repository" : "repositories"}`}
			aria-description={
				group.path
					? `${MachineLocation.display(group.path)}. Right-click for folder actions.`
					: "Repositories outside your added folders."
			}
			onPress={onOpen}
			onContextMenu={group.path ? onMenu : undefined}
			style={{
				flexDirection: "column",
				alignItems: "flex-start",
				justifyContent: "flex-start",
				width: 200,
				flexGrow: 1,
				flexBasis: 180,
				minWidth: 150,
				maxWidth: 280,
				height: 146,
				padding: spacing[4],
				gap: spacing[2],
				borderWidth: 1,
				borderColor: tokens.colors.border,
				borderRadius: radius.lg,
			}}
		>
			<svg
				aria-hidden
				source='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 40"><path d="M3 12V7a3 3 0 0 1 3-3h11l5 6h20a3 3 0 0 1 3 3v20a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V12Z" fill="currentColor" fill-opacity=".12" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M3 13h42" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'
				style={{
					width: 36,
					height: 30,
					color: tokens.colors.onAccent,
					pointerEvents: "none",
				}}
			/>
			<text
				style={{
					...typography.md,
					color: tokens.colors.text,
					whiteSpace: "nowrap",
					textOverflow: "ellipsis",
					width: "100%",
				}}
			>
				{group.name}
			</text>
			<text
				testId={`welcome-folder-count-${group.id}`}
				style={{ ...typography.sm, color: tokens.colors.textMuted }}
			>
				{status === "scanning"
					? "Scanning…"
					: status === "unavailable"
						? "Folder unavailable"
						: `${group.paths.length} ${group.paths.length === 1 ? "repository" : "repositories"}`}
			</text>
			{group.path ? (
				<text
					style={{
						...typography.xs,
						color: tokens.colors.textMuted,
						whiteSpace: "nowrap",
						textOverflow: "ellipsis",
						width: "100%",
					}}
				>
					{MachineLocation.display(group.path)}
				</text>
			) : null}
		</Button>
	);
}
