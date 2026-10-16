import { useAppTheme } from "../../../styles/theme";
import { spacing, typography, iconSize, radius } from "@1git/design-tokens";
import { MachineLocation } from "../../machines/machine-location";
import { basename } from "node:path";
import { useState, type Ref } from "react";
import { Button } from "@1git/gpuix-ui/button";
import type { EventPayload, PublicInstance } from "@gpuix/react";

import { RepositoryAvatar } from "./repository-avatar";
import { RepositoryOverviewDetails } from "./repository-overview";

// Phosphor Icons 2.1.10, Broom in Light weight, matching the account cards.
// See ../../../../LICENSES/Phosphor-Icons.txt.
const brushIcon =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M234.62,218.6C211.35,207.29,198,183,198,152V134.7a14,14,0,0,0-8.82-13l-24.89-9.83a10,10,0,0,1-5.59-13L180,45.9a26,26,0,0,0-15-34.33c-12.95-4.83-27.88,1.84-33.31,15l-21,53.11a10,10,0,0,1-13,5.61L72.37,75a13.9,13.9,0,0,0-15.2,3.19C36.49,99.42,26,124.26,26,152a109.53,109.53,0,0,0,30.62,76.16A6,6,0,0,0,61,230H232a6,6,0,0,0,2.62-11.4ZM65.77,86.52a2,2,0,0,1,2.12-.43l25.4,10.29a22,22,0,0,0,28.63-12.32l21-53c3-7.13,11-10.81,18-8.21a14,14,0,0,1,8,18.54l-21.36,53.1A22.05,22.05,0,0,0,159.86,123l24.88,9.83A2,2,0,0,1,186,134.7V152c0,1.34,0,2.65.08,4L52.74,102.61A110.07,110.07,0,0,1,65.77,86.52ZM114.33,218a89.6,89.6,0,0,1-25.5-43.5,6,6,0,1,0-11.62,3A102.87,102.87,0,0,0,97.81,218H63.56A97.56,97.56,0,0,1,38,152a87.42,87.42,0,0,1,8.71-38.86L187.35,169.4c3.15,19.92,11.77,36.66,25,48.6Z"/></svg>';

/** Shared tile dimensions keep the virtual grid aligned with repository cards. */
export const repositoryTileSize = {
	minWidth: 140,
	maxWidth: 160,
	height: 112,
} as const;

