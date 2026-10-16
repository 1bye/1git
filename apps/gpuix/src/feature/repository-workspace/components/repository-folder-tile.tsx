import { MachineLocation } from "../../machines/machine-location";
import { Button } from "@1git/gpuix-ui/button";
import { radius, spacing, typography } from "@1git/design-tokens";
import type { EventPayload, StyleDesc } from "@gpuix/react";
import { useAppTheme } from "../../../styles/theme";
import type { RepositoryFolderGroup } from "../../repository-discovery/repository-library";

const tileSize: StyleDesc = {
	width: 160,
	flexGrow: 1,
	flexBasis: 160,
	minWidth: 140,
	maxWidth: 180,
	height: 120,
};

const rowSize: StyleDesc = { width: "100%", height: 76 };

/** A physical scan folder, never a move/delete operation on the filesystem. */
export function RepositoryFolderTile({
	group,
	status,
	onOpen,
	onMenu,
	layout = "tiles",
}: {
	group: RepositoryFolderGroup;
	status?: string;
	onOpen: () => void;
	onMenu: (event: EventPayload) => void;
	layout?: "tiles" | "list";
}) {
	const { tokens, colors } = useAppTheme();
	const tiled = layout === "tiles";

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
				...(tiled ? tileSize : rowSize),
				flexDirection: tiled ? "column" : "row",
				alignItems: tiled ? "flex-start" : "center",
				justifyContent: "flex-start",
				padding: tiled ? spacing[3] : spacing[2],
				gap: spacing[2],
				borderWidth: tiled ? 1 : 0,
				borderColor: tokens.colors.border,
				borderRadius: radius.lg,
			}}
		>
			<svg
				aria-hidden
				source='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 40"><path d="M3 12V7a3 3 0 0 1 3-3h11l5 6h20a3 3 0 0 1 3 3v20a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V12Z" fill="currentColor" fill-opacity=".12" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M3 13h42" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'
				style={{
					width: 28,
					height: 24,
					color: colors.brand,
					pointerEvents: "none",
				}}
			/>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: tiled ? spacing[1] : spacing[0.5],
					minWidth: 0,
					width: tiled ? "100%" : undefined,
					flexGrow: tiled ? 0 : 1,
					pointerEvents: "none",
				}}
			>
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
			</div>
		</Button>
	);
}

/** Borderless entry to add a scan folder alongside the saved folders. */
export function RepositoryAddFolderTile({
	layout,
	picking,
	onAdd,
}: {
	layout: "tiles" | "list";
	picking: boolean;
	onAdd: () => void;
}) {
	const { tokens } = useAppTheme();

	return (
		<Button
			testId="discovery-folder"
			tokens={tokens}
			variant="ghost"
			aria-label="Add folder"
			disabled={picking}
			onPress={onAdd}
			style={{
				...(layout === "tiles" ? tileSize : rowSize),
				flexDirection: layout === "tiles" ? "column" : "row",
				alignItems: "center",
				justifyContent: layout === "tiles" ? "center" : "flex-start",
				padding: layout === "tiles" ? spacing[3] : spacing[2],
				gap: spacing[2],
				borderWidth: 0,
				borderRadius: radius.lg,
			}}
		>
			<svg
				aria-hidden
				source='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"><path d="M12 3v18M3 12h18"/></svg>'
				style={{
					width: 24,
					height: 24,
					color: tokens.colors.textMuted,
					pointerEvents: "none",
				}}
			/>
			<text style={{ ...typography.md, color: tokens.colors.textMuted }}>
				{picking ? "Choosing folder…" : "Add folder…"}
			</text>
		</Button>
	);
}
