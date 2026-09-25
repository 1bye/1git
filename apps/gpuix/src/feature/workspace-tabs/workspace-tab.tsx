import { lightColors, workspaceLayout as layout } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";
import { Text } from "@1git/gpuix-ui/text";
import type { EventPayload, PublicInstance } from "@gpuix/react";
import { useRef, useState, type Ref } from "react";

import { appTokens } from "../../styles/tokens";
import type { WorkspaceTabRecord } from "./workspace-tabs-model";

const {
	tabWidth: width,
	tabHeight: height,
	tabRadius: radius,
	tabContentInsetInlineStart: inset,
} = layout;
// A static connected silhouette. Liquid morphing and drag geometry are intentionally deferred.
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
	trigger: {
		position: "absolute",
		top: 4,
		left: inset,
		width: width - inset * 2 - layout.tabCloseSize,
		height: height - 8,
		display: "flex",
		flexDirection: "row",
		alignItems: "center",
		gap: layout.tabContentGap,
		paddingLeft: layout.tabContentGap,
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
	label: (active: boolean) => ({
		flexShrink: 1,
		minWidth: 0,
		fontSize: 11,
		whiteSpace: "nowrap",
		textOverflow: "ellipsis",
		color: active ? lightColors.editorInk : lightColors.editorMuted,
		fontWeight: active ? 700 : 600,
	}),
	close: {
		position: "absolute",
		right: inset,
		top: layout.tabContentInsetBlock,
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
	tabRef,
	onActivate,
	onClose,
	onNavigate,
}: {
	tab: WorkspaceTabRecord;
	active: boolean;
	tabRef: Ref<PublicInstance>;
	onActivate: () => void;
	onClose: () => void;
	onNavigate: (key: string) => void;
}) {
	const [focused, setFocused] = useState(false);
	const [hovered, setHovered] = useState(false);
	const spaceArmed = useRef(false);
	const label = tab.branch ? `${tab.name} / ${tab.branch}` : tab.name;
	const onKeyDown = (event: EventPayload): void => {
		if (event.modifiers?.cmd || event.modifiers?.ctrl || event.modifiers?.alt)
			return;
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
			style={styles.root}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
		>
			{active ? <svg source={activeSurface} style={styles.surface} /> : null}
			<div
				ref={tabRef}
				testId={tab.id}
				role="tab"
				aria-label={label}
				aria-selected={active}
				tabIndex={active ? 0 : -1}
				style={StyleSheet.compose(
					styles.trigger,
					!active && styles.inactive,
					focused && styles.focused
				)}
				onClick={onActivate}
				onKeyDown={onKeyDown}
				onKeyUp={(event) => {
					if (event.key !== "space") return;
					const activate = spaceArmed.current;
					spaceArmed.current = false;
					if (activate) onActivate();
				}}
				onFocus={() => setFocused(true)}
				onBlur={() => {
					spaceArmed.current = false;
					setFocused(false);
				}}
			>
				<div style={styles.avatar}>
					<Text tokens={appTokens} style={styles.initial}>
						{tab.name[0]?.toUpperCase()}
					</Text>
				</div>
				<Text tokens={appTokens} style={styles.label(active)}>
					{label}
				</Text>
			</div>
			<Button
				testId={`close-${tab.id}`}
				aria-label={`Close ${label}`}
				tokens={appTokens}
				variant="ghost"
				size="sm"
				tabIndex={active ? 0 : -1}
				onPress={onClose}
				style={StyleSheet.compose(styles.close, {
					opacity: active || hovered || focused ? 1 : 0,
				})}
				textStyle={{ fontSize: 16, color: lightColors.editorMuted }}
			>
				×
			</Button>
		</div>
	);
}
