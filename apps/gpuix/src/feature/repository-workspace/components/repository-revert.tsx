import { spacing, typography } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { Popover, PopoverContent } from "@1git/gpuix-ui/popover";
import type {
	CommitInfo,
	RevertCommitInput,
	CherryPickCommitInput,
	CreateReleaseTagInput,
	PushTagInput,
	TagInfo,
	SquashCommitsInput,
	ResetCommitInput,
	ReorderCommitsInput,
} from "@1git/git";
import { useGpuixRequired, type EventPayload } from "@gpuix/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { appTokens } from "../../../styles/tokens";
import { NativeBrowser } from "../../../platform/browser";
import { NativeClipboard } from "../../../platform/clipboard";
import { NativeFileMenu, type NativeMenuItem } from "../lib/native-file-menu";
import {
	RepositoryHistory,
	type CommitWebLink,
} from "../lib/repository-history";
import { RepositoryCommit } from "../lib/repository-commit";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceState,
} from "../lib/repository-workspace-model";
import type { WorkspaceEntry } from "../types";
import type { RepositoryBranches } from "../../workspace-tabs/lib/repository-branches";
import {
	RepositoryCherryPick,
	type CherryPickReview,
} from "./repository-cherry-pick";
import { RepositoryTag, type TagReview } from "./repository-tag";
import {
	RepositoryHistorySquash,
	type HistorySquashReview,
} from "./repository-history-squash";
import type { RepositoryHistorySquash as SquashReader } from "../lib/repository-history-squash";
import {
	RepositoryHistoryReset,
	type HistoryResetReview,
} from "./repository-history-reset";
import {
	RepositoryHistoryReorder,
	type HistoryReorderReview,
} from "./repository-history-reorder";

type HistoryChoice =
	| "copy-sha"
	| "copy-message"
	| "view"
	| "amend"
	| "squash"
	| "reset"
	| "reorder"
	| "revert"
	| "cherry-pick";

type CommitMenuChoice = HistoryChoice | "create-tag" | { tag: TagInfo };
const remoteLookupTimeoutMs = 5000;

