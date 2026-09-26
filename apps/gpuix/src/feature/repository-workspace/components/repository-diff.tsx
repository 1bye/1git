import type { FileChange } from "@1git/git";
import { lightColors } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";
import {
	useGpuixRequired,
	type GpuixTheme,
	type PublicInstance,
	type EventPayload,
} from "@gpuix/react";
import { useRef, useState } from "react";

import { appTokens } from "../../../styles/tokens";
import { useRepositoryDiff } from "../hooks/use-repository-diff";
import {
	RepositoryDiff as DiffReader,
	type ChangeDiffTarget,
	type RepositoryDiffSection,
} from "../lib/repository-diff";

const diffTheme: GpuixTheme = {
	appearance: "light",
	bg: lightColors.editorSurface,
	border: lightColors.editorHairline,
	text: lightColors.editorInk,
	textMuted: lightColors.editorMuted,
	textFaint: lightColors.editorFaint,
	accent: lightColors.brand,
	diffAdd: "#568362",
	diffDel: "#b2676b",
	diffHunkBg: lightColors.editorSunken,
	fontMono: "Menlo",
	syntax: {
		comment: lightColors.editorFaint,
		keyword: "#75658f",
		string: "#567760",
		stringSpecial: "#567760",
		escape: "#75658f",
		number: "#976b45",
		boolean: "#976b45",
		typeName: "#516b93",
		typeBuiltin: "#516b93",
		constructor: "#516b93",
		function: "#516b93",
		functionBuiltin: "#516b93",
		macroName: "#75658f",
		property: lightColors.editorMuted,
		constant: "#976b45",
		variable: lightColors.editorInk,
		variableSpecial: lightColors.editorInk,
		parameter: lightColors.editorInk,
		operator: lightColors.editorMuted,
		punctuation: lightColors.editorMuted,
		tag: "#516b93",
		attribute: "#75658f",
		label: lightColors.editorMuted,
		invalid: "#b2676b",
	},
	metrics: {
		diffTextSize: 11,
		diffLineHeight: 20,
		diffFileHeaderHeight: 0,
		diffHunkHeaderHeight: 26,
		diffRowPaddingX: 14,
		diffGutterWidth: 30,
		diffMarkerWidth: 18,
		diffAccentBarWidth: 2,
	},
};

const styles = StyleSheet.create({
	header: {
		height: 36,
		flexShrink: 0,
		display: "flex",
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		paddingLeft: 14,
		paddingRight: 12,
		borderBottomWidth: 1,
		borderColor: lightColors.editorHairline,
	},
	filename: {
		fontSize: 11,
		color: lightColors.editorMuted,
		flexGrow: 1,
		minWidth: 0,
		overflow: "hidden",
		whiteSpace: "nowrap",
		textOverflow: "ellipsis",
	},
	hint: { fontSize: 10, color: lightColors.editorFaint },
	message: {
		display: "flex",
		flexDirection: "column",
		flexGrow: 1,
		minHeight: 0,
		alignItems: "center",
		justifyContent: "center",
		padding: 24,
		gap: 12,
	},
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
});

