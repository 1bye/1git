import { useEffect, useRef, useState } from "react";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import {
	radius,
	spacing,
	typography,
	codeTypography,
} from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@1git/gpuix-ui/tooltip";
import { useAppTheme } from "../../../styles/theme";
import { NativeClipboard } from "../../../platform/clipboard";
import { WorkspaceTabIcon } from "../../workspace-tabs/components/workspace-tab-icon";
import type { RepositoryWorkspaceState } from "../lib/repository-workspace-model";

const phases = {
	preparing: "Preparing commit…",
	committing: "Running hooks and committing…",
	refreshing: "Refreshing repository…",
};

const scrollSteps: Readonly<Record<string, number>> = {
	down: -16,
	up: 16,
	pagedown: -64,
	space: -64,
	pageup: 64,
};

function commitStatus(commit: RepositoryWorkspaceState["commit"]): string {
	if (commit.cancelling) return "Stopping Git and hooks…";

	if (commit.needsReview) return "Review commit outcome";

	if (commit.error) return "Commit stopped";

	return commit.progress ? phases[commit.progress] : "Committing…";
}

/** Keeps hook execution, cancellation and failure output within the commit composer. */
export function RepositoryCommitProcess({
	commit,
	onCancel,
}: {
	commit: RepositoryWorkspaceState["commit"];
	onCancel?: () => void;
}) {
	const { tokens, colors } = useAppTheme();
	const renderer = useGpuixRequired();
	const log = useRef<PublicInstance>(null);
	const problem = commit.error ?? (commit.needsReview ? commit.notice : null);
	const content = [problem, commit.output].filter(Boolean).join("\n\n");

	const [copyResult, setCopyResult] = useState<{
		content: string;
		status: "copying" | "copied" | "error";
	}>();

	const copyStatus =
		copyResult?.content === content ? copyResult.status : undefined;

	const status = commitStatus(commit);

	const copy = async (): Promise<void> => {
		setCopyResult({ content, status: "copying" });

		try {
			await NativeClipboard.write(content);
			setCopyResult({ content, status: "copied" });
		} catch {
			setCopyResult({ content, status: "error" });
		}
	};

	useEffect(() => {
		if (!commit.pending) {
			if (log.current) renderer.scrollTo?.(log.current.id, 0, 0);

			return;
		}

		if (!commit.output) return;

		const timer = setTimeout(() => {
			if (log.current && renderer.getFocusedElementId?.() !== log.current.id)
				renderer.scrollTo?.(log.current.id, 0, -100000);
		}, 0);

		return () => clearTimeout(timer);
	}, [commit.pending, commit.output, problem, renderer]);

	return (
		<div
			testId="commit-process"
			style={{
				display: "flex",
				flexDirection: "column",
				gap: spacing[1],
				margin: spacing[2],
				padding: spacing[2],
				borderRadius: radius.md,
				borderWidth: 1,
				borderColor: tokens.colors.border,
				backgroundColor: tokens.colors.surface,
				flexShrink: 0,
			}}
		>
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					flexWrap: "wrap",
					alignItems: "center",
					gap: spacing[2],
				}}
			>
				<text
					testId="commit-process-status"
					role="status"
					style={{
						...typography.sm,
						color: tokens.colors.text,
						flexGrow: 1,
						flexBasis: 100,
						minWidth: 80,
					}}
				>
					{status}
				</text>
				{content ? (
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									testId="commit-output-copy"
									aria-label="Copy Git and hook output"
									aria-description={
										copyStatus === "copied"
											? "Copied to clipboard"
											: "Copy all output, including text outside the visible log."
									}
									tokens={tokens}
									variant="ghost"
									size="sm"
									style={{
										width: tokens.layout.smallControlHeight,
										paddingLeft: 0,
										paddingRight: 0,
									}}
									disabled={copyResult?.status === "copying"}
									onPress={() => {
										void copy();
									}}
								>
									<WorkspaceTabIcon
										name={copyStatus === "copied" ? "check" : "copy"}
										color={
											copyStatus === "copied"
												? colors.success
												: tokens.colors.textMuted
										}
									/>
								</Button>
							</TooltipTrigger>
							<TooltipContent
								testId="commit-output-copy-tooltip"
								tokens={tokens}
								side="bottom"
								align="end"
							>
								{copyStatus === "copied" ? "Copied" : "Copy output"}
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				) : null}
				{commit.pending && onCancel ? (
					<Button
						testId="commit-cancel"
						aria-label="Cancel commit and running hooks"
						tokens={tokens}
						variant="secondary"
						size="sm"
						disabled={commit.cancelling || commit.progress === "refreshing"}
						onPress={onCancel}
					>
						Cancel
					</Button>
				) : null}
			</div>
			{copyStatus === "error" ? (
				<text
					role="alert"
					style={{ ...typography.xs, color: tokens.colors.danger }}
				>
					Could not copy output. Try again.
				</text>
			) : null}
			{commit.output || problem ? (
				<div
					ref={log}
					testId="commit-notice-scroll"
					tabIndex={0}
					aria-label="Git and hook output"
					aria-description="Select text or use Copy to copy all output. Use arrow keys or Page Up and Page Down to read all output."
					style={{
						display: "flex",
						flexDirection: "column",
						maxHeight: 64,
						overflowY: "scroll",
						overflowX: "hidden",
						flexShrink: 0,
						userSelect: "text",
					}}
					onKeyDown={(event) => {
						if (
							!log.current ||
							event.modifiers?.cmd ||
							event.modifiers?.ctrl ||
							event.modifiers?.alt
						)
							return;

						const [, y = 0] = renderer.getScrollOffset?.(log.current.id) ?? [
							0, 0,
						];

						const step = scrollSteps[event.key ?? ""];

						if (step)
							renderer.scrollTo?.(log.current.id, 0, Math.min(0, y + step));
						else if (event.key === "home")
							renderer.scrollTo?.(log.current.id, 0, 0);
						else if (event.key === "end")
							renderer.scrollTo?.(log.current.id, 0, -100000);
					}}
				>
					{problem ? (
						<text
							testId="commit-notice"
							role="alert"
							style={{ ...typography.xs, color: tokens.colors.text }}
						>
							{problem}
						</text>
					) : null}
					{commit.output ? (
						<text
							testId="commit-output"
							style={{
								...codeTypography,
								fontSize: typography.xs.fontSize,
								color: tokens.colors.textMuted,
							}}
						>
							{commit.output}
						</text>
					) : null}
				</div>
			) : null}
		</div>
	);
}
