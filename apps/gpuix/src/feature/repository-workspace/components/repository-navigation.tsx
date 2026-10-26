import { createThemedStyles, useAppTheme } from "../../../styles/theme";
import {
	spacing,
	typography,
	fontWeight,
	iconSize,
	radius,
} from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { repositoryFilterShortcuts } from "../lib/repository-filter-shortcut";
import { Keybinds } from "../../keybinds/keybinds";
import { useKeybinds } from "../../keybinds/keybind-context";

import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceAction,
	type RepositoryWorkspaceState,
} from "../lib/repository-workspace-model";
import { repositoryViews, type WorkspaceEntry } from "../types";
import { RepositoryList } from "./repository-list";
import { RepositoryFileLayoutToggle } from "./repository-file-view";
import { RepositoryConflictFiles } from "./repository-conflict-files";
import type { FileMenuActions } from "./repository-file-menu";
import { EmptyListPlaceholder } from "../../../fixture/empty-list-placeholder";
import { StateMessage } from "../../../fixture/state-message";
import { RepositoryCommit } from "./repository-commit";
import { RepositoryRevisions } from "./repository-revisions";
import { RepositoryChangesHeader } from "./repository-changes-header";

import type { useRepositoryHistory } from "../hooks/use-repository-history";
import type { useRepositoryStashes } from "../hooks/use-repository-stashes";
import { RepositoryReadNotice } from "./repository-read-notice";
import { RepositoryStashActions } from "./repository-stash-actions";
import type { StashWriteRequest } from "../lib/repository-stashes";
import type {
	FinishOperationInput,
	CommitRecoveryInput,
	RevertCommitInput,
	CherryPickCommitInput,
	CreateReleaseTagInput,
	PushTagInput,
	TagInfo,
	SquashCommitsInput,
	ResetCommitInput,
	ReorderCommitsInput,
} from "@1git/git";
import type { RepositoryCommit as CommitReader } from "../lib/repository-commit";
import { RepositoryOperation } from "./repository-operation";
import { RepositoryRevert } from "./repository-revert";
import type { RepositoryBranches } from "../../workspace-tabs/lib/repository-branches";
import type { RepositoryHistory } from "../lib/repository-history";
import type {
	FileDiscardRequest,
	FileIgnoreRequest,
	RepositoryFileActions,
} from "../lib/repository-file-actions";
import type { ExternalEditors } from "../../editor-settings/external-editors";
import type { RepositoryHistorySquash } from "../lib/repository-history-squash";

const sidebarBorderWidth = 1;
const revisionCountFormat = new Intl.NumberFormat();

const themedStyles = createThemedStyles(({ colors: appColors }) => {
	const styles = StyleSheet.create({
		navigation: {
			display: "flex",
			flexDirection: "column",
			width: 310,
			flexShrink: 0,
			minHeight: 0,
			borderRightWidth: sidebarBorderWidth,
			borderColor: appColors.editorHairline,
		},
		toolbar: {
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			height: 36,
			flexShrink: 0,
			paddingLeft: spacing[1.5],
			paddingRight: spacing[2],
			gap: spacing[1],
		},
		viewContent: {
			display: "flex",
			flexDirection: "column",
			flexGrow: 1,
			minHeight: 0,
		},
		header: {
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			height: 24,
			paddingLeft: spacing[3.5],
			// The header includes the separator; file-row content bounds do not.
			paddingRight: spacing[3] - sidebarBorderWidth,
			flexShrink: 0,
		},
		muted: { ...typography.xs, color: appColors.editorMuted },
		fileHistory: {
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			flexShrink: 0,
			gap: spacing[1],
			paddingLeft: spacing[2],
			paddingRight: spacing[2],
			paddingBottom: spacing[1],
		},
		filePath: {
			...typography.xs,
			color: appColors.editorMuted,
			minWidth: 0,
			flexGrow: 1,
			whiteSpace: "nowrap",
			textOverflow: "ellipsis",
			overflowX: "hidden",
		},
		stashActions: {
			display: "flex",
			flexDirection: "row",
			justifyContent: "space-between",
			alignItems: "flex-start",
			flexShrink: 0,
		},
		footer: {
			height: 32,
			display: "flex",
			flexDirection: "row",
			justifyContent: "space-between",
			alignItems: "center",
			paddingLeft: spacing[3.5],
			paddingRight: spacing[3.5],
			flexShrink: 0,
		},
		faint: { ...typography["2xs"], color: appColors.editorFaint },
		revisionTotal: {
			...typography.xs,
			color: appColors.editorFaint,
			flexShrink: 0,
		},
	});

	return { styles };
});

