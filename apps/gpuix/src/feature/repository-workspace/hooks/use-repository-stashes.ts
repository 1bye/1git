import { useCallback, useEffect, useRef, useState } from "react";

import { RepositoryStashes } from "../lib/repository-stashes";
import type {
	RepositoryWorkspaceAction,
	RepositoryWorkspaceState,
} from "../lib/repository-workspace-model";

/** Reads the active stash view lazily; tab state owns snapshots and refresh generations. */
export function useRepositoryStashes(
	workspaceId: string | undefined,
	state: RepositoryWorkspaceState | undefined,
	onAction: (id: string, action: RepositoryWorkspaceAction) => void,
	readStashes = RepositoryStashes.read,
	readFiles = RepositoryStashes.readFiles
) {
	const active =
		state?.view === "stashes" &&
		!state.loading &&
		!state.commit.pending &&
		!state.branchPending &&
		!state.preview;

	const root = active ? state.repository?.root : undefined;
	const generation = state?.stashes.generation;

	const key =
		root && workspaceId ? `${workspaceId}:${root}:${generation}` : null;

	const loaded = state?.stashes.loaded;
	const error = state?.stashes.error;

	const revision = state?.entries.stashes.find(
		(entry) => entry.id === state.views.stashes.selectedId
	);

	const oid = revision?.stash?.oid;
	const loadedFiles = revision?.filesLoaded;
	const filesError = revision?.filesError;
	const listRequest = useRef<AbortController | null>(null);
	const fileRequest = useRef<AbortController | null>(null);
	const [pendingList, setPendingList] = useState<string | null>(null);
	const [pendingFiles, setPendingFiles] = useState<string | null>(null);

	const load = useCallback(async (): Promise<void> => {
		if (
			!key ||
			!root ||
			!workspaceId ||
			generation === undefined ||
			listRequest.current
		)
			return;

		const controller = new AbortController();

		listRequest.current = controller;
		setPendingList(key);

		try {
			const result = await readStashes(root, controller.signal);

			if (controller.signal.aborted) return;

			onAction(
				workspaceId,
				result.ok
					? { type: "stashes-loaded", root, generation, stashes: result.value }
					: {
							type: "stashes-error",
							root,
							generation,
							message: result.error.message,
						}
			);
		} catch (failure) {
			if (!controller.signal.aborted)
				onAction(workspaceId, {
					type: "stashes-error",
					root,
					generation,
					message:
						failure instanceof Error
							? failure.message
							: "Could not read stashes.",
				});
		} finally {
			if (listRequest.current === controller) {
				listRequest.current = null;
				setPendingList(null);
			}
		}
	}, [key, root, workspaceId, generation, readStashes, onAction]);

	const loadFiles = useCallback(async (): Promise<void> => {
		if (
			!key ||
			!root ||
			!workspaceId ||
			generation === undefined ||
			!loaded ||
			!oid ||
			fileRequest.current
		)
			return;

		const controller = new AbortController();

		fileRequest.current = controller;
		setPendingFiles(`${key}:${oid}`);

		try {
			const result = await readFiles(root, oid, controller.signal);

			if (controller.signal.aborted) return;

			onAction(
				workspaceId,
				result.ok
					? { type: "stash-files", root, generation, oid, files: result.value }
					: {
							type: "stash-files-error",
							root,
							generation,
							oid,
							message: result.error.message,
						}
			);
		} catch (failure) {
			if (!controller.signal.aborted)
				onAction(workspaceId, {
					type: "stash-files-error",
					root,
					generation,
					oid,
					message:
						failure instanceof Error
							? failure.message
							: "Could not read stashed files.",
				});
		} finally {
			if (fileRequest.current === controller) {
				fileRequest.current = null;
				setPendingFiles(null);
			}
		}
	}, [key, root, workspaceId, generation, loaded, oid, readFiles, onAction]);

	useEffect(
		() => () => {
			listRequest.current?.abort();
			listRequest.current = null;
			setPendingList(null);
		},
		[key]
	);

	useEffect(() => {
		if (!loaded && !error) void load();
	}, [loaded, error, load]);

	useEffect(
		() => () => {
			fileRequest.current?.abort();
			fileRequest.current = null;
			setPendingFiles(null);
		},
		[key, oid]
	);

	useEffect(() => {
		if (!loadedFiles && !filesError) void loadFiles();
	}, [loadedFiles, filesError, loadFiles]);

	return {
		loading: key !== null && pendingList === key,
		loadingFiles: key !== null && pendingFiles === `${key}:${oid}`,
		retry: () => {
			void load();
		},
		retryFiles: () => {
			void loadFiles();
		},
	};
}
