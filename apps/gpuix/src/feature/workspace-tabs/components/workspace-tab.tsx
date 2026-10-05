import { lightColors } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";
import { Text } from "@1git/gpuix-ui/text";
import { motion, type EventPayload, type PublicInstance } from "@gpuix/react";
import { useRef, useState, type Ref, type ReactNode } from "react";

import { appTokens } from "../../../styles/tokens";
import { workspaceLayout as layout } from "../../../styles/workspace-layout";
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
const outline = `M0 ${height} Q${shoulder} ${height} ${shoulder} ${height - shoulder} V${radius} Q${shoulder} 0 ${shoulder + radius} 0 H${surfaceWidth - shoulder - radius} Q${surfaceWidth - shoulder} 0 ${surfaceWidth - shoulder} ${radius} V${height - shoulder} Q${surfaceWidth - shoulder} ${height} ${surfaceWidth} ${height}`;
const activeSurface = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${surfaceWidth} ${height}"><path d="${outline} Z" fill="${lightColors.editorSurface}"/></svg>`;

const styles = StyleSheet.create({
	frame: { position: "absolute", top: 0, width, height, pointerEvents: "none" },
	root: { position: "relative", width, height, flexShrink: 0 },
	surface: {
		color: lightColors.editorSurface,
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
		backgroundColor: lightColors.editorHairline,
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
		borderRadius: 6,
		cursor: "pointer",
	},
	label: {
		display: "flex",
		flexDirection: "row",
		alignItems: "center",
		flexShrink: 1,
		minWidth: 0,
		overflow: "hidden",
		whiteSpace: "nowrap",
		textOverflow: "ellipsis",
	},
	name: (active: boolean) => ({
		flexShrink: 1,
		minWidth: 0,
		fontSize: 11,
		whiteSpace: "nowrap",
		textOverflow: "ellipsis",
		color: active ? lightColors.editorInk : lightColors.editorMuted,
		fontWeight: 500,
	}),
	branch: {
		flexShrink: 1,
		minWidth: 0,
		fontSize: 11,
		fontWeight: 400,
		color: lightColors.editorMuted,
		whiteSpace: "nowrap",
		textOverflow: "ellipsis",
	},
	close: {
		width: layout.tabCloseSize,
		height: layout.tabCloseSize,
		paddingLeft: 0,
		paddingRight: 0,
		hover: { backgroundColor: lightColors.editorHairline },
	},
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
	const frame = useRef<PublicInstance>(null);
	const [focused, setFocused] = useState(false);

	const [hoverTargets, setHoverTargets] = useState({
		slot: false,
		drag: false,
		trigger: false,
		close: false,
	});

	const hovered = Object.values(hoverTargets).some(Boolean);
	const spaceArmed = useRef(false);
	const label = tab.branch ? `${tab.name} / ${tab.branch}` : tab.name;

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
				{active ? (
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
						aria-description={
							menuAvailable
								? "Click the active tab or press Enter or Down for branches. Drag to reorder, or press Shift+Left or Shift+Right."
								: "Drag to reorder, or press Shift+Left or Shift+Right."
						}
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
						<WorkspaceTabLabel tab={tab} active={active} id={tab.id} />
					</div>
					<Button
						testId={`close-${tab.id}`}
						aria-label={`Close ${label}`}
						disabled={RepositoryWorkspaceModel.isBusy(tab.workspace)}
						tokens={appTokens}
						variant="ghost"
						size="sm"
						onMouseDown={onPointerDown}
						onKeyDown={onKeyboardInput}
						tabIndex={active ? 0 : -1}
						onPress={onClose}
						{...hoverEvents("close")}
						style={StyleSheet.compose(styles.close, {
							opacity: active || hovered || focused ? 1 : 0,
						})}
					>
						<WorkspaceTabIcon name="close" testId={`close-icon-${tab.id}`} />
					</Button>
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
}: {
	tab: WorkspaceTabRecord;
	active: boolean;
	id: string;
}) {
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
			<div testId={`label-${id}`} style={styles.label}>
				<Text
					testId={`name-${id}`}
					tokens={appTokens}
					style={styles.name(active)}
				>
					{tab.name}
				</Text>
				{tab.branch ? (
					<Text
						testId={`branch-${id}`}
						tokens={appTokens}
						style={styles.branch}
					>{` / ${tab.branch}`}</Text>
				) : null}
			</div>
		</>
	);
}

/** A non-interactive view title with the same connected tab surface and no close action. */
export function WorkspaceTabHeading({
	label,
	testId,
}: {
	label: string;
	testId: string;
}) {
	return (
		<div testId={testId} windowDrag style={styles.root}>
			<svg
				testId={`${testId}-surface`}
				source={activeSurface}
				style={styles.surface}
			/>
			<div
				style={StyleSheet.compose(styles.content, { pointerEvents: "none" })}
			>
				<Text
					testId={`${testId}-label`}
					tokens={appTokens}
					style={styles.name(true)}
				>
					{label}
				</Text>
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
					style={StyleSheet.compose(styles.close, {
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						pointerEvents: "none",
					})}
				>
					<WorkspaceTabIcon name="close" />
				</div>
			</div>
		</div>
	);
}