function emptyListMessage(state: RepositoryWorkspaceState): string {
	if (state.preview) {
		if (state.view === "history") return "No commits yet";

		if (state.view === "stashes") return "No stashed changes";

		return "No changed files";
	}

	if (state.view === "stashes")
		return state.repository
			? state.stashes.loaded
				? "No stashed changes"
				: ""
			: "Open a repository to see stashes";

	if (state.view === "history")
		return state.repository
			? state.history.nextOffset === 0
				? ""
				: state.history.file
					? "No commits for this file"
					: "No commits yet"
			: "Open a repository to see history";

	if (state.loading) return "Reading repository…";

	if (state.error) return "Could not read repository";

	return state.repository
		? "Working tree clean"
		: "Open a repository to see changes";
}

/** Repository navigation contained in the workspace surface, below the full-width tab rail. */
export function RepositoryNavigation(
	props: Omit<Parameters<typeof RepositoryNavigationContent>[0], "state"> & {
		state: RepositoryWorkspaceState;
	}
) {
	if (props.state.view === "graph") return null;

	return (
		<RepositoryNavigationContent
			{...props}
			state={{ ...props.state, view: props.state.view }}
		/>
	);
}

function RepositoryNavigationContent({
	workspaceId,
	state,
	onAction,
	onRefresh,
	history,
	stashes,
	onCommit,
	onCancelCommit,
	onAiSettings,
	onUndoCommit,
	onRevertCommit,
	onCherryPickCommit,
	onCreateTag,
	onPushTag,
	onSquash,
	readSquash,
	onReset,
	readReset,
	onReorder,
	readReorder,
	readBranches,
	readCommitLink,
	readLastCommit,
	onStash,
	onOperation,
	onDiscard,
	onIgnore,
	openFile,
	externalEditors,
	onPreviewIntent,
}: {
	workspaceId: string;
	state: RepositoryWorkspaceState & {
		readonly view: Exclude<RepositoryWorkspaceState["view"], "graph">;
	};
	onAction: (action: RepositoryWorkspaceAction) => void;
	onRefresh: () => void;
	history?: ReturnType<typeof useRepositoryHistory>;
	stashes?: ReturnType<typeof useRepositoryStashes>;
	onCommit?: () => void;
	onCancelCommit?: () => void;
	onAiSettings?: () => void;
	onUndoCommit?: (input: CommitRecoveryInput) => Promise<string | null>;
	onRevertCommit?: (input: RevertCommitInput) => Promise<string | null>;
	onCherryPickCommit?: (input: CherryPickCommitInput) => Promise<string | null>;
	onCreateTag?: (input: CreateReleaseTagInput) => Promise<string | null>;
	onPushTag?: (input: PushTagInput) => Promise<string | null>;
	onSquash?: (input: SquashCommitsInput) => Promise<string | null>;
	readSquash?: typeof RepositoryHistorySquash.read;
	onReset?: (input: ResetCommitInput) => Promise<string | null>;
	readReset?: typeof RepositoryHistory.readReset;
	onReorder?: (input: ReorderCommitsInput) => Promise<string | null>;
	readReorder?: typeof RepositoryHistory.readReorder;
	readBranches?: typeof RepositoryBranches.read;
	readCommitLink?: typeof RepositoryHistory.readCommitLink;
	readLastCommit?: typeof CommitReader.readLast;
	onStash?: (request: StashWriteRequest) => Promise<boolean>;
	onOperation?: (request: FinishOperationInput) => Promise<string | null>;
	onDiscard?: (request: FileDiscardRequest) => Promise<string | null>;
	onIgnore?: (request: FileIgnoreRequest) => Promise<string | null>;
	openFile?: typeof RepositoryFileActions.open;
	externalEditors?: ExternalEditors;
	onPreviewIntent?: (entry: WorkspaceEntry | null) => void;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens, colors: appColors } = theme;
	const { styles } = themedStyles.get(theme);

	const renderer = useGpuixRequired();
	const { overrides } = useKeybinds();
	const { view } = state;
	const [filterOpen, setFilterOpen] = useState(false);
	const [query, setQuery] = useState("");
	const filterInput = useRef<PublicInstance>(null);
	const filterButton = useRef<PublicInstance>(null);
	const normalizedQuery = query.trim().toLowerCase();
	const searchable = view === "changes" || view === "history";
	const historySearching = view === "history" && !!state.history.query?.trim();
	const fileHistory = view === "history" ? state.history.file : undefined;
	const filtering = view === "changes" && normalizedQuery.length > 0;

	const decoratedHistory = useMemo(() => {
		const byCommit = new Map<string, TagInfo[]>();

		for (const tag of history?.tags ?? []) {
			const list = byCommit.get(tag.targetOid) ?? [];

			list.push(tag);
			byCommit.set(tag.targetOid, list);
		}

		return state.entries.history.map((entry) => ({
			...entry,
			tags: byCommit.get(entry.id),
			unpushed: history?.unpushed.has(entry.id) ?? false,
		}));
	}, [history?.tags, history?.unpushed, state.entries.history]);

	const entries = filtering
		? state.entries.changes.filter(
				(entry) =>
					(entry.change?.path ?? entry.id)
						.toLowerCase()
						.includes(normalizedQuery) ||
					entry.title.toLowerCase().includes(normalizedQuery)
			)
		: view === "history"
			? decoratedHistory
			: state.entries[view];

	const conflictReview =
		view === "changes" &&
		((!!state.repository && state.repository.operation !== "normal") ||
			state.entries.changes.some(
				(entry) => entry.change?.recordType === "unmerged"
			));

	useEffect(() => {
		if (!searchable) return;

		repositoryFilterShortcuts.set(renderer, (close) => {
			if (close) {
				if (!filterOpen && !historySearching) return false;

				setQuery("");

				if (view === "history") onAction({ type: "history-search", value: "" });

				setFilterOpen(false);

				if (filterButton.current)
					renderer.focusElement?.(filterButton.current.id);

				return true;
			}

			setFilterOpen(true);

			if (filterInput.current) renderer.focusElement?.(filterInput.current.id);

			return true;
		});

		return () => {
			repositoryFilterShortcuts.delete(renderer);
		};
	}, [renderer, view, filterOpen, searchable, historySearching, onAction]);
	useLayoutEffect(() => {
		if (filterOpen && searchable && filterInput.current)
			renderer.focusElement?.(filterInput.current.id);
	}, [filterOpen, view, searchable, renderer]);
	const closeFilter = () => {
		setQuery("");

		if (view === "history") onAction({ type: "history-search", value: "" });

		setFilterOpen(false);

		if (filterButton.current) renderer.focusElement?.(filterButton.current.id);
	};

	const revisionReader = view === "history" ? history : stashes;

	const label = fileHistory
		? "File history"
		: repositoryViews.find((item) => item.value === view)?.label;

	const total =
		view === "stashes"
			? state.stashes.loaded && !state.stashes.error
				? state.entries.stashes.length
				: undefined
			: state.repository?.head === null
				? 0
				: state.historyCount?.total;

	const countError =
		view === "stashes" ? state.stashes.error : state.historyCount?.error;

	const shallowHistory =
		view === "history" &&
		!!state.repository?.head &&
		state.repository.isShallow;

	const totalAvailable = total != null;
	const countSingular = view === "stashes" ? "stash" : "commit";
	const countPlural = view === "stashes" ? "stashes" : "commits";

	const countScope =
		view === "stashes" ? "repository" : "current branch history";

	const countLabel = totalAvailable
		? `(${shallowHistory ? "≥" : ""}${revisionCountFormat.format(total)})`
		: countError
			? "(—)"
			: "(…)";

	const countAccessibleLabel = totalAvailable
		? `${shallowHistory ? "At least " : ""}${total} ${total === 1 ? countSingular : countPlural} in ${countScope}`
		: countError
			? `${view === "stashes" ? "Stash" : "Commit"} count unavailable`
			: `Counting ${countPlural}`;

	const emptyListReady =
		view === "changes" ||
		(view === "history"
			? state.history.nextOffset !== 0 && !state.history.error
			: state.stashes.loaded && !state.stashes.error);

	const heading = historySearching ? "Search results" : "Commits";

	const readError =
		state.error ??
		(view === "history" ? state.history.error : null) ??
		(view === "stashes" ? state.stashes.error : null);

	const reading =
		state.loading ||
		(view === "history" && state.history.nextOffset === 0) ||
		(view === "stashes" && !state.stashes.loaded);

	const emptyMessage = historySearching
		? state.history.error
			? "Could not search history"
			: state.history.nextOffset === 0
				? "Searching history…"
				: "No matching commits"
		: filtering
			? "No matching files"
			: emptyListMessage(state);

	const fileActions: FileMenuActions | undefined =
		view === "changes" && state.repository && !state.preview && onDiscard
			? {
					root: state.repository.root,
					head: state.repository.head,
					branch: state.repository.branchName,
					disabled:
						RepositoryWorkspaceModel.isBusy(state) ||
						state.loading ||
						!!state.error ||
						state.commit.needsReview,
					canDiscard: state.repository.operation === "normal",
					discard: onDiscard,
					mutationError: state.operationMutation.error,
					ignore: onIgnore,
					include: conflictReview
						? undefined
						: (ids, included) =>
								onAction({ type: "include-files", ids, included }),
					open: openFile,
					editors: externalEditors,
					history: (file) => onAction({ type: "history-file", file }),
				}
			: undefined;

	const list = (
		<RepositoryRevert
			state={state}
			onWrite={onRevertCommit}
			onCherryPick={onCherryPickCommit}
			onCreateTag={onCreateTag}
			onPushTag={onPushTag}
			onSquash={onSquash}
			readSquash={readSquash}
			onReset={onReset}
			readReset={readReset}
			onReorder={onReorder}
			readReorder={readReorder}
			tags={history?.tags}
			readLastCommit={readLastCommit}
			onAmend={(commit) => {
				if (!state.repository?.branchName) return;

				onAction({
					type: "amend-commit",
					head: commit.oid,
					branch: state.repository.branchName,
					message: commit.body || commit.summary,
				});
			}}
			readBranches={readBranches}
			readCommitLink={readCommitLink}
			onFinished={() => onAction({ type: "view", view: "changes" })}
		>
			{(onMenu) => (
				<RepositoryList
					key={JSON.stringify([
						workspaceId,
						view,
						view === "changes" ? normalizedQuery : (state.history.query ?? ""),
						fileHistory?.path,
						fileHistory?.revision,
					])}
					entries={entries}
					fileTree={
						view === "changes"
							? {
									scope: JSON.stringify([
										workspaceId,
										state.repository?.root,
										"changes",
									]),
									allEntries: state.entries.changes,
									filtering,
									onInclude: (ids, included) =>
										onAction({ type: "include-files", ids, included }),
								}
							: undefined
					}
					onContextMenu={
						view === "history" && !state.preview ? onMenu : undefined
					}
					onPreviewIntent={view === "changes" ? onPreviewIntent : undefined}
					fileActions={fileActions}
					label={
						view === "changes"
							? "Changed files"
							: view === "history"
								? "Commit history"
								: "Saved stashes"
					}
					emptyContent={
						emptyListReady &&
						!filtering &&
						!historySearching &&
						!fileHistory &&
						!state.preview &&
						state.repository &&
						!state.loading &&
						!state.error ? (
							<EmptyListPlaceholder />
						) : (
							<StateMessage
								compact
								artwork={
									readError
										? "error"
										: reading
											? "loading"
											: filtering || historySearching
												? "search"
												: "repository"
								}
								title={
									readError
										? "Could not read repository"
										: reading && state.repository
											? "Reading repository…"
											: emptyMessage || "Reading repository…"
								}
								description={readError ?? undefined}
								role={readError ? "alert" : "status"}
							/>
						)
					}
					emptyMessage={emptyMessage}
					state={state.views[view]}
					multiselect={view === "history"}
					inclusion={
						view === "changes"
							? {
									ids: state.includedFileIds,
									partialIds: Object.keys(state.partialFiles ?? {}),
									disabled: RepositoryWorkspaceModel.isBusy(state),
									onChange: (id, included) =>
										onAction({ type: "include-file", id, included }),
								}
							: undefined
					}
					onSelect={(id, mode, visibleIds) =>
						onAction({
							type: "select",
							view,
							id,
							mode,
							visibleIds:
								visibleIds ??
								(filtering ? entries.map((entry) => entry.id) : undefined),
						})
					}
					onScroll={(y) => onAction({ type: "scroll", view, y })}
					onEndReached={
						view === "history" && !state.history.error
							? history?.loadMore
							: undefined
					}
				/>
			)}
		</RepositoryRevert>
	);

	return (
		<div
			testId="repository-navigation"
			role="navigation"
			aria-label="Repository navigation"
			style={styles.navigation}
		>
			<div testId="repository-views" style={styles.toolbar}>
				<text
					testId="repository-view-title"
					style={{
						...typography.md,
						fontWeight: fontWeight.medium,
						color: appColors.editorInk,
						paddingLeft: spacing[2],
					}}
				>
					{label}
				</text>
				{view !== "changes" &&
				!fileHistory &&
				!state.preview &&
				state.repository ? (
					<text
						testId={view === "stashes" ? "stashes-total" : "history-total"}
						role="text"
						aria-label={countAccessibleLabel}
						aria-description={
							countError
								? `${countError} Refresh to retry the count.`
								: shallowHistory
									? "Only locally available commits can be counted in a shallow clone."
									: undefined
						}
						style={styles.revisionTotal}
					>
						{countLabel}
					</text>
				) : null}
				<div style={{ flexGrow: 1 }} />
				{view === "changes" && !conflictReview ? (
					<RepositoryFileLayoutToggle testId="changes-file-layout" />
				) : null}
				{state.repository || state.repositoryPath ? (
					<Button
						testId="refresh-repository"
						aria-label="Refresh repository"
						variant="ghost"
						size="sm"
						tokens={appTokens}
						disabled={state.loading || RepositoryWorkspaceModel.isBusy(state)}
						onPress={onRefresh}
						style={{
							width: 26,
							height: 26,
							paddingLeft: spacing[0],
							paddingRight: spacing[0],
						}}
					>
						<svg
							source={
								'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M13 7a5 5 0 1 0 0 3M13 3v4H9"/></svg>'
							}
							style={{
								width: iconSize.sm,
								height: iconSize.sm,
								color: appColors.editorMuted,
								pointerEvents: "none",
							}}
						/>
					</Button>
				) : null}
				{searchable ? (
					<Button
						ref={filterButton}
						testId={view === "history" ? "filter-history" : "filter-changes"}
						aria-label={
							view === "history"
								? `Search history (${Keybinds.label("find", overrides)})`
								: `Search changed files (${Keybinds.label("find", overrides)})`
						}
						aria-expanded={filterOpen || historySearching}
						variant="ghost"
						size="sm"
						tokens={appTokens}
						onPress={() => {
							setFilterOpen(true);

							if (filterInput.current)
								renderer.focusElement?.(filterInput.current.id);
						}}
						style={{
							width: 26,
							height: 26,
							paddingLeft: spacing[0],
							paddingRight: spacing[0],
						}}
					>
						<svg
							source={
								'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"><circle cx="6.75" cy="6.75" r="4.5"/><path d="m10.1 10.1 3.65 3.65"/></svg>'
							}
							style={{
								width: iconSize.sm,
								height: iconSize.sm,
								color:
									filterOpen || historySearching
										? appColors.brand
										: appColors.editorMuted,
								pointerEvents: "none",
							}}
						/>
					</Button>
				) : null}
			</div>
			{fileHistory ? (
				<div style={styles.fileHistory}>
					<Button
						testId="file-history-back"
						aria-label="Back to all history"
						variant="secondary"
						size="sm"
						tokens={appTokens}
						disabled={state.loading || RepositoryWorkspaceModel.isBusy(state)}
						onPress={() => {
							setFilterOpen(false);
							onAction({ type: "history-file", file: null });
						}}
					>
						Back
					</Button>
					<text testId="file-history-path" style={styles.filePath}>
						{fileHistory.path}
						{fileHistory.revision
							? ` · ${fileHistory.revision.slice(0, 7)}`
							: ""}
					</text>
				</div>
			) : null}
			{searchable && (filterOpen || historySearching) ? (
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						paddingLeft: spacing[2],
						paddingRight: spacing[2],
						paddingBottom: spacing[1],
						gap: spacing[1],
						flexShrink: 0,
					}}
				>
					<input
						ref={filterInput}
						testId={view === "history" ? "history-filter" : "changes-filter"}
						aria-label={
							view === "history"
								? "Search commit messages, authors or hashes"
								: "Filter changed files"
						}
						placeholder={
							view === "history" ? "Message, author or hash…" : "Filter files…"
						}
						value={view === "history" ? (state.history.query ?? "") : query}
						tabIndex={0}
						style={{
							flexGrow: 1,
							minWidth: 0,
							height: 26,
							...typography.sm,
							paddingLeft: spacing[2],
							paddingRight: spacing[2],
							backgroundColor: appTokens.colors.field,
							borderWidth: 1,
							borderColor: appTokens.colors.border,
							borderRadius: radius.md,
							color: appColors.editorInk,
						}}
						onChange={(event) => {
							if (view === "history") {
								onAction({ type: "history-search", value: event.value ?? "" });

								return;
							}

							setQuery(event.value ?? "");
							onAction({ type: "scroll", view: "changes", y: 0 });
						}}
						onKeyDown={(event) => {
							if (event.key === "escape") closeFilter();
						}}
					/>
					<Button
						aria-label={
							view === "history" ? "Close history search" : "Close file filter"
						}
						testId={
							view === "history"
								? "close-history-filter"
								: "close-changes-filter"
						}
						variant="ghost"
						size="sm"
						tokens={appTokens}
						onPress={closeFilter}
					>
						×
					</Button>
				</div>
			) : null}
			{state.watchError ? (
				<text
					testId="repository-watch-notice"
					role="status"
					style={{ ...styles.muted, padding: spacing[2.5], flexShrink: 0 }}
				>
					{state.watchError}
				</text>
			) : null}
			{state.loading || state.error ? (
				<text
					testId="repository-notice"
					role={state.error ? "alert" : "status"}
					style={{ ...styles.muted, padding: spacing[2.5], flexShrink: 0 }}
				>
					{state.error
						? `${state.repository ? "Refresh failed. Previous results shown. " : ""}${state.error}`
						: "Reading repository…"}
				</text>
			) : null}
			<div role="tabpanel" aria-label={label} style={styles.viewContent}>
				{onOperation ? (
					<RepositoryOperation state={state} onWrite={onOperation} />
				) : null}
				{state.stashMutation.error ||
				state.stashMutation.notice ||
				state.stashMutation.pending ? (
					<text
						testId="stash-notice"
						role={state.stashMutation.error ? "alert" : "status"}
						style={{ ...styles.muted, padding: spacing[2] }}
					>
						{state.stashMutation.error ??
							(state.stashMutation.pending
								? `Stash ${state.stashMutation.pending} in progress…`
								: state.stashMutation.notice)}
					</text>
				) : null}
				{view === "history" && history?.tagsError ? (
					<RepositoryReadNotice
						testId="retry-tags"
						loading={false}
						error={`Tags unavailable. ${history.tagsError}`}
						onPress={history.retryTags}
						label="Retry tags"
					/>
				) : null}
				{view === "history" && history?.publicationError ? (
					<RepositoryReadNotice
						testId="retry-history-publication"
						loading={false}
						error={`Push status unavailable. ${history.publicationError}`}
						onPress={history.retryPublication}
						label="Retry push status"
					/>
				) : null}
				{view === "changes" ? (
					conflictReview ? null : (
						<RepositoryChangesHeader
							state={state}
							shown={filtering ? entries.length : undefined}
							onAction={onAction}
							onDiscard={onDiscard}
						/>
					)
				) : historySearching || fileHistory ? (
					<div style={styles.header}>
						<text testId="repository-heading" style={styles.muted}>
							{heading}
						</text>
						<text style={styles.faint}>{state.entries[view].length}</text>
					</div>
				) : null}
				{view === "changes" ? (
					conflictReview ? (
						<RepositoryConflictFiles
							key={workspaceId}
							entries={entries}
							state={state.views.changes}
							fileActions={fileActions}
							onPreviewIntent={onPreviewIntent}
							onSelect={(id) =>
								onAction({ type: "select", view: "changes", id })
							}
						/>
					) : (
						list
					)
				) : (
					<RepositoryRevisions
						workspaceId={workspaceId}
						fileActions={
							state.repository && !state.preview
								? {
										kind: "revision",
										root: state.repository.root,
										disabled: !!revisionReader?.loadingFiles || !!state.error,
										open: openFile,
										editors: externalEditors,
										history: RepositoryWorkspaceModel.isBusy(state)
											? undefined
											: (file) => onAction({ type: "history-file", file }),
									}
								: undefined
						}
						onPreviewIntent={onPreviewIntent}
						key={view}
						view={view}
						state={state}
						onAction={onAction}
						loadingFiles={revisionReader?.loadingFiles}
						onRetryFiles={revisionReader?.retryFiles}
					>
						{list}
						{view === "stashes" && state.repository && onStash ? (
							<div style={styles.stashActions}>
								<RepositoryStashActions
									state={state}
									placement="selection"
									onWrite={onStash}
								/>
								<RepositoryStashActions
									state={state}
									placement="create"
									onWrite={onStash}
								/>
							</div>
						) : null}
						{view === "stashes" &&
						state.repository &&
						stashes &&
						(!state.stashes.loaded || state.stashes.error) ? (
							<RepositoryReadNotice
								testId="load-stashes"
								loading={stashes.loading}
								error={state.stashes.error}
								onPress={stashes.retry}
								label="Load stashes"
							/>
						) : null}
						{view === "history" &&
						state.repository &&
						history &&
						(history.loading || state.history.error) ? (
							state.history.error ? (
								<RepositoryReadNotice
									testId="load-history"
									loading={history.loading}
									error={state.history.error}
									onPress={history.loadMore}
									label="Retry"
								/>
							) : (
								<text
									testId="history-loading"
									role="status"
									style={{
										...styles.muted,
										padding: spacing[2.5],
										flexShrink: 0,
									}}
								>
									Loading commits…
								</text>
							)
						) : null}
					</RepositoryRevisions>
				)}
				{conflictReview ? null : view === "changes" &&
				  (state.preview || state.repository || state.repositoryPath) ? (
					<RepositoryCommit
						onAiSettings={onAiSettings}
						state={state}
						onAction={onAction}
						onCommit={onCommit}
						onCancel={onCancelCommit}
						onUndo={onUndoCommit}
						readLast={readLastCommit}
					/>
				) : (
					<div style={styles.footer}>
						<text style={styles.faint}>
							{state.preview
								? "Sample data"
								: view === "history"
									? "Read-only · first-parent diffs"
									: "Apply keeps the stash"}
						</text>
						<text style={styles.faint}>↑ ↓ Navigate</text>
					</div>
				)}
			</div>
		</div>
	);
}
