import { OverflowingLabel } from "../../../fixture/overflowing-label";
import { MachineContext } from "../../machines/machine-context";
import { createThemedStyles, useAppTheme } from "../../../styles/theme";
import {
	radius as cornerRadius,
	typography,
	fontWeight,
	spacing,
} from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";
import { Text } from "@1git/gpuix-ui/text";
import { motion, type EventPayload, type PublicInstance } from "@gpuix/react";
import { useContext, useRef, useState, type Ref, type ReactNode } from "react";

import { workspaceLayout as layout } from "../../../styles/workspace-layout";
import { MachineLocation } from "../../machines/machine-location";
import type { WorkspaceTabRecord } from "../lib/workspace-tabs-model";
import { WorkspaceTabIcon } from "./workspace-tab-icon";
import { RepositoryWorkspaceModel } from "../../repository-workspace/lib/repository-workspace-model";
import { RepositoryAvatar } from "../../repository-workspace/components/repository-avatar";

const { tabWidth: width, tabHeight: height, tabRadius: radius } = layout;
// Adjacent tabs each contribute half of the 4px surface gap.
const visualInset = 2;
const surfaceOutset = layout.tabSurfaceOutset;
const shoulder = surfaceOutset + visualInset;
const triggerBorderWidth = 1;
// Curved shoulders extend beyond the visual body without consuming content space.
const surfaceWidth = width + surfaceOutset * 2;
const maxVisibleChangedFiles = 99;
const changeBadgeHeight = 18;

const changeBadgeTones = {
	light: { color: "#80633d", backgroundColor: "#f6f1e8" },
	dark: { color: "#d2ba95", backgroundColor: "#3e372c" },
} as const;

function connectedTabSurface(tabWidth: number, color: string): string {
	const paintedWidth = tabWidth + surfaceOutset * 2;
	const outline = `M0 ${height} Q${shoulder} ${height} ${shoulder} ${height - shoulder} V${radius} Q${shoulder} 0 ${shoulder + radius} 0 H${paintedWidth - shoulder - radius} Q${paintedWidth - shoulder} 0 ${paintedWidth - shoulder} ${radius} V${height - shoulder} Q${paintedWidth - shoulder} ${height} ${paintedWidth} ${height}`;

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${paintedWidth} ${height}"><path d="${outline} Z" fill="${color}"/></svg>`;
}

/** One connected surface moves behind the tab labels while selection remains immediate. */
export function WorkspaceTabSelection({
	id,
	left,
	dragging,
}: {
	id: string;
	left: number;
	dragging: boolean;
}) {
	const theme = useAppTheme();
	const { activeSurface, styles } = themedStyles.get(theme);

	return (
		<svg
			testId={`surface-${id}`}
			source={activeSurface}
			style={styles.surface}
			motion={{
				initial: false,
				animate: { left: left - surfaceOutset },
				transition: { duration: dragging ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] },
			}}
		/>
	);
}

const themedStyles = createThemedStyles(({ colors: appColors, appearance }) => {
	const activeSurface = connectedTabSurface(width, appColors.editorSurface);

	const styles = StyleSheet.create({
		frame: {
			position: "absolute",
			top: 0,
			width,
			height,
			pointerEvents: "none",
		},
		root: { position: "relative", width, height, flexShrink: 0 },
		surface: {
			color: appColors.editorSurface,
			position: "absolute",
			top: 0,
			left: -surfaceOutset,
			width: surfaceWidth,
			height,
			pointerEvents: "none",
		},
		hover: {
			position: "absolute",
			top: 0,
			left: visualInset,
			width: width - visualInset * 2,
			height: layout.tabContentInsetTop * 2 + layout.tabCloseSize,
			borderRadius: radius,
			backgroundColor: appColors.editorHairline,
			pointerEvents: "none",
		},
		content: {
			position: "absolute",
			top: layout.tabContentInsetTop,
			left: visualInset,
			width: width - visualInset * 2,
			height: layout.tabCloseSize,
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			gap: layout.tabContentGap,
			paddingLeft: layout.tabContentInsetInlineStart - triggerBorderWidth,
			paddingRight: layout.tabContentInsetTop,
		},
		trigger: {
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			gap: layout.tabContentGap,
			flexGrow: 1,
			flexShrink: 1,
			minWidth: 0,
			height: layout.tabCloseSize,
			borderWidth: triggerBorderWidth,
			borderColor: "transparent",
			borderRadius: cornerRadius.md,
			cursor: "pointer",
		},
		name: (active: boolean) => ({
			flexShrink: 1,
			minWidth: 0,
			...typography.sm,
			whiteSpace: "nowrap",
			textOverflow: "ellipsis",
			color: active ? appColors.editorInk : appColors.editorMuted,
			fontWeight: fontWeight.medium,
		}),
		branch: {
			flexShrink: 0,
			...typography.sm,
			fontWeight: fontWeight.regular,
			color: appColors.editorMuted,
			whiteSpace: "nowrap",
		},
		trailing: {
			position: "relative",
			width: layout.tabCloseSize,
			height: layout.tabCloseSize,
			flexShrink: 0,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			pointerEvents: "none",
		},
		changeBadge: {
			...changeBadgeTones[appearance],
			height: changeBadgeHeight,
			minWidth: changeBadgeHeight,
			borderRadius: cornerRadius.sm,
			paddingLeft: spacing[1],
			paddingRight: spacing[1],
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			pointerEvents: "none",
		},
		changeCount: {
			...typography["2xs"],
			color: changeBadgeTones[appearance].color,
			fontWeight: fontWeight.semibold,
			pointerEvents: "none",
		},
		close: {
			width: layout.tabCloseSize,
			height: layout.tabCloseSize,
			flexShrink: 0,
			paddingLeft: spacing[0],
			paddingRight: spacing[0],
			hover: { backgroundColor: appColors.editorHairline },
		},
	});

	return { activeSurface, styles };
});

