import { useEffect, useRef } from "react";
import {
	useGpuixRequired,
	useWindowSize,
	type PublicInstance,
} from "@gpuix/react";
import { spacing, typography, fontWeight, radius } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { useAppTheme } from "../../styles/theme";
import type {
	RepositoryAppearanceOptions,
	RepositoryAppearanceValue,
	RepositoryAppearanceSection,
} from "./repository-patterns";
import { useRepositoryAppearanceControls } from "./use-repository-appearance-controls";
import { repositoryAppearanceCancel } from "./repository-appearance-shortcut";

const editorWidth = 344;
const editorTop = 64;

/** Nonmodal appearance controls preview on the mounted repository; only Done persists the draft. */
export function RepositoryAppearanceEditor({
	name,
	color,
	pattern,
	patternSeed,
	patternAdjustments,
	onChange,
	onPatternChange,
	onPreview,
	onDone,
	onCancel,
	onBack,
	section,
	onSectionChange,
}: {
	name: string;
	onPreview: (color: string | undefined) => void;
	onDone: (value: RepositoryAppearanceValue) => void;
	onCancel: () => void;
	onBack: () => void;
	section: RepositoryAppearanceSection;
	onSectionChange: (section: RepositoryAppearanceSection) => void;
} & RepositoryAppearanceOptions) {
	const theme = useAppTheme();
	const { tokens } = theme;
	const window = useWindowSize();
	const renderer = useGpuixRequired();
	const panel = useRef<PublicInstance>(null);
	const initialFocus = useRef(renderer.getFocusedElementId?.());
	const controlsRef = useRef<PublicInstance>(null);
	const cancel = useRef(onCancel);

	cancel.current = onCancel;

	useEffect(() => {
		repositoryAppearanceCancel.set(renderer, () => cancel.current());
		const timer = setTimeout(() => {
			const focused = renderer.getFocusedElementId?.();

			// A user can click a field before the native layer's initial focus is ready.
			if (focused != null && focused !== initialFocus.current) return;

			if (panel.current) {
				renderer.focusElement?.(panel.current.id);
				renderer.focusNextWithin?.(panel.current.id);
			}
		}, 0);

		return () => {
			clearTimeout(timer);
			repositoryAppearanceCancel.delete(renderer);
		};
	}, [renderer]);
	const { fields, finish } = useRepositoryAppearanceControls({
		color,
		pattern,
		patternSeed,
		patternAdjustments,
		onChange,
		onPatternChange,
		onPreview,
		section,
		onSectionChange,
		scrollContainer: controlsRef,
	});

	const controls = (
		<div
			ref={controlsRef}
			testId="repository-appearance-controls"
			style={{
				display: "flex",
				flexDirection: "column",
				width: "100%",
				flexShrink: 1,
				minHeight: 0,
				overflowY: "scroll",
				gap: spacing[3],
				padding: spacing[1],
			}}
		>
			{fields}
		</div>
	);

	return (
		<anchored
			position={{
				x: Math.max(spacing[4], window.width - editorWidth - spacing[4]),
				y: editorTop,
			}}
			anchor="topLeft"
			snapMargin={spacing[4]}
			deferred
			priority={3}
			occlude
			style={{ width: editorWidth, backgroundColor: "rgba(0, 0, 0, 0.001)" }}
		>
			<div
				ref={panel}
				testId="repository-appearance-editor"
				role="dialog"
				aria-label={`Customize ${name}`}
				tabIndex={-1}
				style={{
					display: "flex",
					flexDirection: "column",
					position: "relative",
					width: editorWidth,
					maxHeight: window.height - editorTop - spacing[4],
					padding: spacing[3],
					gap: spacing[3],
					borderWidth: 1,
					borderColor: tokens.colors.border,
					borderRadius: radius.xl,
					backgroundColor: tokens.colors.overlay,
					boxShadow: {
						offsetX: 0,
						offsetY: 8,
						blurRadius: 24,
						spreadRadius: 0,
						color: tokens.colors.shadow,
					},
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: spacing[1],
						flexShrink: 0,
					}}
				>
					<text
						role="heading"
						aria-level={1}
						style={{
							...typography.md,
							fontWeight: fontWeight.medium,
							color: tokens.colors.text,
						}}
					>
						Repository appearance
					</text>
				</div>
				<div
					role="group"
					aria-label="Appearance controls"
					style={{
						display: "flex",
						flexDirection: "row",
						gap: spacing[1],
						flexShrink: 0,
					}}
				>
					{(["color", "pattern"] as const).map((choice) => (
						<Button
							key={choice}
							testId={`repository-appearance-tab-${choice}`}
							aria-pressed={section === choice}
							aria-description={section === choice ? "Selected" : undefined}
							tokens={tokens}
							variant={section === choice ? "secondary" : "ghost"}
							size="sm"
							onPress={() => onSectionChange(choice)}
							style={{ flexGrow: 1 }}
						>
							{choice === "color" ? "Color" : "Pattern"}
						</Button>
					))}
				</div>
				{controls}
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						justifyContent: "space-between",
						alignItems: "center",
						gap: spacing[2],
						flexShrink: 0,
						borderTopWidth: 1,
						borderColor: tokens.colors.border,
						paddingTop: spacing[2],
					}}
				>
					<Button
						testId="repository-appearance-back"
						tokens={tokens}
						size="sm"
						variant="ghost"
						onPress={onBack}
					>
						Back to Settings
					</Button>
					<Button
						testId="repository-appearance-done"
						tokens={tokens}
						size="sm"
						onPress={() => finish(onDone)}
					>
						Done
					</Button>
				</div>
			</div>
		</anchored>
	);
}
