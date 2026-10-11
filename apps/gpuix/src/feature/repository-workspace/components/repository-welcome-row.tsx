import { useAppTheme } from "../../../styles/theme";
import { spacing, typography, iconSize } from "@1git/design-tokens";
import { basename } from "node:path";
import { useState } from "react";
import { Button } from "@1git/gpuix-ui/button";
import type { EventPayload } from "@gpuix/react";

import { RepositoryAvatar } from "./repository-avatar";

// Phosphor Icons 2.1.10, Light weight, matching the account cards.
// See ../../../../LICENSES/Phosphor-Icons.txt.
const trashIcon =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M216,50H174V40a22,22,0,0,0-22-22H104A22,22,0,0,0,82,40V50H40a6,6,0,0,0,0,12H50V208a14,14,0,0,0,14,14H192a14,14,0,0,0,14-14V62h10a6,6,0,0,0,0-12ZM94,40a10,10,0,0,1,10-10h48a10,10,0,0,1,10,10V50H94ZM194,208a2,2,0,0,1-2,2H64a2,2,0,0,1-2-2V62H194ZM110,104v64a6,6,0,0,1-12,0V104a6,6,0,0,1,12,0Zm48,0v64a6,6,0,0,1-12,0V104a6,6,0,0,1,12,0Z"/></svg>';

/** Keeps transient hover/focus local to one saved-repository row. */
export function RepositoryWelcomeRow({
	path,
	busy,
	onOpen,
	onForget,
	onMenu,
}: {
	path: string;
	busy: boolean;
	onOpen: (path: string) => void;
	onForget: (path: string) => void;
	onMenu: (path: string, event: EventPayload) => Promise<void>;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;

	const [hoverTargets, setHoverTargets] = useState({
		row: false,
		open: false,
		remove: false,
	});

	const [focused, setFocused] = useState<"open" | "remove" | null>(null);
	const visible = Object.values(hoverTargets).some(Boolean) || focused !== null;

	// Native hitboxes do not bubble hover through interactive children.
	const hoverEvents = (target: keyof typeof hoverTargets) => ({
		onMouseEnter: () =>
			setHoverTargets((current) => ({ ...current, [target]: true })),
		onMouseLeave: () =>
			setHoverTargets((current) => ({ ...current, [target]: false })),
	});

	const focusEvents = (target: "open" | "remove") => ({
		onFocus: () => setFocused(target),
		onBlur: () =>
			setFocused((current) => (current === target ? null : current)),
	});

	return (
		<div
			{...hoverEvents("row")}
			testId={`welcome-row-${path}`}
			style={{
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				flexShrink: 0,
				minWidth: 0,
				gap: spacing[1],
			}}
		>
			<Button
				{...hoverEvents("open")}
				{...focusEvents("open")}
				tokens={appTokens}
				variant="ghost"
				testId={`welcome-repository-${path}`}
				aria-label={`Open ${path}`}
				disabled={busy}
				onPress={() => onOpen(path)}
				onContextMenu={(event) => {
					void onMenu(path, event);
				}}
				style={{
					height: 54,
					flexGrow: 1,
					flexBasis: 0,
					minWidth: 0,
					justifyContent: "flex-start",
					paddingLeft: spacing[3],
					gap: spacing[2.5],
				}}
			>
				<RepositoryAvatar
					label={basename(path)}
					source={{ path }}
					testId={`welcome-avatar-${path}`}
				/>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: spacing[0.75],
						minWidth: 0,
						flexGrow: 1,
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
					<text
						testId={`welcome-path-${path}`}
						style={{
							...typography.sm,
							color: appTokens.colors.textMuted,
							whiteSpace: "nowrap",
							textOverflow: "ellipsis",
						}}
					>
						{path}
					</text>
				</div>
			</Button>
			<Button
				{...hoverEvents("remove")}
				{...focusEvents("remove")}
				tokens={appTokens}
				variant="ghost"
				size="sm"
				testId={`welcome-forget-${path}`}
				aria-label={`Remove ${path} from list`}
				aria-description="Removes only the saved entry. Your repository folder is kept."
				disabled={busy}
				onPress={() => onForget(path)}
				style={{
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
					source={trashIcon}
					style={{
						width: iconSize.sm,
						height: iconSize.sm,
						pointerEvents: "none",
						color: appTokens.colors.danger,
					}}
				/>
			</Button>
		</div>
	);
}