interface WorkspaceTabProps {
	children?: ReactNode;
	menuAvailable?: boolean;
	menuOpen?: boolean;
	onDismissMenu?: () => void;
	tab: WorkspaceTabRecord;
	active: boolean;
	onPointerDown: () => void;
	onTabMouseDown: (event: EventPayload, frame: PublicInstance | null) => void;
	onTabMouseMove: (event: EventPayload) => void;
	onTabMouseUp: (event: EventPayload) => void;
	onCancelDrag: () => void;
	dragging: boolean;
	left: number;
	onMotionComplete: () => void;
	onKeyboardInput: () => void;
	tabRef: Ref<PublicInstance>;
	frameRef?: (instance: PublicInstance | null) => void;
	onActivate: () => void;
	onClose: () => void;
	onNavigate: (key: string) => void;
	onReorder: (key: string) => void;
}

/** Repository-shaped tab with independent activation and close targets. */
export function WorkspaceTab({
	children,
	menuAvailable = false,
	menuOpen = false,
	onDismissMenu,
	tab,
	active,
	onPointerDown,
	onTabMouseDown,
	onTabMouseMove,
	onTabMouseUp,
	onCancelDrag,
	dragging,
	left,
	onMotionComplete,
	onKeyboardInput,
	tabRef,
	frameRef,
	onActivate,
	onClose,
	onNavigate,
	onReorder,
}: WorkspaceTabProps) {
	const machines = useContext(MachineContext);

	const remote = MachineLocation.parse(
		tab.workspace.repository?.root ?? tab.workspace.repositoryPath ?? ""
	);

	const machineName = remote
		? (machines?.name(remote.machineId) ?? "SSH")
		: null;

	const theme = useAppTheme();
	const { tokens: appTokens } = theme;
	const { activeSurface, styles } = themedStyles.get(theme);

	const frame = useRef<PublicInstance>(null);
	const [focused, setFocused] = useState(false);
	const [closeFocused, setCloseFocused] = useState(false);

	const [hoverTargets, setHoverTargets] = useState({
		slot: false,
		drag: false,
		trigger: false,
		close: false,
	});

	const hovered = Object.values(hoverTargets).some(Boolean);
	const spaceArmed = useRef(false);
	const repositoryLabel = tab.branch ? `${tab.name} / ${tab.branch}` : tab.name;

	const label = machineName
		? `${repositoryLabel} · ${machineName}`
		: repositoryLabel;

	// The retained Changes snapshot also refreshes for inactive tabs; no extra Git reads.
	const changedFiles = tab.workspace.entries.changes.length;
	const changedFilesLabel = `${changedFiles} changed ${changedFiles === 1 ? "file" : "files"}`;
	const revealClose = hovered || focused || closeFocused;
	const changeBadgeOpacity = active ? 1 : 0.65;

	const instructions = menuAvailable
		? "Click the active tab or press Enter or Down for branches. Drag to reorder, or press Shift+Left or Shift+Right."
		: "Drag to reorder, or press Shift+Left or Shift+Right.";

	const onMouseDown = (event: EventPayload): void => {
		onTabMouseDown(event, frame.current);
	};

	// GPUIX hitboxes do not bubble hover through interactive children.
	const hoverEvents = (target: keyof typeof hoverTargets) => ({
		onMouseEnter: () =>
			setHoverTargets((current) => ({ ...current, [target]: true })),
		onMouseLeave: () =>
			setHoverTargets((current) => ({ ...current, [target]: false })),
	});

	const onKeyDown = (event: EventPayload): void => {
		onKeyboardInput();

		if (event.key === "escape") {
			onDismissMenu?.();
			onCancelDrag();

			return;
		}

		if (event.modifiers?.cmd || event.modifiers?.ctrl || event.modifiers?.alt)
			return;

		if (
			event.modifiers?.shift &&
			(event.key === "left" || event.key === "right")
		) {
			onReorder(event.key);

			return;
		}

		if (
			event.key === "left" ||
			event.key === "right" ||
			event.key === "home" ||
			event.key === "end"
		) {
			onNavigate(event.key);

			return;
		}

		if (event.isHeld) return;

		if (
			event.key === "enter" ||
			(event.key === "down" && active && menuAvailable)
		)
			onActivate();

		if (event.key === "space") spaceArmed.current = true;

		if (event.key === "backspace" || event.key === "delete") onClose();
	};

	return (
		<motion.div
			ref={(instance) => {
				frame.current = instance;
				frameRef?.(instance);
			}}
			style={styles.frame}
			initial={false}
			animate={{ left }}
			transition={{ duration: dragging ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
			onMotionComplete={onMotionComplete}
		>
			<div
				testId={`slot-${tab.id}`}
				style={styles.root}
				{...hoverEvents("slot")}
			>
				<div
					testId={`drag-${tab.id}`}
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						width:
							width -
							visualInset -
							layout.tabContentInsetTop -
							layout.tabCloseSize,
						height,
						cursor: dragging ? "grabbing" : "grab",
					}}
					onMouseDown={onMouseDown}
					onMouseMove={onTabMouseMove}
					onMouseUp={onTabMouseUp}
					onClick={onActivate}
					{...hoverEvents("drag")}
				/>
				{active && !theme.smoothTransitions ? (
					<svg
						testId={`surface-${tab.id}`}
						source={activeSurface}
						style={styles.surface}
					/>
				) : null}
				<div
					testId={`hover-${tab.id}`}
					style={StyleSheet.compose(styles.hover, {
						opacity: !active && hovered && !dragging ? 1 : 0,
					})}
				/>
				<div
					testId={`content-${tab.id}`}
					style={StyleSheet.compose(styles.content, { pointerEvents: "none" })}
				>
					<div
						ref={tabRef}
						testId={tab.id}
						role="tab"
						aria-label={label}
						aria-description={`${changedFilesLabel}. ${instructions}`}
						aria-expanded={menuAvailable ? menuOpen : undefined}
						aria-selected={active}
						tabIndex={active ? 0 : -1}
						style={StyleSheet.compose(styles.trigger, {
							cursor: dragging ? "grabbing" : "grab",
							userSelect: "none",
						})}
						onClick={onActivate}
						onMouseDown={onMouseDown}
						onMouseMove={onTabMouseMove}
						onMouseUp={onTabMouseUp}
						{...hoverEvents("trigger")}
						onKeyDown={onKeyDown}
						onKeyUp={(event) => {
							if (event.key !== "space") return;

							const activate = spaceArmed.current;

							spaceArmed.current = false;

							if (activate) onActivate();
						}}
						onFocus={() => setFocused(true)}
						onBlur={() => {
							onCancelDrag();
							spaceArmed.current = false;
							setFocused(false);
						}}
					>
						<WorkspaceTabLabel
							tab={tab}
							active={active}
							id={tab.id}
							reveal={(hovered || focused) && !dragging && !menuOpen}
						/>
					</div>
					<div testId={`trailing-${tab.id}`} style={styles.trailing}>
						{changedFiles > 0 ? (
							<div
								testId={`changed-files-${tab.id}`}
								aria-hidden
								style={StyleSheet.compose(styles.changeBadge, {
									opacity: revealClose ? 0 : changeBadgeOpacity,
								})}
							>
								<text
									testId={`changed-files-count-${tab.id}`}
									style={styles.changeCount}
								>
									{changedFiles > maxVisibleChangedFiles ? "99+" : changedFiles}
								</text>
							</div>
						) : null}
						<Button
							testId={`close-${tab.id}`}
							aria-label={`Close ${label}`}
							disabled={RepositoryWorkspaceModel.isBusy(tab.workspace)}
							tokens={appTokens}
							variant="ghost"
							size="sm"
							onMouseDown={onPointerDown}
							onKeyDown={onKeyboardInput}
							onFocus={() => setCloseFocused(true)}
							onBlur={() => setCloseFocused(false)}
							tabIndex={active ? 0 : -1}
							onPress={onClose}
							{...hoverEvents("close")}
							style={StyleSheet.compose(styles.close, {
								position: "absolute",
								top: 0,
								left: 0,
								opacity: revealClose || (active && changedFiles === 0) ? 1 : 0,
							})}
						>
							<WorkspaceTabIcon name="close" testId={`close-icon-${tab.id}`} />
						</Button>
					</div>
				</div>
				{children}
			</div>
		</motion.div>
	);
}