/** Native commit actions; Git writes require a reviewed commit/branch and confirmation. */
export function RepositoryRevert({
	state,
	onWrite,
	onCherryPick,
	onAmend,
	onCreateTag,
	onPushTag,
	onSquash,
	readSquash,
	onReset,
	readReset,
	onReorder,
	readReorder,
	tags = [],
	readLastCommit = RepositoryCommit.readLast,
	readBranches,
	readCommitLink = RepositoryHistory.readCommitLink,
	onFinished,
	children,
}: {
	state: RepositoryWorkspaceState;
	onWrite?: (request: RevertCommitInput) => Promise<string | null>;
	onCherryPick?: (request: CherryPickCommitInput) => Promise<string | null>;
	onAmend?: (commit: CommitInfo) => void;
	onCreateTag?: (input: CreateReleaseTagInput) => Promise<string | null>;
	onPushTag?: (input: PushTagInput) => Promise<string | null>;
	onSquash?: (input: SquashCommitsInput) => Promise<string | null>;
	readSquash?: typeof SquashReader.read;
	onReset?: (input: ResetCommitInput) => Promise<string | null>;
	readReset?: typeof RepositoryHistory.readReset;
	onReorder?: (input: ReorderCommitsInput) => Promise<string | null>;
	readReorder?: typeof RepositoryHistory.readReorder;
	tags?: readonly TagInfo[];
	readLastCommit?: typeof RepositoryCommit.readLast;
	readBranches?: typeof RepositoryBranches.read;
	readCommitLink?: typeof RepositoryHistory.readCommitLink;
	onFinished: () => void;
	children: (
		onMenu: (entry: WorkspaceEntry, event: EventPayload) => void
	) => ReactNode;
}) {
	const renderer = useGpuixRequired();
	const tracking = useRef(false);
	const menuRequest = useRef<AbortController | null>(null);
	const submitting = useRef(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [cherryPick, setCherryPick] = useState<CherryPickReview | null>(null);
	const [tagReview, setTagReview] = useState<TagReview | null>(null);

	const [resetReview, setResetReview] = useState<HistoryResetReview | null>(
		null
	);

	const [squashReview, setSquashReview] = useState<HistorySquashReview | null>(
		null
	);

	const [reorderReview, setReorderReview] =
		useState<HistoryReorderReview | null>(null);

	const [reviewed, setReviewed] = useState<{
		commit: CommitInfo;
		request: RevertCommitInput;
	} | null>(null);

	const busy = pending || RepositoryWorkspaceModel.isBusy(state);
	const repository = state.repository;

	useEffect(
		() => () => menuRequest.current?.abort(),
		[state.view, repository?.root]
	);

	const unavailable =
		state.preview || !repository?.head || !repository.branchName
			? "Open a committed branch first."
			: busy || state.loading || state.error || state.commit.needsReview
				? "Wait for the current operation or refresh first."
				: repository.operation !== "normal"
					? "Finish the current Git operation first."
					: state.entries.changes.length > 0
						? "Commit or stash your changes first."
						: null;

	const changed =
		reviewed &&
		(reviewed.request.expectedHead !== repository?.head ||
			reviewed.request.expectedBranch !== repository?.branchName);

	const openMenu = async (
		entry: WorkspaceEntry,
		event: EventPayload
	): Promise<void> => {
		if (
			tracking.current ||
			reviewed ||
			cherryPick ||
			tagReview ||
			squashReview ||
			resetReview ||
			reorderReview
		)
			return;

		const commit = state.entries.history.find(
			(item) => item.id === entry.id
		)?.commit;

		if (!commit) return;

		tracking.current = true;
		const controller = new AbortController();

		menuRequest.current = controller;
		setError(null);

		try {
			const reason =
				unavailable ??
				(commit.parentOids.length > 1
					? "Merge commits require a mainline parent in an external Git tool."
					: null);

			const cherryPickReason = onCherryPick
				? reason
				: "Cherry-pick is unavailable.";

			let link: CommitWebLink | null = null;
			let canAmend = false;

			const readAmend = async (): Promise<void> => {
				if (
					!onAmend ||
					!repository?.branchName ||
					commit.oid !== repository.head ||
					state.amend ||
					!RepositoryWorkspaceModel.canRecoverCommit(state)
				)
					return;

				try {
					const last = await readLastCommit(repository.root, {
						expectedHead: commit.oid,
						expectedBranch: repository.branchName,
						signal: AbortSignal.any([
							controller.signal,
							AbortSignal.timeout(remoteLookupTimeoutMs),
						]),
					});

					canAmend =
						last.ok &&
						last.value.commit.oid === commit.oid &&
						last.value.undoUnavailableReason === null;
				} catch {
					// A failed eligibility read must disable rewriting without hiding other actions.
				}
			};

			const amendRead = readAmend();

			try {
				if (repository)
					link = await readCommitLink(
						repository.root,
						commit.oid,
						AbortSignal.any([
							controller.signal,
							AbortSignal.timeout(remoteLookupTimeoutMs),
						])
					);
			} catch {
				// A failed remote lookup must not hide clipboard actions or guarded Git writes.
				if (!controller.signal.aborted)
					setError(
						"Could not read the commit's remote. Browser viewing is unavailable."
					);
			}

			await amendRead;

			if (controller.signal.aborted) return;

			const bounds = renderer.getElementBounds?.(event.elementId);

			const selectedIds =
				state.views.history.selectedIds ??
				(state.views.history.selectedId
					? [state.views.history.selectedId]
					: []);

			const selected = new Set(
				selectedIds.includes(entry.id) ? selectedIds : [entry.id]
			);

			const commits = state.entries.history.flatMap((item) =>
				selected.has(item.id) && item.commit ? [item.commit] : []
			);

			const canRewrite =
				!unavailable &&
				!state.amend &&
				commits.length >= 2 &&
				commits.every(
					(item, index) =>
						item.parentOids.length <= 1 &&
						(index + 1 === commits.length ||
							item.parentOids[0] === commits[index + 1]?.oid)
				);

			const canReset =
				!!onReset &&
				!unavailable &&
				!state.amend &&
				commit.oid !== repository?.head;

			const items: NativeMenuItem<CommitMenuChoice>[] = [
				{ label: "Copy SHA", enabled: true, value: "copy-sha" },
				{ label: "Copy Message", enabled: true, value: "copy-message" },
				{
					label: link?.label ?? "View on GitHub/GitLab",
					enabled: link !== null,
					value: "view",
				},
				{ separator: true },
				{
					label: "Amend last commit…",
					enabled: canAmend,
					value: "amend",
				},
				{
					label: "Squash selected commits…",
					enabled: canRewrite && !!onSquash,
					value: "squash",
				},
				{
					label: "Reorder selected commits…",
					enabled: canRewrite && !!onReorder,
					value: "reorder",
				},
				{
					label: "Reset to commit…",
					enabled: canReset,
					value: "reset",
				},
				{
					label: "Cherry-pick commit…",
					enabled: !cherryPickReason,
					value: "cherry-pick",
				},
				{
					label: "Revert commit…",
					enabled: !!onWrite && !reason,
					value: "revert",
				},
			];

			if (reason)
				items.push({ label: reason, enabled: false, value: "revert" });

			const canTag =
				!!repository?.head &&
				!state.preview &&
				!busy &&
				!state.loading &&
				!state.error &&
				!state.commit.needsReview &&
				!state.amend &&
				repository.operation === "normal";

			const commitTags = tags.filter((tag) => tag.targetOid === commit.oid);

			if (onCreateTag || onPushTag) {
				items.push(
					{ separator: true },
					{
						label: "Create tag…",
						enabled: canTag && !!onCreateTag,
						value: "create-tag",
					}
				);

				if (commitTags.length)
					items.push({
						label: "Push tag…",
						enabled: canTag && !!onPushTag,
						children: commitTags.map((tag) => ({
							label: tag.name,
							enabled: true,
							value: { tag },
						})),
					});
			}

			const choice = NativeFileMenu.showItems(
				renderer,
				items,
				event.x ?? bounds?.x ?? 0,
				event.y ?? (bounds ? bounds.y + bounds.height : 0)
			);

			if (
				(choice === "create-tag" ||
					(typeof choice === "object" && choice !== null)) &&
				canTag &&
				repository?.head
			)
				setTagReview({
					root: repository.root,
					commit,
					expectedHead: repository.head,
					expectedBranch: repository.branchName,
					tag: typeof choice === "object" ? choice.tag : undefined,
				});
			else if (choice === "copy-sha") await NativeClipboard.write(commit.oid);
			// The Git reader's body is %B: the full message, including its subject.
			else if (choice === "copy-message")
				await NativeClipboard.write(commit.body || commit.summary);
			else if (choice === "view" && link) await NativeBrowser.open(link.url);
			else if (choice === "amend" && canAmend) onAmend?.(commit);
			else if (
				choice === "reset" &&
				canReset &&
				repository?.head &&
				repository.branchName
			)
				setResetReview({
					root: repository.root,
					commit,
					input: {
						target: commit.oid,
						expectedHead: repository.head,
						expectedBranch: repository.branchName,
					},
				});
			else if (
				choice === "reorder" &&
				canRewrite &&
				onReorder &&
				repository?.head &&
				repository.branchName
			)
				setReorderReview({
					root: repository.root,
					commits,
					input: {
						expectedHead: repository.head,
						expectedBranch: repository.branchName,
						commits: commits.map((item) => item.oid),
						order: [...commits].reverse().map((item) => item.oid),
					},
				});
			else if (
				choice === "squash" &&
				canRewrite &&
				onSquash &&
				repository?.head &&
				repository.branchName
			)
				setSquashReview({
					root: repository.root,
					commits,
					input: {
						expectedHead: repository.head,
						expectedBranch: repository.branchName,
						commits: commits.map((item) => item.oid),
						message: [...commits]
							.reverse()
							.map((item) => item.body || item.summary)
							.join("\n\n"),
					},
				});
			else if (
				choice === "cherry-pick" &&
				!cherryPickReason &&
				repository?.head &&
				repository.branchName
			)
				setCherryPick({
					commit,
					root: repository.root,
					expectedHead: repository.head,
					expectedBranch: repository.branchName,
				});
			else if (
				choice === "revert" &&
				!reason &&
				repository?.head &&
				repository.branchName
			)
				setReviewed({
					commit,
					request: {
						commit: commit.oid,
						expectedHead: repository.head,
						expectedBranch: repository.branchName,
					},
				});
		} catch (cause) {
			if (!controller.signal.aborted)
				setError(
					cause instanceof Error
						? cause.message
						: "Could not open History actions."
				);
		} finally {
			tracking.current = false;
			menuRequest.current = null;
		}
	};

	const submit = async (): Promise<void> => {
		if (!reviewed || !onWrite || unavailable || changed || submitting.current)
			return;

		submitting.current = true;
		setPending(true);
		setError(null);

		try {
			await onWrite(reviewed.request);
			setReviewed(null);
			// The window-owned mutation publishes success/errors and conflict controls in Changes.
			onFinished();
		} catch {
			setError(
				"Could not confirm the revert. Refresh and inspect History before retrying."
			);
		} finally {
			submitting.current = false;
			setPending(false);
		}
	};

	return (
		<>
			{children(openMenu)}
			{reorderReview && onReorder ? (
				<RepositoryHistoryReorder
					state={state}
					review={reorderReview}
					read={readReorder}
					onWrite={onReorder}
					onCancel={() => setReorderReview(null)}
					onFinished={() => setReorderReview(null)}
				/>
			) : null}
			{resetReview && onReset ? (
				<RepositoryHistoryReset
					state={state}
					review={resetReview}
					read={readReset}
					onWrite={onReset}
					onCancel={() => setResetReview(null)}
					onFinished={() => {
						setResetReview(null);
						onFinished();
					}}
				/>
			) : null}
			{squashReview && onSquash ? (
				<RepositoryHistorySquash
					state={state}
					review={squashReview}
					read={readSquash}
					onWrite={onSquash}
					onCancel={() => setSquashReview(null)}
					onFinished={() => setSquashReview(null)}
				/>
			) : null}
			{tagReview ? (
				<RepositoryTag
					state={state}
					review={tagReview}
					readBranches={readBranches}
					onCreate={onCreateTag}
					onPush={onPushTag}
					onCancel={() => setTagReview(null)}
					onFinished={() => setTagReview(null)}
				/>
			) : null}
			{cherryPick && onCherryPick ? (
				<RepositoryCherryPick
					key={`${cherryPick.root}:${cherryPick.commit.oid}`}
					state={state}
					review={cherryPick}
					readBranches={readBranches}
					onWrite={onCherryPick}
					onCancel={() => setCherryPick(null)}
					onFinished={() => {
						setCherryPick(null);
						onFinished();
					}}
				/>
			) : null}
			{error && !reviewed ? (
				<text
					role="alert"
					testId="history-menu-error"
					style={{ ...typography.xs, color: appTokens.colors.danger }}
				>
					{error}
				</text>
			) : null}
			<Popover
				open={reviewed !== null}
				onOpenChange={(open) => {
					if (!open && !busy) setReviewed(null);
				}}
			>
				<PopoverContent
					tokens={appTokens}
					placement="center"
					width={420}
					dismissible={!busy}
					aria-label="Revert commit"
					testId="revert-dialog"
				>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: spacing[3],
						}}
					>
						<text style={{ ...typography.lg, color: appTokens.colors.text }}>
							Revert this commit?
						</text>
						<text
							testId="revert-commit"
							style={{ ...typography.sm, color: appTokens.colors.text }}
						>
							{reviewed?.commit.summary}
						</text>
						<text
							style={{ ...typography.xs, color: appTokens.colors.textMuted }}
						>
							{reviewed
								? `${reviewed.commit.oid.slice(0, 7)} · ${reviewed.request.expectedBranch}`
								: ""}
						</text>
						<text
							style={{ ...typography.sm, color: appTokens.colors.textMuted }}
						>
							Creates a new commit that reverses these changes. Existing history
							stays intact, including published commits.
						</text>
						{error || changed || (!pending && unavailable) ? (
							<text
								role="alert"
								style={{ ...typography.xs, color: appTokens.colors.danger }}
							>
								{error ??
									(changed
										? "The branch changed. Cancel and review History again."
										: unavailable)}
							</text>
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
								tokens={appTokens}
								testId="revert-cancel"
								variant="secondary"
								disabled={busy}
								onPress={() => setReviewed(null)}
							>
								Cancel
							</Button>
							<Button
								tokens={appTokens}
								testId="revert-confirm"
								disabled={!!unavailable || !!changed}
								onPress={() => {
									void submit();
								}}
							>
								{pending ? "Reverting…" : "Revert commit"}
							</Button>
						</div>
					</div>
				</PopoverContent>
			</Popover>
		</>
	);
}
