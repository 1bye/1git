import { useCallback, useEffect, useRef, useState } from "react";

import { RepositoryHistory } from "../lib/repository-history";
import { RepositoryTags } from "../lib/repository-tags";
import type { TagInfo } from "@1git/git";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceAction,
	type RepositoryWorkspaceState,
} from "../lib/repository-workspace-model";

const emptyTags: readonly TagInfo[] = [];

/** Loads only the active tab/view; completed pages and file lists live in workspace state. */
export function useRepositoryHistory(
	workspaceId: string | undefined,
	state: RepositoryWorkspaceState | undefined,
	onAction: (id: string, action: RepositoryWorkspaceAction) => void,
	readHistory = RepositoryHistory.read,
	readFiles = RepositoryHistory.readFiles,
	readTags = RepositoryTags.read,
	readCount = RepositoryHistory.readCount
) {
	const active =
		state?.view === "history" &&
		!state.loading &&
		!RepositoryWorkspaceModel.isBusy(state) &&
		!state.preview;

	const root = active ? state.repository?.root : undefined;
	const head = active ? state.repository?.head : undefined;
	const countKnown = state?.historyCount !== undefined;
	const metadataVersion = state?.metadataVersion ?? 0;
	const query = state?.history.query ?? "";
	const file = state?.history.file;

	const key =
		root && head && workspaceId
			? JSON.stringify([
					workspaceId,
					root,
					head,
					query,
					file?.path,
					file?.revision,
				])
			: null;

	const nextOffset = state?.history.nextOffset;
	const error = state?.history.error;
	const restoring = state?.restoreHistoryLimit !== undefined;

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

	const tagKey =
		root && workspaceId
			? JSON.stringify([workspaceId, root, state?.metadataVersion ?? 0])
			: null;

	const [tagRead, setTagRead] = useState<{
		key: string;
		tags: readonly TagInfo[];
		error: string | null;
	} | null>(null);

	const [tagRetry, setTagRetry] = useState(0);

	useEffect(() => {
		if (!root || !head || !workspaceId || countKnown) return;

		const controller = new AbortController();

		const load = async (): Promise<void> => {
			try {
				const result = await readCount(root, head, controller.signal);

				if (!controller.signal.aborted)
					onAction(workspaceId, {
						type: "history-count",
						root,
						head,
						metadataVersion,
						total: result.ok ? result.value : null,
						error: result.ok ? null : result.error.message,
					});
			} catch {
				if (!controller.signal.aborted)
					onAction(workspaceId, {
						type: "history-count",
						root,
						head,
						metadataVersion,
						total: null,
						error: "Could not count commits.",
					});
			}
		};

		void load();

		return () => controller.abort();
	}, [
		root,
		head,
		workspaceId,
		countKnown,
		metadataVersion,
		readCount,
		onAction,
	]);

	useEffect(() => {
		if (!tagKey || !root) return;

		const controller = new AbortController();

		const load = async (): Promise<void> => {
			try {
				const result = await readTags(root, controller.signal);

				if (!controller.signal.aborted)
					setTagRead({
						key: tagKey,
						tags: result.ok ? result.value : emptyTags,
						error: result.ok ? null : result.error.message,
					});
			} catch {
				if (!controller.signal.aborted)
					setTagRead({
						key: tagKey,
						tags: emptyTags,
						error: "Could not read tags.",
					});
			}
		};

		void load();

		return () => controller.abort();
	}, [tagKey, root, readTags, tagRetry]);

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
				controller.signal,
				query,
				file
			);

			if (controller.signal.aborted) return;

			onAction(
				workspaceId,
				result.ok
					? {
							type: "history-page",
							query,
							file,
							root,
							head,
							offset: nextOffset,
							page: result.value,
						}
					: {
							type: "history-error",
							file,
							root,
							head,
							query,
							message: result.error.message,
						}
			);
		} catch (failure) {
			if (!controller.signal.aborted)
				onAction(workspaceId, {
					type: "history-error",
					file,
					query,
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
	}, [
		key,
		root,
		head,
		workspaceId,
		nextOffset,
		readHistory,
		onAction,
		query,
		file,
	]);

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
					? {
							type: "history-files",
							root,
							head,
							commit,
							file,
							files: result.value,
						}
					: {
							type: "history-files-error",
							file,
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
					file,
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
	}, [key, root, head, workspaceId, commit, readFiles, onAction, file]);

	useEffect(() => {
		return () => {
			pageRequest.current?.abort();
			pageRequest.current = null;
			setPendingPage(null);
		};
	}, [key]);

	useEffect(() => {
		if ((nextOffset !== 0 && !restoring) || error) return;

		if (!query) {
			void loadMore();

			return;
		}

		const timer = setTimeout(() => {
			void loadMore();
		}, 250);

		return () => clearTimeout(timer);
	}, [nextOffset, restoring, error, loadMore, query]);

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
		tags: tagRead?.key === tagKey ? tagRead.tags : emptyTags,
		tagsError: tagRead?.key === tagKey ? tagRead.error : null,
		retryTags: () => setTagRetry((value) => value + 1),
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