function WorkspaceTabLabel({
	tab,
	active,
	id,
	reveal = false,
}: {
	tab: WorkspaceTabRecord;
	active: boolean;
	id: string;
	reveal?: boolean;
}) {
	const machines = useContext(MachineContext);

	const remote = MachineLocation.parse(
		tab.workspace.repository?.root ?? tab.workspace.repositoryPath ?? ""
	);

	const machineName = remote
		? (machines?.name(remote.machineId) ?? "SSH")
		: null;

	const theme = useAppTheme();
	const { tokens: appTokens } = theme;
	const { styles } = themedStyles.get(theme);

	return (
		<>
			<RepositoryAvatar
				testId={`avatar-${id}`}
				label={tab.name}
				size={layout.tabAvatarSize}
				source={
					tab.workspace.repository?.root || tab.workspace.repositoryPath
						? {
								path:
									tab.workspace.repository?.root ??
									tab.workspace.repositoryPath ??
									"",
							}
						: undefined
				}
			/>
			<OverflowingLabel
				testId={`label-${id}`}
				reveal={reveal}
				contentKey={JSON.stringify([tab.name, machineName, tab.branch])}
			>
				<Text
					testId={`name-${id}`}
					tokens={appTokens}
					style={StyleSheet.compose(styles.name(active), {
						flexShrink: 0,
						textOverflow: undefined,
					})}
				>
					{tab.name}
					{machineName ? ` · ${machineName}` : ""}
				</Text>
				{tab.branch ? (
					<Text
						testId={`branch-${id}`}
						tokens={appTokens}
						style={styles.branch}
					>{` / ${tab.branch}`}</Text>
				) : null}
			</OverflowingLabel>
		</>
	);
}

