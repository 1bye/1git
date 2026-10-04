import { StyleSheet } from "@1git/gpuix-stylesheet";
import {
	useGpuixRequired,
	type DiffProps,
	type EventPayload,
	type PublicInstance,
	type StyleDesc,
} from "@gpuix/react";
import { useRef, useState } from "react";

import { defaultTokens, type UiTokens } from "./tokens";

/** Read-only, virtualized patch viewer. Requires 1git's pinned native diff-view patch. */
export interface DiffViewProps extends Pick<
	DiffProps,
	| "theme"
	| "wordDiff"
	| "showFileHeader"
	| "collapsedPaths"
	| "maxLines"
	| "onToggleFile"
	| "onShowMore"
	| "onLineClick"
	| "onExpandContext"
> {
	patch: string;
	"aria-label": string;
	/** Optional keyboard instructions for application-owned diff actions. */
	"aria-description"?: string;
	/** Styles the bounded viewport, not individual code rows; use theme.metrics for those. */
	style?: StyleDesc;
	tokens?: UiTokens;
	/** Show the focus outline. Disabling it keeps keyboard focus and navigation. */
	focusVisible?: boolean;
	testId?: string;
	/** Focus-scoped actions; return true when the key is consumed. */
	onShortcut?: (event: EventPayload) => boolean;
}

const styles = StyleSheet.create({
	viewport: {
		flexGrow: 1,
		minHeight: 0,
		minWidth: 0,
		overflowX: "scroll",
		overflowY: "hidden",
		borderWidth: 1,
		borderColor: "transparent",
		userSelect: "text",
	},
	content: {
		width: "100%",
		height: "100%",
		flexShrink: 0,
		userSelect: "text",
	},
});

/** Keeps scrolling/selection native, with keyboard navigation and token-based focus styling. */
export function DiffView({
	patch,
	"aria-label": label,
	"aria-description":
		description = "Read-only. Use arrows, Page Up, Page Down, Home and End to scroll. Select text and press Command C to copy.",
	theme,
	wordDiff = true,
	showFileHeader = true,
	focusVisible = true,
	style,
	tokens = defaultTokens,
	testId,
	onShortcut,
	...props
}: DiffViewProps) {
	const renderer = useGpuixRequired();
	const viewport = useRef<PublicInstance>(null);
	const content = useRef<PublicInstance>(null);
	const [focused, setFocused] = useState(false);

	const navigate = (event: EventPayload): void => {
		if (onShortcut?.(event)) return;

		const node = viewport.current;
		const diff = content.current;

		if (
			!node ||
			!diff ||
			event.modifiers?.cmd ||
			event.modifiers?.ctrl ||
			event.modifiers?.alt ||
			event.modifiers?.shift
		)
			return;

		const [x = 0] = renderer.getScrollOffset?.(node.id) ?? [0];
		const [, y = 0] = renderer.getScrollOffset?.(diff.id) ?? [0, 0];
		const page = renderer.getElementBounds?.(node.id)?.height ?? 0;
		const lineHeight = theme?.metrics?.diffLineHeight ?? 21;
		const horizontalStep = lineHeight * 2;
		let nextX = x;
		let nextY = y;

		if (event.key === "down") nextY -= lineHeight;
		else if (event.key === "up") nextY += lineHeight;
		else if (event.key === "pagedown" || event.key === "space") nextY -= page;
		else if (event.key === "pageup") nextY += page;
		else if (event.key === "home") nextY = 0;
		// GPUI clamps this to the native list's measured/estimated bottom.
		else if (event.key === "end") nextY = -Number.MAX_SAFE_INTEGER;
		else if (event.key === "right") nextX -= horizontalStep;
		else if (event.key === "left") nextX += horizontalStep;
		else return;

		if (nextX !== x) renderer.scrollTo?.(node.id, Math.min(0, nextX), 0);

		if (nextY !== y) renderer.scrollTo?.(diff.id, 0, Math.min(0, nextY));
	};

	return (
		<div
			ref={viewport}
			testId={testId}
			role="region"
			aria-label={label}
			aria-description={description}
			tabIndex={0}
			onFocus={() => setFocused(true)}
			onBlur={() => setFocused(false)}
			onKeyDown={navigate}
			style={StyleSheet.compose(
				styles.viewport,
				style,
				focused &&
					focusVisible &&
					tokens.focusVisible !== false && {
						borderColor: tokens.colors.focusRing,
					}
			)}
		>
			{/* Each axis has one owner: the native list on Y, this viewport on X. */}
			<diff
				{...props}
				ref={content}
				testId={testId ? `${testId}-content` : undefined}
				patch={patch}
				wordDiff={wordDiff}
				showFileHeader={showFileHeader}
				autoWidth
				scroll
				theme={theme}
				style={styles.content}
			/>
		</div>
	);
}
