import { useEffect, useRef, useState } from "react";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { spacing, typography, fontWeight } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { Popover, PopoverContent } from "@1git/gpuix-ui/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@1git/gpuix-ui/tooltip";
import { useAppTheme } from "../../styles/theme";
import { WorkspaceTabIcon } from "../workspace-tabs/components/workspace-tab-icon";
import type { useAiCommit } from "./use-ai-commit";

type Generation = ReturnType<typeof useAiCommit>;

/** Immediate generation for an empty draft; replacing existing text requires explicit confirmation. */
export function AiCommitButton({
	generation,
	onSettings,
}: {
	generation: Generation;
	onSettings?: () => void;
}) {
	const { tokens } = useAppTheme();
	const renderer = useGpuixRequired();
	const action = useRef<PublicInstance>(null);

	useEffect(() => {
		if (generation.busy && action.current)
			renderer.focusElement?.(action.current.id);
	}, [generation.busy, renderer]);

	if (!generation.available) return null;

	// Remove the confirmation surface before running: its fading native layer still occludes mouse input.
	if (generation.busy)
		return (
			<Button
				ref={action}
				testId="ai-commit-cancel"
				tokens={tokens}
				size="sm"
				variant="ghost"
				aria-label="Cancel AI generation"
				onPress={generation.cancel}
				style={{ width: 28, height: 24, padding: 0 }}
			>
				<WorkspaceTabIcon
					name="stop"
					color={tokens.colors.textMuted}
					size={16}
				/>
			</Button>
		);

	const label = !generation.configured
		? "Configure AI commit messages"
		: "Generate commit message with AI";

	const tooltip = !generation.configured
		? "Set up AI commit messages"
		: `Generate from checked changes · ${generation.provider} (${generation.model})`;

	return (
		<Popover open={generation.confirming} onOpenChange={generation.dismiss}>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						ref={action}
						testId="ai-generate"
						tokens={tokens}
						size="sm"
						variant="ghost"
						aria-label={label}
						aria-description={
							generation.configured
								? `Sends checked changes and selected lines to ${generation.provider}. Replaces only the commit draft.`
								: undefined
						}
						disabled={
							generation.configured
								? generation.blocked
								: !onSettings || !generation.canConfigure
						}
						onPress={!generation.configured ? onSettings : generation.request}
						style={{ width: 28, height: 24, padding: 0 }}
					>
						<WorkspaceTabIcon
							name="sparkle"
							color={tokens.colors.textMuted}
							size={16}
						/>
					</Button>
				</TooltipTrigger>
				<TooltipContent tokens={tokens}>{tooltip}</TooltipContent>
			</Tooltip>
			<PopoverContent
				testId="ai-commit-replace-panel"
				aria-label="Replace commit message"
				placement="center"
				width={360}
				tokens={tokens}
			>
				<div
					style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}
				>
					<text
						role="heading"
						aria-level={2}
						style={{ ...typography.md, color: tokens.colors.text }}
					>
						Replace commit message?
					</text>
					<text style={{ ...typography.sm, color: tokens.colors.textMuted }}>
						Your message will be replaced after AI generation succeeds.
						Cancelling or a failed request keeps it unchanged.
					</text>
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							justifyContent: "flex-end",
							gap: spacing[1],
						}}
					>
						<Button
							testId="ai-commit-keep"
							tokens={tokens}
							variant="ghost"
							size="sm"
							onPress={generation.dismiss}
						>
							Cancel
						</Button>
						<Button
							testId="ai-commit-replace"
							tokens={tokens}
							size="sm"
							onPress={generation.confirm}
						>
							Replace
						</Button>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

const frames = Array.from(
	{ length: 32 },
	(_, frame) =>
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6" opacity=".18"/><path d="M8 2a6 6 0 0 1 6 6" stroke-linecap="round" transform="rotate(${(frame * 360) / 32} 8 8)"/></svg>`
);

// Only this small indicator updates during animation; the editor and diff do not render per frame.
function GenerationSpinner({ color }: { color: string }) {
	const [frame, setFrame] = useState(0);

	useEffect(() => {
		const timer = setInterval(
			() => setFrame((value) => (value + 1) % frames.length),
			1000 / 30
		);

		return () => clearInterval(timer);
	}, []);

	return (
		<svg
			testId="ai-commit-spinner"
			aria-hidden={true}
			source={frames[frame]}
			style={{
				width: 12,
				height: 12,
				flexShrink: 0,
				color,
			}}
		/>
	);
}

/** Compact phase label inside the disabled Commit button, with the full phase available to accessibility. */
export function AiCommitProgress({ progress }: { progress: string }) {
	const { tokens } = useAppTheme();

	const label =
		progress.startsWith("Reviewing") || progress.startsWith("Inspecting")
			? "Reviewing…"
			: progress;

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				gap: spacing[1.5],
			}}
		>
			<GenerationSpinner color={tokens.colors.onAccent} />
			<text
				testId="ai-commit-status"
				role="status"
				aria-label={progress}
				style={{
					...typography.sm,
					fontWeight: fontWeight.medium,
					color: tokens.colors.onAccent,
					whiteSpace: "nowrap",
				}}
			>
				{label}
			</text>
		</div>
	);
}

/** Failures remain visible beneath the draft after generation finishes. */
export function AiCommitStatus({ generation }: { generation: Generation }) {
	const { tokens } = useAppTheme();

	if (generation.busy || !generation.error) return null;

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				gap: spacing[1.5],
				marginTop: spacing[1],
				marginLeft: spacing[2.5],
				marginRight: spacing[2.5],
			}}
		>
			<text
				testId="ai-commit-status"
				role="alert"
				style={{
					...typography["2xs"],
					color: tokens.colors.textMuted,
					flexGrow: 1,
					minWidth: 0,
				}}
			>
				{generation.error}
			</text>
		</div>
	);
}
