import { lightColors } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";
import { Text } from "@1git/gpuix-ui/text";
import type { EventPayload, PublicInstance } from "@gpuix/react";
import { useRef, useState, type Ref } from "react";

import { appTokens } from "../../styles/tokens";
import { workspaceLayout as layout } from "../../styles/workspace-layout";
import { WorkspaceTabIcon } from "./workspace-tab-icon";
import type { WorkspaceTabRecord } from "./workspace-tabs-model";

const {
	tabWidth: width,
	tabHeight: height,
	tabRadius: radius,
	tabContentInsetInlineStart: inset,
} = layout;
// The connected silhouette stays static as slots reorder.
const outline = `M0 ${height} Q${inset} ${height} ${inset} ${height - inset} V${radius} Q${inset} 0 ${inset + radius} 0 H${width - inset - radius} Q${width - inset} 0 ${width - inset} ${radius} V${height - inset} Q${width - inset} ${height} ${width} ${height}`;
const activeSurface = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><path d="${outline} Z" fill="${lightColors.editorSurface}"/></svg>`;

const styles = StyleSheet.create({
	root: { position: "relative", width, height, flexShrink: 0 },
	surface: {
		color: lightColors.editorSurface,
		position: "absolute",
		top: 0,
		left: 0,
		width,
		height,
		pointerEvents: "none",
	},
	content: {
		position: "absolute",
		top: layout.tabContentInsetTop,
		left: inset,
		width: width - inset * 2,
		height: layout.tabCloseSize,
		display: "flex",
		flexDirection: "row",
		alignItems: "center",
		gap: layout.tabContentGap,
		paddingLeft: layout.tabContentGap,
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
		borderWidth: 1,
		borderColor: "transparent",
		borderRadius: 6,
		cursor: "pointer",
	},
	inactive: { hover: { backgroundColor: lightColors.editorHairline } },
	focused: { borderColor: lightColors.brand },
	avatar: {
		width: layout.tabAvatarSize,
		height: layout.tabAvatarSize,
		borderRadius: 4,
		backgroundColor: lightColors.editorSunken2,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		flexShrink: 0,
	},
	initial: { fontSize: 9, color: lightColors.editorMuted },
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
	},
});

/** Repository-shaped tab with independent activation and close targets. */
export function WorkspaceTab({
	tab,
	active,
	focusVisible,
	onPointerDown,
	onTabMouseDown,
	onTabMouseMove,
	onTabMouseUp,
	onCancelDrag,
	dragging,
	onKeyboardInput,
	tabRef,
	onActivate,
	onClose,
	onNavigate,
	onReorder,
}: {
	tab: WorkspaceTabRecord;
	active: boolean;
	focusVisible: boolean;
	onPointerDown: () => void;
	onTabMouseDown: (event: EventPayload) => void;
	onTabMouseMove: (event: EventPayload) => void;
	onTabMouseUp: (event: EventPayload) => void;
	onCancelDrag: () => void;
	dragging: boolean;
	onKeyboardInput: () => void;
	tabRef: Ref<PublicInstance>;
	onActivate: () => void;
	onClose: () => void;
	onNavigate: (key: string) => void;
	onReorder: (key: string) => void;
}) {
	const [focused, setFocused] = useState(false);
	const [hovered, setHovered] = useState(false);
	const spaceArmed = useRef(false);
	const label = tab.branch ? `${tab.name} / ${tab.branch}` : tab.name;
	const onKeyDown = (event: EventPayload): void => {
		onKeyboardInput();
		if (event.key === "escape") {
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
		if (event.key === "enter") onActivate();
		if (event.key === "space") spaceArmed.current = true;
		if (event.key === "backspace" || event.key === "delete") onClose();
	};

	return (
		<div
			testId={`slot-${tab.id}`}
			style={StyleSheet.compose(styles.root, dragging && { opacity: 0.8 })}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
		>
			<div
				testId={`drag-${tab.id}`}
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					width:
						width - inset - layout.tabContentInsetTop - layout.tabCloseSize,
					height,
					cursor: dragging ? "grabbing" : "grab",
				}}
				onMouseDown={onTabMouseDown}
				onMouseMove={onTabMouseMove}
				onMouseUp={onTabMouseUp}
				onClick={onActivate}
			/>
			{active ? (
				<svg
					testId={`surface-${tab.id}`}
					source={activeSurface}
					style={styles.surface}
				/>
			) : null}
			<div
				testId={`content-${tab.id}`}
				style={StyleSheet.compose(styles.content, { pointerEvents: "none" })}
			>
				<div
					ref={tabRef}
					testId={tab.id}
					role="tab"
					aria-label={label}
					aria-description="Drag to reorder, or press Shift+Left or Shift+Right."
					aria-selected={active}
					tabIndex={active ? 0 : -1}
					style={StyleSheet.compose(
						styles.trigger,
						{ cursor: dragging ? "grabbing" : "grab", userSelect: "none" },
						!active && styles.inactive,
						focused && focusVisible && styles.focused
					)}
					onClick={onActivate}
					onMouseDown={onTabMouseDown}
					onMouseMove={onTabMouseMove}
					onMouseUp={onTabMouseUp}
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
					<div testId={`avatar-${tab.id}`} style={styles.avatar}>
						<Text tokens={appTokens} style={styles.initial}>
							{tab.name[0]?.toUpperCase()}
						</Text>
					</div>
					<div testId={`label-${tab.id}`} style={styles.label}>
						<Text
							testId={`name-${tab.id}`}
							tokens={appTokens}
							style={styles.name(active)}
						>
							{tab.name}
						</Text>
						{tab.branch ? (
							<Text
								testId={`branch-${tab.id}`}
								tokens={appTokens}
								style={styles.branch}
							>
								{` / ${tab.branch}`}
							</Text>
						) : null}
					</div>
				</div>
				<Button
					testId={`close-${tab.id}`}
					aria-label={`Close ${label}`}
					tokens={appTokens}
					variant="ghost"
					size="sm"
					focusVisible={focusVisible}
					onMouseDown={onPointerDown}
					onKeyDown={onKeyboardInput}
					tabIndex={active ? 0 : -1}
					onPress={onClose}
					style={StyleSheet.compose(styles.close, {
						opacity: active || hovered || focused ? 1 : 0,
					})}
				>
					<WorkspaceTabIcon name="close" testId={`close-icon-${tab.id}`} />
				</Button>
			</div>
		</div>
	);
}
