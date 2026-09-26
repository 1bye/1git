import { lightColors } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Checkbox } from "@1git/gpuix-ui/checkbox";
import { Button } from "@1git/gpuix-ui/button";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { useRef, useState } from "react";

import type {
	RepositoryWorkspaceAction,
	RepositoryWorkspaceState,
} from "../lib/repository-workspace-model";
import { repositoryViews, type RepositoryView } from "../types";
import { RepositoryList } from "./repository-list";
import { RepositoryCommit } from "./repository-commit";
import { RepositoryRevisions } from "./repository-revisions";
import { appTokens } from "../../../styles/tokens";
import type { useRepositoryHistory } from "../hooks/use-repository-history";
import type { useRepositoryStashes } from "../hooks/use-repository-stashes";
import { RepositoryReadNotice } from "./repository-read-notice";

const styles = StyleSheet.create({
	navigation: {
		display: "flex",
		flexDirection: "column",
		width: 310,
		flexShrink: 0,
		minHeight: 0,
		borderRightWidth: 1,
		borderColor: lightColors.editorHairline,
	},
	toolbar: {
		display: "flex",
		flexDirection: "row",
		alignItems: "center",
		height: 36,
		flexShrink: 0,
		paddingLeft: 6,
		paddingRight: 8,
		gap: 4,
	},
	pill: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		flexShrink: 0,
		height: 26,
		paddingLeft: 12,
		paddingRight: 12,
		borderRadius: 13,
		borderWidth: 1,
		borderColor: "transparent",
		backgroundColor: lightColors.editorSunken,
		cursor: "pointer",
		hover: { backgroundColor: lightColors.editorSunken2 },
	},
	selectedPill: {
		backgroundColor: lightColors.editorHairlineStrong,
		hover: { backgroundColor: lightColors.editorHairlineStrong },
	},
	pillLabel: {
		fontSize: 11,
		fontWeight: 500,
		color: lightColors.editorMuted,
		pointerEvents: "none",
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
		paddingLeft: 14,
		paddingRight: 11,
		flexShrink: 0,
	},
	muted: { fontSize: 10, color: lightColors.editorMuted },
	footer: {
		height: 32,
		display: "flex",
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		paddingLeft: 14,
		paddingRight: 14,
		flexShrink: 0,
	},
	faint: { fontSize: 9, color: lightColors.editorFaint },
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
				: "No commits yet"
			: "Open a repository to see history";

	if (state.loading) return "Reading repository…";

	if (state.error) return "Could not read repository";

	return state.repository
		? "Working tree clean"
		: "Open a repository to see changes";
}