/** Keeps transient hover/focus local to one saved-repository row. */
export function RepositoryWelcomeRow({
	path,
	busy,
	suggested = false,
	onOpen,
	onForget,
	onMenu,
	openRef,
	onNavigate,
	deferAvatar = false,
	starred,
	onStar,
	layout = "list",
}: {
	path: string;
	busy: boolean;
	suggested?: boolean;
	onOpen: (path: string) => void;
	onForget: (path: string) => void;
	onMenu: (path: string, event: EventPayload) => Promise<void>;
	openRef?: Ref<PublicInstance>;
	onNavigate?: (event: EventPayload) => void;
	deferAvatar?: boolean;
	starred: boolean;
	onStar: (path: string) => void;
	layout?: "tiles" | "list";
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;
	const tiled = layout === "tiles";

	const [hoverTargets, setHoverTargets] = useState({
		row: false,
		open: false,
		remove: false,
		star: false,
	});

	const [focused, setFocused] = useState<"open" | "remove" | "star" | null>(
		null
	);

	const visible = Object.values(hoverTargets).some(Boolean) || focused !== null;

	// Native hitboxes do not bubble hover through interactive children.
	const hoverEvents = (target: keyof typeof hoverTargets) => ({
		onMouseEnter: () =>
			setHoverTargets((current) => ({ ...current, [target]: true })),
		onMouseLeave: () =>
			setHoverTargets((current) => ({ ...current, [target]: false })),
	});

	const focusEvents = (target: "open" | "remove" | "star") => ({
		onFocus: () => setFocused(target),
		onBlur: () =>
			setFocused((current) => (current === target ? null : current)),
	});

	return (
		<div
			{...hoverEvents("row")}
			testId={`welcome-row-${path}`}
			style={{
				position: "relative",
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				flexShrink: 0,
				minWidth: 0,
				width: tiled ? undefined : "100%",
				...(tiled
					? {
							width: repositoryTileSize.minWidth,
							flexGrow: 1,
							flexBasis: repositoryTileSize.minWidth,
							minWidth: repositoryTileSize.minWidth,
							maxWidth: repositoryTileSize.maxWidth,
							height: repositoryTileSize.height,
							borderWidth: 1,
							borderColor: appTokens.colors.border,
						}
					: {}),
				gap: spacing[1],
				paddingRight: tiled ? 0 : spacing[2],
				borderRadius: radius.md,
				backgroundColor:
					!busy && visible ? appTokens.colors.surface : "transparent",
			}}
		>
			<Button
				ref={openRef}
				onKeyDown={onNavigate}
				{...hoverEvents("open")}
				{...focusEvents("open")}
				tokens={appTokens}
				variant="ghost"
				testId={`welcome-repository-${path}`}
				aria-label={`Open ${path}`}
				aria-description={
					suggested
						? "Found on this Mac. Open to add to your repositories."
						: undefined
				}
				disabled={busy}
				onPress={() => onOpen(path)}
				onContextMenu={(event) => {
					void onMenu(path, event);
				}}
				style={{
					height: tiled ? "100%" : 54,
					flexDirection: tiled ? "column" : "row",
					alignItems: tiled ? "flex-start" : "center",
					flexGrow: 1,
					flexBasis: 0,
					minWidth: 0,
					justifyContent: "flex-start",
					paddingTop: tiled ? spacing[3] : 0,
					paddingBottom: tiled ? spacing[3] : 0,
					paddingLeft: spacing[3],
					gap: tiled ? spacing[2] : spacing[2.5],
					hover: { backgroundColor: "transparent" },
				}}
			>
				<RepositoryAvatar
					size={tiled ? 20 : undefined}
					label={basename(path)}
					source={{ path }}
					deferred={deferAvatar}
					testId={`welcome-avatar-${path}`}
				/>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: tiled ? spacing[1] : spacing[0.75],
						minWidth: 0,
						flexGrow: tiled ? 0 : 1,
						...(tiled ? { width: "100%" } : {}),
						pointerEvents: "none",
					}}
				>
					<text
						testId={`welcome-name-${path}`}
						style={{
							...typography.md,
							color: appTokens.colors.text,
							whiteSpace: "nowrap",
							textOverflow: "ellipsis",
						}}
					>
						{basename(path)}
					</text>
					{tiled ? null : (
						<text
							testId={`welcome-path-${path}`}
							style={{
								...typography.sm,
								color: appTokens.colors.textMuted,
								whiteSpace: "nowrap",
								textOverflow: "ellipsis",
							}}
						>
							{MachineLocation.display(path)}
						</text>
					)}
					{tiled ? (
						<RepositoryOverviewDetails path={path} layout="tiles" />
					) : null}
				</div>
				{tiled ? null : (
					<div
						style={{
							width: 145,
							minWidth: 0,
							flexShrink: 0,
							pointerEvents: "none",
						}}
					>
						<RepositoryOverviewDetails path={path} />
					</div>
				)}
			</Button>
			<Button
				onKeyDown={onNavigate}
				{...hoverEvents("star")}
				{...focusEvents("star")}
				tokens={appTokens}
				variant="ghost"
				size="sm"
				testId={`welcome-star-${path}`}
				aria-label={`${starred ? "Unstar" : "Star"} ${path}`}
				disabled={busy}
				onPress={() => onStar(path)}
				style={{
					...(tiled
						? { position: "absolute", top: spacing[2.5], right: spacing[2] }
						: {}),
					width: 26,
					height: 26,
					paddingLeft: 0,
					paddingRight: 0,
					opacity: starred || visible ? 1 : 0,
				}}
			>
				<svg
					aria-hidden
					source={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" fill="${starred ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>`}
					style={{
						width: iconSize.sm,
						height: iconSize.sm,
						pointerEvents: "none",
						color: starred ? theme.colors.brand : appTokens.colors.textMuted,
					}}
				/>
			</Button>
			<Button
				onKeyDown={onNavigate}
				{...hoverEvents("remove")}
				{...focusEvents("remove")}
				tokens={appTokens}
				variant="ghost"
				size="sm"
				testId={`welcome-forget-${path}`}
				aria-label={`Remove ${path} from list`}
				aria-description={
					suggested
						? "Hides this suggestion. Your repository folder is kept."
						: "Removes only the saved entry. Your repository folder is kept."
				}
				disabled={busy}
				onPress={() => onForget(path)}
				style={{
					...(tiled
						? { position: "absolute", top: spacing[2.5], right: 36 }
						: {}),
					width: 26,
					height: 26,
					paddingLeft: spacing[0],
					paddingRight: spacing[0],
					opacity: visible ? 1 : 0,
					visibility: busy && !visible ? "hidden" : "visible",
				}}
			>
				<svg
					testId={`welcome-forget-icon-${path}`}
					aria-hidden
					source={brushIcon}
					style={{
						width: iconSize.sm,
						height: iconSize.sm,
						pointerEvents: "none",
						color: appTokens.colors.textMuted,
					}}
				/>
			</Button>
		</div>
	);
}
