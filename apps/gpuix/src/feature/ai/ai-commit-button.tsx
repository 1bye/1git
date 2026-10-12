import { useEffect, useRef, useState } from "react";
import { spacing, typography } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { Textarea } from "@1git/gpuix-ui/textarea";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@1git/gpuix-ui/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@1git/gpuix-ui/tooltip";
import { useAppTheme } from "../../styles/theme";
import { WorkspaceTabIcon } from "../workspace-tabs/components/workspace-tab-icon";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceState,
} from "../repository-workspace/lib/repository-workspace-model";
import { useAi } from "./ai-provider";
import { CommitContext } from "./lib/commit-context";

/** Compact opt-in action; AI suggestions are reviewed before replacing a draft, never committed automatically. */
export function AiCommitButton(props: {
	state: RepositoryWorkspaceState;
	onMessage: (message: string) => void;
	onSettings?: () => void;
	read?: typeof CommitContext.read;
}) {
	const ai = useAi();

	return ai ? <CommitSuggestion {...props} ai={ai} /> : null;
}

function CommitSuggestion({
	state,
	onMessage,
	onSettings,
	read = CommitContext.read,
	ai,
}: Parameters<typeof AiCommitButton>[0] & {
	ai: NonNullable<ReturnType<typeof useAi>>;
}) {
	const { tokens } = useAppTheme();
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [proposal, setProposal] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [progress, setProgress] = useState("Reading changes…");
	const pending = useRef<AbortController | null>(null);
	const source = useRef<string | null>(null);
	const current = useRef({ state, preferences: ai.preferences });

	current.current = { state, preferences: ai.preferences };
	const root = state.repository?.root;
	const head = state.repository?.head;

	const configured =
		!!ai.preferences.provider && !!ai.preferences.model && !ai.error;

	const blocked =
		state.preview ||
		!root ||
		state.loading ||
		!!state.error ||
		state.commit.needsReview ||
		!!state.amend ||
		RepositoryWorkspaceModel.isBusy(state) ||
		!!RepositoryWorkspaceModel.commitBlockReason(state) ||
		!state.includedFileIds.length;

	const row = {
		display: "flex",
		flexDirection: "row",
		justifyContent: "flex-end",
		gap: spacing[1],
	};

	const muted = { ...typography.sm, color: tokens.colors.textMuted };

	useEffect(() => {
		pending.current?.abort();
		pending.current = null;
		source.current = null;
		setBusy(false);
		setProposal("");
		setError(null);
		setOpen(false);
	}, [
		root,
		head,
		state.includedFileIds,
		state.partialFiles,
		state.commitMessage,
		ai.preferences,
		blocked,
	]);
	useEffect(() => () => pending.current?.abort(), []);

	const run = async (apply: boolean) => {
		if (pending.current || blocked || !configured) return;

		const controller = new AbortController();
		const captured = current.current;

		const stillCurrent = () =>
			!controller.signal.aborted &&
			current.current.state.repository?.root ===
				captured.state.repository?.root &&
			current.current.state.repository?.head ===
				captured.state.repository?.head &&
			current.current.state.commitMessage === captured.state.commitMessage &&
			current.current.state.includedFileIds ===
				captured.state.includedFileIds &&
			current.current.state.partialFiles === captured.state.partialFiles &&
			current.current.preferences === captured.preferences;

		pending.current = controller;
		setBusy(true);
		setError(null);
		setProgress(apply ? "Checking changes…" : "Reading changes…");

		try {
			const patch = await read(captured.state, controller.signal);

			if (!stillCurrent()) return;

			if (apply) {
				if (patch !== source.current)
					throw new Error(
						"Changes on disk have moved since generation. Review the selection and generate again."
					);

				onMessage(proposal);
				setOpen(false);
			} else {
				const message = await ai.service.generate(
					captured.preferences,
					patch,
					controller.signal,
					(status) => {
						if (stillCurrent()) setProgress(status);
					}
				);

				if (!stillCurrent()) return;

				source.current = patch;
				setProposal(message);
			}
		} catch (cause) {
			if (stillCurrent())
				setError(
					cause instanceof Error
						? cause.message
						: "AI generation failed. Your draft was left unchanged."
				);
		} finally {
			if (pending.current === controller) {
				pending.current = null;
				setBusy(false);
			}
		}
	};

	const close = (next: boolean) => {
		if (!next) {
			pending.current?.abort();
			pending.current = null;
			setBusy(false);
		}

		setOpen(next);
	};

	const icon = (
		<WorkspaceTabIcon
			name="sparkle"
			color={tokens.colors.textMuted}
			size={16}
		/>
	);

	if (!configured)
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						testId="ai-generate"
						tokens={tokens}
						size="sm"
						variant="ghost"
						aria-label="Configure AI commit messages"
						disabled={!onSettings || state.preview}
						onPress={onSettings}
						style={{ width: 28, height: 24, padding: 0 }}
					>
						{icon}
					</Button>
				</TooltipTrigger>
				<TooltipContent tokens={tokens}>
					Set up AI commit messages
				</TooltipContent>
			</Tooltip>
		);

	return (
		<Popover open={open} onOpenChange={close}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger
						testId="ai-generate"
						tokens={tokens}
						size="sm"
						variant="ghost"
						aria-label="Generate commit message with AI"
						aria-description="Sends only checked changes to your configured provider after confirmation."
						disabled={blocked}
						style={{ width: 28, height: 24, padding: 0 }}
					>
						{icon}
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent tokens={tokens}>
					{state.amend
						? "Finish or cancel amend before generating"
						: "Generate commit message"}
				</TooltipContent>
			</Tooltip>
			<PopoverContent
				testId="ai-commit-panel"
				aria-label="AI commit message"
				placement="center"
				width={440}
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
						Generate commit message
					</text>
					<text
						style={muted}
					>{`${state.includedFileIds.length} checked file${state.includedFileIds.length === 1 ? "" : "s"} and selected lines will be sent to ${ai.preferences.provider === "chatgpt" ? "ChatGPT" : "OpenCode"} (${ai.preferences.model}). Review for secrets first. Your draft will not change until you choose Use message.`}</text>
					{ai.preferences.provider === "opencode" &&
					(ai.preferences.opencodeMode === "free" ||
						ai.preferences.model.includes("contributor")) ? (
						<text style={muted}>
							Some models retain prompts or use them for training. Avoid sending
							sensitive code.
						</text>
					) : null}
					{proposal ? (
						<Textarea
							testId="ai-commit-proposal"
							aria-label="Suggested commit message"
							value={proposal}
							onValueChange={setProposal}
							readOnly={busy}
							minRows={4}
							maxRows={8}
							tokens={tokens}
						/>
					) : null}
					{error || busy ? (
						<text
							testId="ai-commit-status"
							role={error ? "alert" : "status"}
							style={muted}
						>
							{error ?? progress}
						</text>
					) : null}
					<div style={row}>
						<Button
							testId="ai-commit-cancel"
							tokens={tokens}
							variant="ghost"
							size="sm"
							onPress={() => close(false)}
						>
							{busy ? "Cancel" : "Close"}
						</Button>
						<Button
							testId="ai-commit-request"
							tokens={tokens}
							variant={proposal ? "secondary" : "primary"}
							size="sm"
							disabled={busy}
							onPress={() => void run(false)}
						>
							{proposal ? "Regenerate" : "Generate"}
						</Button>
						{proposal ? (
							<Button
								testId="ai-commit-use"
								tokens={tokens}
								size="sm"
								disabled={busy || !proposal.trim()}
								onPress={() => void run(true)}
							>
								Use message
							</Button>
						) : null}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
