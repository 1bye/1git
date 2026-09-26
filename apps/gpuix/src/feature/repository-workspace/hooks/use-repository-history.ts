import { useCallback, useEffect, useRef, useState } from "react";

import { RepositoryHistory } from "../lib/repository-history";
import type {
	RepositoryWorkspaceAction,
	RepositoryWorkspaceState,
} from "../lib/repository-workspace-model";

/** Loads only the active tab/view; completed pages and file lists live in workspace state. */
export function useRepositoryHistory(
	workspaceId: string | undefined,
	state: RepositoryWorkspaceState | undefined,
	onAction: (id: string, action: RepositoryWorkspaceAction) => void,
	readHistory = RepositoryHistory.read,
	readFiles = RepositoryHistory.readFiles
) {
	const active =
		state?.view === "history" &&
		!state.loading &&
		!state.commit.pending &&
		!state.branchPending &&
		!state.preview;

	const root = active ? state.repository?.root : undefined;
	const head = active ? state.repository?.head : undefined;

	const key =
		root && head && workspaceId ? `${workspaceId}:${root}:${head}` : null;

	const nextOffset = state?.history.nextOffset;
	const error = state?.history.error;

	const revision = state?.entries.history.find(
		(entry) => entry.id === state.views.history.selectedId
	);

	const commit = revision?.commit?.oid;
	const loadedFiles = revision?.filesLoaded;
	const filesError = revision?.filesError;
	const pageRequest = useRef<AbortController | null>(null);
	const fileRequest = useRef<AbortController | null>(null);
	const [pendingPage, setPendingPage] = useState<string | null>(null);
	const [pendingFiles, setPendingFiles] = useState<string | null>(null);

	const loadMore = useCallback(async (): Promise<void> => {
		if (
			!key ||
			!root ||
			!head ||
			!workspaceId ||
			nextOffset == null ||
			pageRequest.current
		)
			return;

		const controller = new AbortController();

		pageRequest.current = controller;
		setPendingPage(key);

		try {
			const result = await readHistory(
				root,
				head,
				nextOffset,
				controller.signal
			);

			if (controller.signal.aborted) return;

			onAction(
				workspaceId,
				result.ok
					? {
							type: "history-page",
							root,
							head,
							offset: nextOffset,
							page: result.value,
						}
					: { type: "history-error", root, head, message: result.error.message }
			);
		} catch (failure) {
			if (!controller.signal.aborted)
				onAction(workspaceId, {
					type: "history-error",
					root,
					head,
					message:
						failure instanceof Error
							? failure.message
							: "Could not read history.",
				});
		} finally {
			if (pageRequest.current === controller) {
				pageRequest.current = null;
				setPendingPage(null);
			}
		}
	}, [key, root, head, workspaceId, nextOffset, readHistory, onAction]);

	const loadFiles = useCallback(async (): Promise<void> => {
		if (
			!key ||
			!root ||
			!head ||
			!workspaceId ||
			!commit ||
			fileRequest.current
		)
			return;

		const controller = new AbortController();

		fileRequest.current = controller;
		setPendingFiles(`${key}:${commit}`);

		try {
			const result = await readFiles(root, commit, controller.signal);

			if (controller.signal.aborted) return;

			onAction(
				workspaceId,
				result.ok
					? { type: "history-files", root, head, commit, files: result.value }
					: {
							type: "history-files-error",
							root,
							head,
							commit,
							message: result.error.message,
						}
			);
		} catch (failure) {
			if (!controller.signal.aborted)
				onAction(workspaceId, {
					type: "history-files-error",
					root,
					head,
					commit,
					message:
						failure instanceof Error
							? failure.message
							: "Could not read committed files.",
				});
		} finally {
			if (fileRequest.current === controller) {
				fileRequest.current = null;
				setPendingFiles(null);
			}
		}
	}, [key, root, head, workspaceId, commit, readFiles, onAction]);

	useEffect(() => {
		return () => {
			pageRequest.current?.abort();
			pageRequest.current = null;
			setPendingPage(null);
		};
	}, [key]);

	useEffect(() => {
		if (nextOffset === 0 && !error) void loadMore();
	}, [nextOffset, error, loadMore]);

	useEffect(() => {
		return () => {
			fileRequest.current?.abort();
			fileRequest.current = null;
			setPendingFiles(null);
		};
	}, [key, commit]);

	useEffect(() => {
		if (!loadedFiles && !filesError) void loadFiles();
	}, [loadedFiles, filesError, loadFiles]);

	return {
		loading: key !== null && pendingPage === key,
		loadingFiles: key !== null && pendingFiles === `${key}:${commit}`,
		loadMore: () => {
			void loadMore();
		},
		retryFiles: () => {
			void loadFiles();
		},
	};
}
