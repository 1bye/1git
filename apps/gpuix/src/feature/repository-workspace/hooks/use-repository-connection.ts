import { useGpuixRequired } from "@gpuix/react";
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type Dispatch,
} from "react";

import type {
	WorkspaceTabsAction,
	WorkspaceTabsState,
} from "../../workspace-tabs/lib/workspace-tabs-model";
import { RepositoryReader } from "../lib/repository-reader";
import type { RepositoryWorkspaceAction } from "../lib/repository-workspace-model";

/** Owns native picking and cancellable reads; results always belong to the requesting tab. */
export function useRepositoryConnection(
	state: WorkspaceTabsState,
	dispatch: Dispatch<WorkspaceTabsAction>,
	readRepository: typeof RepositoryReader.read
) {
	const renderer = useGpuixRequired();
	const tabs = useRef(state.tabs);
	const requests = useRef(new Map<string, AbortController>());
	const mounted = useRef(true);
	const picking = useRef(false);
	const [pickingId, setPickingId] = useState<string | null>(null);

	useLayoutEffect(() => {
		tabs.current = state.tabs;

		for (const [id, request] of requests.current) {
			if (
				!state.tabs.some(
					(tab) => tab.id === id && !tab.workspace.commit.pending
				)
			) {
				request.abort();
				requests.current.delete(id);
			}
		}
	}, [state.tabs]);

	useEffect(() => {
		mounted.current = true;
		const pending = requests.current;

		return () => {
			mounted.current = false;

			for (const request of pending.values()) request.abort();

			pending.clear();
		};
	}, []);

	const send = (id: string, action: RepositoryWorkspaceAction): void => {
		if (mounted.current) dispatch({ type: "workspace", id, action });
	};

	const read = async (id: string, path: string): Promise<void> => {
		if (
			!mounted.current ||
			!tabs.current.some(
				(tab) => tab.id === id && !tab.workspace.commit.pending
			)
		)
			return;

		requests.current.get(id)?.abort();
		const request = new AbortController();

		requests.current.set(id, request);
		send(id, { type: "loading" });

		try {
			const result = await readRepository(path, request.signal);

			if (request.signal.aborted) return;

			send(
				id,
				result.ok
					? { type: "loaded", snapshot: result.value }
					: { type: "load-error", message: result.error.message }
			);
		} catch (error) {
			if (!request.signal.aborted)
				send(id, {
					type: "load-error",
					message:
						error instanceof Error
							? error.message
							: "Could not read this repository.",
				});
		} finally {
			if (requests.current.get(id) === request) requests.current.delete(id);
		}
	};

	const open = async (id: string): Promise<void> => {
		if (picking.current) return;

		picking.current = true;
		setPickingId(id);
		let path: string | undefined;

		try {
			if (!renderer.promptForPaths)
				throw new Error("Folder selection is unavailable on this platform.");

			const paths = await renderer.promptForPaths({
				directories: true,
				files: false,
				multiple: false,
				prompt: "Open repository",
			});

			path = paths?.[0];
		} catch (error) {
			send(id, {
				type: "load-error",
				message:
					error instanceof Error
						? error.message
						: "Could not open the folder picker.",
			});
		} finally {
			picking.current = false;

			if (mounted.current) setPickingId(null);
		}

		if (path) await read(id, path);
	};

	const refresh = async (id: string): Promise<void> => {
		const repository = tabs.current.find((tab) => tab.id === id)?.workspace
			.repository;

		if (repository) await read(id, repository.root);
	};

	return { open, refresh, pickingId };
}
