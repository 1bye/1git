import { useEffect, useRef, useState } from "react";
import { spacing } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { Text } from "@1git/gpuix-ui/text";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@1git/gpuix-ui/popover";
import {
	useGpuixRequired,
	type NativeRenderer,
	type WindowKeyEventHandler,
} from "@gpuix/react";
import { useAppTheme } from "../../styles/theme";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceState,
} from "../repository-workspace/lib/repository-workspace-model";
import type { BranchRequest } from "../workspace-tabs/lib/repository-branches";
import type { SyncComparisonRequest } from "./lib/repository-comparison";
import {
	RepositoryComparison,
	type ComparisonReaders,
} from "./repository-comparison";

const dismissals = new WeakMap<NativeRenderer, () => void>();

/** Escape leaves the review; confirmation popovers retain keyboard priority. */
export function handleSyncReviewKeyDown(
	...[event, renderer]: Parameters<WindowKeyEventHandler>
): boolean {
	if (
		event.key !== "escape" ||
		event.isHeld ||
		event.modifiers?.cmd ||
		event.modifiers?.ctrl ||
		event.modifiers?.alt ||
		event.modifiers?.shift
	)
		return false;

	const dismiss = dismissals.get(renderer);

	if (!dismiss) return false;

	dismiss();

	return true;
}

/** Review both fetched tips and explicitly confirm integration before returning to Changes. */
export function RepositorySyncReview({
	request,
	state,
	onClose,
	onIntegrate,
	...readers
}: {
	request: SyncComparisonRequest;
	state: RepositoryWorkspaceState;
	onClose: () => void;
	onIntegrate: (
		choice: Omit<BranchRequest, "expectedHead" | "expectedBranch">
	) => Promise<string | null>;
} & ComparisonReaders) {
	const { tokens } = useAppTheme();
	const renderer = useGpuixRequired();
	const [method, setMethod] = useState<"merge" | "rebase" | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const starting = useRef(false);
	const repository = state.repository;

	const upstream = request.branches.find(
		(item) => item.value === request.incoming
	);

	const busy = pending || RepositoryWorkspaceModel.isBusy(state);

	const stale =
		repository?.root !== request.root ||
		repository.head !== request.base ||
		repository.branchName !== request.baseName ||
		repository.upstream !== upstream?.label;

	const reason =
		state.error ||
		(state.commit.needsReview
			? "Refresh the workspace before continuing."
			: stale
				? "The branch changed. Go back and sync again to refresh this review."
				: state.entries.changes.length > 0
					? "Commit or stash your changes before merging or rebasing. You can still review both sides."
					: null);

	const operation = repository?.operation;

	useEffect(() => {
		if ((operation && operation !== "normal") || request.behind === 0)
			onClose();
	}, [operation, request.behind, onClose]);
	useEffect(() => {
		const dismiss = (): void => {
			if (busy) return;

			if (method) setMethod(null);
			else onClose();
		};

		dismissals.set(renderer, dismiss);

		return () => {
			dismissals.delete(renderer);
		};
	}, [renderer, busy, method, onClose]);

	const integrate = async (): Promise<void> => {
		if (
			!method ||
			!upstream ||
			reason ||
			busy ||
			state.loading ||
			starting.current
		)
			return;

		starting.current = true;
		setPending(true);
		setError(null);

		try {
			const failure = await onIntegrate({
				kind: method,
				name: upstream.value,
				expectedTarget: upstream.oid,
				reviewedSource: { head: request.base, branch: request.baseName },
			});

			if (failure) setError(failure);
			else onClose();
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Could not confirm integration. Refresh before trying again."
			);
		} finally {
			starting.current = false;
			setPending(false);
		}
	};

	return (
		<div
			testId="sync-review"
			style={{
				display: "flex",
				flexDirection: "column",
				flexGrow: 1,
				minHeight: 0,
				minWidth: 0,
			}}
		>
			<RepositoryComparison
				request={request}
				onClose={onClose}
				{...readers}
				notice={
					reason || (error && !method) ? (
						<div
							testId="sync-review-notice"
							style={{
								padding: spacing[3],
								flexShrink: 0,
								borderBottomWidth: 1,
								borderColor: tokens.colors.border,
							}}
						>
							<Text
								testId="sync-review-error"
								tokens={tokens}
								role="alert"
								size="sm"
							>
								{error ?? reason}
							</Text>
						</div>
					) : null
				}
			>
				{() => (
					<div
						testId="sync-review-actions"
						style={{ display: "flex", flexDirection: "row", gap: spacing[2] }}
					>
						{(["merge", "rebase"] as const).map((kind) => (
							<Popover
								key={kind}
								open={method === kind}
								onOpenChange={(open) => {
									if (busy) return;

									if (open) setError(null);

									setMethod(open ? kind : null);
								}}
							>
								<PopoverTrigger asChild>
									<Button
										testId={`sync-review-${kind}`}
										tokens={tokens}
										size="sm"
										variant={kind === "merge" ? "primary" : "secondary"}
										disabled={busy || state.loading || !!reason}
									>
										{kind === "merge" ? "Merge…" : "Rebase…"}
									</Button>
								</PopoverTrigger>
								<PopoverContent
									testId={`sync-review-${kind}-confirmation`}
									aria-label={
										kind === "merge" ? "Confirm merge" : "Confirm rebase"
									}
									tokens={tokens}
									side="bottom"
									align="end"
									width={360}
									dismissible={!busy}
								>
									<div
										style={{
											display: "flex",
											flexDirection: "column",
											gap: spacing[2],
										}}
									>
										<Text tokens={tokens} weight="medium">
											{kind === "merge" ? "Merge branches?" : "Rebase branch?"}
										</Text>
										<Text tokens={tokens} size="sm">
											{kind === "merge"
												? `Merge ${upstream?.label} into ${request.baseName}, keeping both histories. Conflicts can be resolved in Changes.`
												: `Replay ${request.baseName} onto ${upstream?.label}. Only unpublished commits can be rewritten.`}{" "}
											Push separately when you’re ready.
										</Text>
										{error || reason ? (
											<Text
												testId="sync-review-error"
												tokens={tokens}
												size="sm"
												role="alert"
											>
												{error ?? reason}
											</Text>
										) : null}
										<div
											style={{
												display: "flex",
												flexDirection: "row",
												justifyContent: "flex-end",
												gap: spacing[2],
											}}
										>
											<Button
												testId="sync-review-cancel"
												tokens={tokens}
												size="sm"
												variant="secondary"
												disabled={busy}
												onPress={() => setMethod(null)}
											>
												Cancel
											</Button>
											<Button
												testId="sync-review-confirm"
												tokens={tokens}
												size="sm"
												disabled={busy || state.loading || !!reason}
												onPress={() => {
													void integrate();
												}}
											>
												{busy
													? kind === "merge"
														? "Merging…"
														: "Rebasing…"
													: kind === "merge"
														? "Merge branch"
														: "Rebase branch"}
											</Button>
										</div>
									</div>
								</PopoverContent>
							</Popover>
						))}
					</div>
				)}
			</RepositoryComparison>
		</div>
	);
}