/** Repository navigation contained in the workspace surface, below the full-width tab rail. */
export function RepositoryNavigation({
	workspaceId,
	state,
	onAction,
	onRefresh,
	history,
	stashes,
}: {
	workspaceId: string;
	state: RepositoryWorkspaceState;
	onAction: (action: RepositoryWorkspaceAction) => void;
	onRefresh: () => void;
	history?: ReturnType<typeof useRepositoryHistory>;
	stashes?: ReturnType<typeof useRepositoryStashes>;
}) {
	const renderer = useGpuixRequired();
	const pills = useRef(new Map<RepositoryView, PublicInstance>());
	const [focusedView, setFocusedView] = useState<RepositoryView | null>(null);
	const [pointerFocus, setPointerFocus] = useState<RepositoryView | null>(null);
	const { view } = state;
	const revisionReader = view === "history" ? history : stashes;
	const label = repositoryViews.find((item) => item.value === view)?.label;

	const heading =
		view === "changes"
			? `${state.includedFileIds.length} of ${state.entries.changes.length} selected`
			: view === "history"
				? "Recent commits"
				: "Saved work";

	const activate = (next: RepositoryView): void => {
		onAction({ type: "view", view: next });
		const pill = pills.current.get(next);

		if (pill) renderer.focusElement?.(pill.id);
	};

	const list = (
		<RepositoryList
			key={`${workspaceId}:${view}`}
			entries={state.entries[view]}
			label={
				view === "changes"
					? "Changed files"
					: view === "history"
						? "Commit history"
						: "Saved stashes"
			}
			emptyMessage={emptyListMessage(state)}
			state={state.views[view]}
			inclusion={
				view === "changes"
					? {
							ids: state.includedFileIds,
							onChange: (id, included) =>
								onAction({ type: "include-file", id, included }),
						}
					: undefined
			}
			onSelect={(id) => onAction({ type: "select", view, id })}
			onScroll={(y) => onAction({ type: "scroll", view, y })}
			onEndReached={
				view === "history" && !state.history.error
					? history?.loadMore
					: undefined
			}
		/>
	);

	return (
		<div
			testId="repository-navigation"
			role="navigation"
			aria-label="Repository navigation"
			style={styles.navigation}
		>
			<div testId="repository-views" style={styles.toolbar}>
				<div
					role="tablist"
					aria-label="Repository views"
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						gap: 4,
					}}
				>
					{repositoryViews.map((item, index) => (
						<div
							key={item.value}
							testId={`view-${item.value}`}
							role="tab"
							aria-label={item.label}
							aria-selected={view === item.value}
							tabIndex={view === item.value ? 0 : -1}
							ref={(node) => {
								if (node) pills.current.set(item.value, node);
								else pills.current.delete(item.value);
							}}
							onClick={() => activate(item.value)}
							onMouseDown={() => setPointerFocus(item.value)}
							onFocus={() => setFocusedView(item.value)}
							onBlur={() => {
								setFocusedView((current) =>
									current === item.value ? null : current
								);
								setPointerFocus((current) =>
									current === item.value ? null : current
								);
							}}
							onKeyDown={(event) => {
								setPointerFocus(null);

								if (
									event.modifiers?.cmd ||
									event.modifiers?.ctrl ||
									event.modifiers?.alt ||
									event.modifiers?.shift
								)
									return;

								const key = event.key;

								if (key === "enter" || key === "space") {
									if (!event.isHeld) activate(item.value);

									return;
								}

								let nextIndex = index;

								if (key === "left")
									nextIndex =
										(index + repositoryViews.length - 1) %
										repositoryViews.length;
								else if (key === "right")
									nextIndex = (index + 1) % repositoryViews.length;
								else if (key === "home") nextIndex = 0;
								else if (key === "end") nextIndex = repositoryViews.length - 1;
								else return;

								const next = repositoryViews[nextIndex];

								if (next) activate(next.value);
							}}
							style={StyleSheet.compose(
								styles.pill,
								view === item.value && styles.selectedPill,
								focusedView === item.value &&
									pointerFocus !== item.value && {
										borderColor: lightColors.brand,
									}
							)}
						>
							<text
								style={StyleSheet.compose(
									styles.pillLabel,
									view === item.value && { color: lightColors.editorInk }
								)}
							>
								{item.label}
							</text>
						</div>
					))}
				</div>
				{state.repository ? (
					<Button
						testId="refresh-repository"
						aria-label="Refresh repository"
						variant="ghost"
						size="sm"
						tokens={appTokens}
						disabled={state.loading}
						onPress={onRefresh}
						style={{ width: 26, height: 26, paddingLeft: 0, paddingRight: 0 }}
					>
						<svg
							source={
								'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M13 7a5 5 0 1 0 0 3M13 3v4H9"/></svg>'
							}
							style={{
								width: 14,
								height: 14,
								color: lightColors.editorMuted,
								pointerEvents: "none",
							}}
						/>
					</Button>
				) : null}
			</div>
			{state.loading || state.error ? (
				<text
					testId="repository-notice"
					role={state.error ? "alert" : "status"}
					style={{ ...styles.muted, padding: 10, flexShrink: 0 }}
				>
					{state.error
						? `${state.repository ? "Refresh failed. Previous results shown. " : ""}${state.error}`
						: "Reading repository…"}
				</text>
			) : null}
			<div role="tabpanel" aria-label={label} style={styles.viewContent}>
				<div style={styles.header}>
					<text testId="repository-heading" style={styles.muted}>
						{heading}
					</text>
					{view === "changes" ? (
						<Checkbox
							testId="include-all"
							aria-label="Include all changed files in commit"
							tokens={appTokens}
							checked={
								state.includedFileIds.length === 0
									? false
									: state.includedFileIds.length ===
										  state.entries.changes.length
										? true
										: "indeterminate"
							}
							disabled={state.entries.changes.length === 0}
							onCheckedChange={(included) =>
								onAction({ type: "include-all", included })
							}
						/>
					) : (
						<text style={styles.faint}>{state.entries[view].length}</text>
					)}
				</div>
				{view === "changes" ? (
					list
				) : (
					<RepositoryRevisions
						key={view}
						view={view}
						state={state}
						onAction={onAction}
						loadingFiles={revisionReader?.loadingFiles}
						onRetryFiles={revisionReader?.retryFiles}
					>
						{list}
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
						state.history.nextOffset !== null ? (
							<RepositoryReadNotice
								testId="load-history"
								loading={history.loading}
								error={state.history.error}
								onPress={history.loadMore}
								label="Load more commits"
							/>
						) : null}
					</RepositoryRevisions>
				)}
				{view === "changes" && (state.preview || state.repository) ? (
					<RepositoryCommit state={state} onAction={onAction} />
				) : (
					<div style={styles.footer}>
						<text style={styles.faint}>
							{state.preview
								? "Sample data"
								: view === "history"
									? "Read-only · first-parent diffs"
									: "Read-only preview"}
						</text>
						<text style={styles.faint}>↑ ↓ Navigate</text>
					</div>
				)}
			</div>
		</div>
	);
}
