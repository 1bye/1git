import { useAppTheme } from "../../../styles/theme";
import { spacing, radius, typography } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { Text } from "@1git/gpuix-ui/text";
import { Textarea } from "@1git/gpuix-ui/textarea";
import { Popover, PopoverContent } from "@1git/gpuix-ui/popover";
import type { CommitInfo, SquashCommitsInput, SquashPlan } from "@1git/git";
import { useEffect, useRef, useState } from "react";
import { RepositoryHistorySquash as SquashReader } from "../lib/repository-history-squash";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceState,
} from "../lib/repository-workspace-model";

const reviewTimeoutMs = 10_000;

/** Captured range and branch identity, independent of later History selection. */
export interface HistorySquashReview {
	readonly root: string;
	readonly commits: readonly CommitInfo[];
	readonly input: SquashCommitsInput;
}

/** Reviews publication and later replay before explicitly confirming a History rewrite. */
export function RepositoryHistorySquash({
	state,
	review,
	read = SquashReader.read,
	onWrite,
	onCancel,
	onFinished,
}: {
	state: RepositoryWorkspaceState;
	review: HistorySquashReview;
	read?: typeof SquashReader.read;
	onWrite: (input: SquashCommitsInput) => Promise<string | null>;
	onCancel: () => void;
	onFinished: () => void;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;

	const [summary, setSummary] = useState(
		review.input.message.split("\n", 1)[0] ?? ""
	);

	const [description, setDescription] = useState(
		review.input.message.split("\n").slice(1).join("\n").trimStart()
	);

	const message = description ? `${summary}\n\n${description}` : summary;
	const [plan, setPlan] = useState<SquashPlan | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const submitting = useRef(false);
	const busy = pending || RepositoryWorkspaceModel.isBusy(state);

	const changed =
		state.repository?.root !== review.root ||
		state.repository.head !== review.input.expectedHead ||
		state.repository.branchName !== review.input.expectedBranch;

	const unavailable =
		changed ||
		state.loading ||
		!!state.error ||
		state.commit.needsReview ||
		!!state.amend ||
		state.repository?.operation !== "normal" ||
		state.entries.changes.length > 0;

	useEffect(() => {
		const controller = new AbortController();

		const load = async (): Promise<void> => {
			try {
				const result = await read(review.root, {
					...review.input,
					signal: AbortSignal.any([
						controller.signal,
						AbortSignal.timeout(reviewTimeoutMs),
					]),
				});

				if (controller.signal.aborted) return;

				if (result.ok) setPlan(result.value);
				else setError(result.error.message);
			} catch {
				if (!controller.signal.aborted)
					setError(
						"Could not review these commits. Cancel and refresh History."
					);
			}
		};

		void load();

		return () => controller.abort();
	}, [read, review]);

	const submit = async (): Promise<void> => {
		if (
			busy ||
			unavailable ||
			!plan ||
			!message.split("\n", 1)[0]?.trim() ||
			submitting.current
		)
			return;

		submitting.current = true;
		setPending(true);
		setError(null);

		try {
			const failure = await onWrite({ ...review.input, message });

			if (failure) {
				setError(failure);
				setPlan(null);
			} else onFinished();
		} catch {
			setError(
				"Could not confirm the squash. Refresh and inspect History before retrying."
			);
			setPlan(null);
		} finally {
			submitting.current = false;
			setPending(false);
		}
	};

	return (
		<Popover
			open
			onOpenChange={(open) => {
				if (!open && !busy) onCancel();
			}}
		>
			<PopoverContent
				tokens={appTokens}
				placement="center"
				width={440}
				dismissible={!busy}
				aria-label="Squash commits"
				testId="squash-dialog"
			>
				<div
					style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}
				>
					<Text
						tokens={appTokens}
						size="lg"
					>{`Squash ${review.commits.length} commits`}</Text>
					<div
						style={{
							maxHeight: 150,
							overflowY: "scroll",
							display: "flex",
							flexDirection: "column",
							gap: spacing[1],
						}}
					>
						{[...review.commits].reverse().map((commit) => (
							<Text
								key={commit.oid}
								tokens={appTokens}
								size="sm"
							>{`${commit.oid.slice(0, 7)} · ${commit.summary}`}</Text>
						))}
					</div>
					<input
						autoFocus
						aria-label="Squash commit summary"
						testId="squash-summary"
						value={summary}
						onChange={(event) => setSummary(event.value ?? "")}
						readOnly={busy}
						style={{
							...typography.md,
							height: 30,
							borderWidth: 1,
							borderRadius: radius.md,
							borderColor: appTokens.colors.border,
							backgroundColor: appTokens.colors.field,
							paddingLeft: spacing[2],
							paddingRight: spacing[2],
						}}
					/>
					<Textarea
						tokens={appTokens}
						aria-label="Squash commit message"
						testId="squash-message"
						value={description}
						onValueChange={setDescription}
						readOnly={busy}
						style={{ height: 110 }}
					/>
					{plan ? (
						<Text
							tokens={appTokens}
							size="sm"
							tone="muted"
							testId="squash-replay"
						>
							{plan.replay.length
								? `${plan.replay.length} later ${plan.replay.length === 1 ? "commit will" : "commits will"} be replayed with new IDs. Files stay unchanged.`
								: "Combine into one commit. Files stay unchanged."}
						</Text>
					) : !error ? (
						<Text tokens={appTokens} size="sm" tone="muted">
							Reviewing commits…
						</Text>
					) : null}
					<Text tokens={appTokens} size="xs" tone="muted">
						Only unpublished history. Fetch first if another tool may have
						pushed. Originals are retained; existing tags and other branches
						stay unchanged.
					</Text>
					{error || unavailable ? (
						<Text
							tokens={appTokens}
							tone="danger"
							role="alert"
							testId="squash-error"
						>
							{unavailable
								? "The repository changed or is unavailable. Cancel and review again."
								: error}
						</Text>
					) : null}
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							justifyContent: "flex-end",
							gap: spacing[1],
						}}
					>
						<Button
							tokens={appTokens}
							variant="secondary"
							size="sm"
							testId="squash-cancel"
							disabled={busy}
							onPress={onCancel}
						>
							Cancel
						</Button>
						<Button
							tokens={appTokens}
							size="sm"
							testId="squash-confirm"
							disabled={
								busy ||
								unavailable ||
								!plan ||
								!message.split("\n", 1)[0]?.trim()
							}
							onPress={() => {
								void submit();
							}}
						>
							{pending ? "Squashing…" : "Squash commits"}
						</Button>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