function DiffContent({ section }: { section: RepositoryDiffSection }) {
	const renderer = useGpuixRequired();
	const viewport = useRef<PublicInstance>(null);
	const content = useRef<PublicInstance>(null);
	const [focused, setFocused] = useState(false);

	const navigate = (event: EventPayload): void => {
		const node = viewport.current;

		if (
			!node ||
			!content.current ||
			event.modifiers?.cmd ||
			event.modifiers?.ctrl ||
			event.modifiers?.alt ||
			event.modifiers?.shift
		)
			return;

		const [x = 0] = renderer.getScrollOffset?.(node.id) ?? [0];
		const [, y = 0] = renderer.getScrollOffset?.(content.current.id) ?? [0, 0];
		const page = renderer.getElementBounds?.(node.id)?.height ?? 0;
		let nextX = x;
		let nextY = y;

		if (event.key === "down") nextY -= 20;
		else if (event.key === "up") nextY += 20;
		else if (event.key === "pagedown" || event.key === "space") nextY -= page;
		else if (event.key === "pageup") nextY += page;
		else if (event.key === "home") nextY = 0;
		// GPUI clamps this to the native list's measured/estimated bottom.
		else if (event.key === "end") nextY = -Number.MAX_SAFE_INTEGER;
		else if (event.key === "right") nextX -= 40;
		else if (event.key === "left") nextX += 40;
		else return;

		if (nextX !== x) renderer.scrollTo?.(node.id, Math.min(0, nextX), 0);

		if (nextY !== y)
			renderer.scrollTo?.(content.current.id, 0, Math.min(0, nextY));
	};

	if (section.message)
		return (
			<div style={styles.message} role="status">
				<text style={styles.hint}>{section.message}</text>
			</div>
		);

	return (
		<div
			ref={viewport}
			testId="diff-viewport"
			role="region"
			aria-label={
				section.target === "working" ? "Unstaged file diff" : "Staged file diff"
			}
			aria-description="Read-only. Use arrows, Page Up, Page Down, Home and End to scroll. Select text and press Command C to copy."
			tabIndex={0}
			onFocus={() => setFocused(true)}
			onBlur={() => setFocused(false)}
			onKeyDown={navigate}
			style={StyleSheet.compose(
				styles.viewport,
				focused && { borderColor: lightColors.brand }
			)}
		>
			{/* Each axis has one owner: GPUI's virtual list on Y, this viewport on X. */}
			<diff
				ref={content}
				testId="native-diff"
				patch={section.patch}
				wordDiff
				scroll
				theme={diffTheme}
				style={{
					width: "100%",
					height: "100%",
					minWidth: section.contentWidth,
					flexShrink: 0,
					userSelect: "text",
				}}
			/>
		</div>
	);
}

/** Read-only native diff with explicit index/worktree comparisons and cancellable loading. */
export function RepositoryDiff({
	root,
	change,
	refreshing,
	statusError,
	readDiff = DiffReader.read,
}: {
	root: string;
	change: FileChange;
	refreshing: boolean;
	statusError: string | null;
	readDiff?: typeof DiffReader.read;
}) {
	const { result, retry } = useRepositoryDiff(
		root,
		change,
		refreshing || !!statusError,
		readDiff
	);

	const [target, setTarget] = useState<ChangeDiffTarget>("working");

	const section =
		result?.sections.find((entry) => entry.target === target) ??
		result?.sections[0];

	const message = statusError
		? "Repository status could not be refreshed. Use Refresh to try again."
		: (result?.error ?? (!result ? "Loading diff…" : null));

	return (
		<>
			<div testId="diff-header" style={styles.header}>
				<text testId="diff-filename" style={styles.filename}>
					{change.path}
				</text>
				{result && result.sections.length > 1
					? result.sections.map((entry) => (
							<Button
								key={entry.target}
								testId={`diff-${entry.target}`}
								size="sm"
								variant="ghost"
								tokens={appTokens}
								aria-label={`${entry.target === "working" ? "Unstaged" : "Staged"} changes${section?.target === entry.target ? ", selected" : ""}`}
								style={{
									height: 26,
									borderRadius: 13,
									backgroundColor:
										section?.target === entry.target
											? lightColors.editorSunken2
											: "transparent",
								}}
								textStyle={{ fontSize: 11 }}
								onPress={() => setTarget(entry.target)}
							>
								{entry.target === "working" ? "Unstaged" : "Staged"}
							</Button>
						))
					: null}
			</div>
			{message ? (
				<div
					testId="diff-notice"
					role={result?.error || statusError ? "alert" : "status"}
					style={styles.message}
				>
					<text style={styles.hint}>{message}</text>
					{result?.error ? (
						<Button
							testId="retry-diff"
							tokens={appTokens}
							size="sm"
							variant="secondary"
							onPress={retry}
						>
							Retry
						</Button>
					) : null}
				</div>
			) : section ? (
				<DiffContent key={section.target} section={section} />
			) : null}
		</>
	);
}