/** A closable view title with the same connected tab surface and controls as repository tabs. */
export function WorkspaceTabHeading({
	label,
	testId,
	width: headingWidth = width,
	onClose,
	disabled = false,
}: {
	label: string;
	testId: string;
	width?: number;
	onClose: () => void;
	disabled?: boolean;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens, colors: appColors } = theme;
	const { styles } = themedStyles.get(theme);

	return (
		<div
			testId={testId}
			windowDrag
			style={StyleSheet.compose(styles.root, { width: headingWidth })}
		>
			<svg
				testId={`${testId}-surface`}
				source={connectedTabSurface(headingWidth, appColors.editorSurface)}
				style={StyleSheet.compose(styles.surface, {
					width: headingWidth + surfaceOutset * 2,
				})}
			/>
			<div
				style={StyleSheet.compose(styles.content, {
					pointerEvents: "none",
					width: headingWidth - visualInset * 2,
				})}
			>
				<Text
					testId={`${testId}-label`}
					tokens={appTokens}
					style={StyleSheet.compose(styles.name(true), { flexGrow: 1 })}
				>
					{label}
				</Text>
				<Button
					testId={`${testId}-close`}
					aria-label={`Close ${label}`}
					tokens={appTokens}
					variant="ghost"
					size="sm"
					disabled={disabled}
					onPress={onClose}
					style={styles.close}
				>
					<WorkspaceTabIcon name="close" testId={`${testId}-close-icon`} />
				</Button>
			</div>
		</div>
	);
}

/** The same tab silhouette and label above the menu backdrop; dismisses without closing the workspace. */
export function WorkspaceTabPreview({
	tab,
	onClose,
}: {
	tab: WorkspaceTabRecord;
	onClose: () => void;
}) {
	const theme = useAppTheme();
	const { activeSurface, styles } = themedStyles.get(theme);

	return (
		<div
			testId="workspace-menu-tab"
			role="button"
			aria-label="Close workspace menu"
			style={styles.root}
			onClick={onClose}
			onKeyDown={(event) => {
				if (
					event.key === "escape" ||
					event.key === "enter" ||
					event.key === "space"
				)
					onClose();
			}}
		>
			<svg
				testId="workspace-menu-tab-surface"
				source={activeSurface}
				style={styles.surface}
			/>
			<div
				style={StyleSheet.compose(styles.content, { pointerEvents: "none" })}
			>
				<div
					style={StyleSheet.compose(styles.trigger, { pointerEvents: "none" })}
				>
					<WorkspaceTabLabel tab={tab} active id={`menu-${tab.id}`} />
				</div>
				<div
					testId="workspace-menu-tab-close"
					style={StyleSheet.compose(styles.close, {
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						pointerEvents: "none",
					})}
				>
					<WorkspaceTabIcon
						name="close"
						testId="workspace-menu-tab-close-icon"
					/>
				</div>
			</div>
		</div>
	);
}
