import { useAppTheme } from "../../styles/theme";
import { spacing, typography } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { Text } from "@1git/gpuix-ui/text";
import { useEffect, useRef, useState } from "react";

import { NativeBrowser } from "../../platform/browser";
import { StateMessage } from "../../fixture/state-message";
import { RepositoryComparison } from "../repository-comparison/repository-comparison";
import type { ComparisonRequest } from "../repository-comparison/lib/repository-comparison";
import type { RepositoryWorkspaceState } from "../repository-workspace/lib/repository-workspace-model";
import { RepositoryWorkspaceModel } from "../repository-workspace/lib/repository-workspace-model";
import type { SyncChoice } from "../repository-workspace/lib/repository-sync";
import type { PublishBranchIdentity } from "../repository-publish/repository-publish";
import {
	RepositoryPullRequest,
	type PullRequestPreview,
} from "./repository-pull-request";

type ComparisonProps = Pick<
	Parameters<typeof RepositoryComparison>[0],
	| "readComparison"
	| "fileTreeScope"
	| "readHistory"
	| "readCommitFiles"
	| "readDiff"
	| "previewCache"
	| "diffSettings"
	| "onDiffSettingsChange"
>;

/** Reuses the read-only comparison; publishing, pushing and the browser handoff remain separate explicit actions. */
export function RepositoryPullRequestView({
	root,
	state,
	read,
	onFetch,
	onSync,
	onClose,
	openBrowser = NativeBrowser.open,
	...comparisonProps
}: {
	root: string;
	state: RepositoryWorkspaceState;
	read: RepositoryPullRequest["read"];
	onFetch: () => Promise<string | null>;
	onSync: (
		choice: SyncChoice,
		identity: PublishBranchIdentity
	) => Promise<string | null>;
	onClose: () => void;
	openBrowser?: typeof NativeBrowser.open;
} & ComparisonProps) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;

	const [preview, setPreview] = useState<PullRequestPreview | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [version, setVersion] = useState(0);
	const [pending, setPending] = useState(false);
	const [loading, setLoading] = useState(true);
	const request = useRef<AbortController | null>(null);
	const submitting = useRef(false);
	const latest = useRef(state);

	latest.current = state;

	useEffect(() => {
		const controller = new AbortController();

		request.current = controller;
		setError(null);
		setLoading(true);

		void (async () => {
			try {
				const result = await read(root, controller.signal);

				if (!controller.signal.aborted) setPreview(result);
			} catch (cause) {
				if (!controller.signal.aborted)
					setError(
						cause instanceof Error
							? cause.message
							: "Could not read this repository's review destination."
					);
			} finally {
				if (!controller.signal.aborted) setLoading(false);
			}
		})();

		return () => controller.abort();
	}, [root, read, version]);

	const busy =
		pending ||
		loading ||
		state.loading ||
		RepositoryWorkspaceModel.isBusy(state);

	const stale =
		preview &&
		(preview.head !== state.repository?.head ||
			preview.branch !== state.repository?.branchName);

	const unavailable =
		busy ||
		!!state.error ||
		state.commit.needsReview ||
		state.repository?.operation !== "normal";

	const refresh = async (): Promise<void> => {
		if (submitting.current) return;

		submitting.current = true;
		setPending(true);
		setError(null);

		try {
			const failure = await onFetch();

			if (failure) throw new Error(failure);

			if (request.current?.signal.aborted) return;

			setVersion((value) => value + 1);
			setMessage(null);
		} catch (cause) {
			if (!request.current?.signal.aborted)
				setError(
					cause instanceof Error
						? cause.message
						: "Could not refresh remote branches."
				);
		} finally {
			submitting.current = false;

			if (!request.current?.signal.aborted) setPending(false);
		}
	};

	const act = async (
		base: ComparisonRequest["branches"][number]
	): Promise<void> => {
		const signal = request.current?.signal;

		if (
			!signal ||
			!preview ||
			submitting.current ||
			unavailable ||
			stale ||
			!base.oid
		)
			return;

		submitting.current = true;
		setPending(true);
		setError(null);
		setMessage(null);
		const expectedKind = RepositoryPullRequest.action(preview);

		try {
			// Refresh remote refs through the same window lock as the rail. A failed fetch never opens the browser.
			const failure = expectedKind === "browser" ? await onFetch() : null;

			if (failure) throw new Error(failure);

			signal.throwIfAborted();
			const fresh = await read(root, signal);

			const target = fresh.comparison.branches.find(
				(item) => item.value === base.value
			);

			if (
				fresh.head !== preview.head ||
				fresh.branch !== preview.branch ||
				fresh.remoteUrl !== preview.remoteUrl ||
				fresh.remoteRef !== preview.remoteRef ||
				fresh.remote !== preview.remote ||
				target?.oid !== base.oid
			) {
				setPreview(fresh);
				setMessage(
					"Branches changed. Review the updated preview before continuing."
				);

				return;
			}

			const kind = RepositoryPullRequest.action(fresh);

			if (kind !== expectedKind) {
				setPreview(fresh);
				setMessage(
					"Remote status changed. Review the next action before continuing."
				);

				return;
			}

			if (
				latest.current.repository?.head !== fresh.head ||
				latest.current.repository.branchName !== fresh.branch ||
				latest.current.error
			)
				throw new Error(
					"The workspace changed. Refresh and review it before continuing."
				);

			if (kind !== "browser") {
				const syncError = await onSync(
					{ kind, remote: fresh.remote, remoteRef: fresh.remoteRef },
					{ expectedHead: fresh.head, expectedBranch: fresh.branch }
				);

				if (syncError) throw new Error(syncError);

				signal.throwIfAborted();
				setPreview(await read(root, signal));
				setMessage(
					kind === "publish"
						? "Branch published. Review, then continue on the provider's website."
						: "Changes pushed. Review, then continue on the provider's website."
				);
			} else {
				signal.throwIfAborted();
				await openBrowser(RepositoryPullRequest.browserUrl(fresh, base.label));
				setPreview(fresh);
				setMessage("Opened in your browser. Nothing was submitted by 1git.");
			}
		} catch (cause) {
			if (!signal.aborted)
				setError(
					cause instanceof Error
						? cause.message
						: "Could not continue. Refresh and try again."
				);
		} finally {
			submitting.current = false;

			if (!signal.aborted) setPending(false);
		}
	};

	if (!preview)
		return (
			<div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
				<div style={{ padding: spacing[2], flexShrink: 0 }}>
					<Button
						tokens={appTokens}
						variant="secondary"
						size="sm"
						onPress={onClose}
					>
						Back
					</Button>
				</div>
				<StateMessage
					artwork={error ? "error" : "loading"}
					title={
						error ? "Pull-request preview unavailable" : "Preparing preview…"
					}
					description={error ?? undefined}
				>
					{error ? (
						<Button
							testId="retry-pull-request"
							tokens={appTokens}
							variant="secondary"
							onPress={() => setVersion((value) => value + 1)}
						>
							Retry
						</Button>
					) : null}
				</StateMessage>
			</div>
		);

	const provider =
		preview.identity.providerId === "github" ? "GitHub" : "GitLab";

	const noun = provider === "GitHub" ? "pull request" : "merge request";

	const notice =
		error ??
		(stale
			? "The branch changed. Refresh to update the preview."
			: (message ?? preview.notice));

	return (
		<RepositoryComparison
			request={preview.comparison}
			onClose={onClose}
			{...comparisonProps}
			backActions={
				<Button
					testId="refresh-pull-request"
					tokens={appTokens}
					variant="ghost"
					size="sm"
					disabled={busy}
					onPress={() => {
						void refresh();
					}}
				>
					Refresh
				</Button>
			}
			notice={
				notice ? (
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: spacing[2],
							padding: spacing[2],
							flexShrink: 0,
							borderBottomWidth: 1,
							borderColor: appTokens.colors.border,
						}}
					>
						<Text
							testId="pull-request-notice"
							tokens={appTokens}
							style={{
								...typography.sm,
								color: error
									? appTokens.colors.danger
									: appTokens.colors.textMuted,
								flexGrow: 1,
								minWidth: 0,
							}}
						>
							{notice}
						</Text>
					</div>
				) : null
			}
		>
			{({ base, head }) => {
				const source = preview.remoteRef.slice("refs/heads/".length);
				const existing = RepositoryPullRequest.existing(preview, base.label);
				const action = RepositoryPullRequest.action(preview);

				const label = pending
					? "Checking…"
					: action === "publish"
						? "Publish branch…"
						: action === "push"
							? "Push changes…"
							: existing
								? `View ${noun} #${existing.number} ↗`
								: `Continue on ${provider} ↗`;

				return (
					<Button
						testId="continue-pull-request"
						tokens={appTokens}
						size="sm"
						disabled={
							unavailable ||
							!!stale ||
							!base.oid ||
							base.label === source ||
							base.oid === preview.head ||
							head?.value !== preview.comparison.incoming
						}
						onPress={() => {
							void act(base);
						}}
					>
						{label}
					</Button>
				);
			}}
		</RepositoryComparison>
	);
}
