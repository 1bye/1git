import { useGpuixRequired } from "@gpuix/react";
import {
	useCallback,
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
import {
	RepositorySetup,
	type RepositorySetupRequest,
	type RepositorySetupResult,
} from "../lib/repository-setup";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceAction,
} from "../lib/repository-workspace-model";

/** Owns native picking and cancellable reads. Reports confirmed repository paths after successful reads or setup writes. */
export function useRepositoryConnection(
	state: WorkspaceTabsState,
	dispatch: Dispatch<WorkspaceTabsAction>,
	readRepository: typeof RepositoryReader.read,
	setupRepository = RepositorySetup.write,
	onRepositoryReady?: (path: string) => void
) {
	const renderer = useGpuixRequired();
	const tabs = useRef(state.tabs);
	const requests = useRef(new Map<string, AbortController>());
	const mounted = useRef(true);
	const picking = useRef(false);
	const setups = useRef(new Map<string, AbortController>());
	const [pickingId, setPickingId] = useState<string | null>(null);

	useLayoutEffect(() => {
		tabs.current = state.tabs;

		for (const [id, request] of requests.current) {
			if (
				!state.tabs.some(
					(tab) =>
						tab.id === id && !RepositoryWorkspaceModel.isBusy(tab.workspace)
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
		const writes = setups.current;

		return () => {
			mounted.current = false;

			for (const request of pending.values()) request.abort();

			pending.clear();

			for (const request of writes.values()) request.abort();

			writes.clear();
		};
	}, []);

	const send = useCallback(
		(id: string, action: RepositoryWorkspaceAction): void => {
			if (mounted.current) dispatch({ type: "workspace", id, action });
		},
		[dispatch]
	);

	const read = useCallback(
		async (id: string, path: string): Promise<void> => {
			if (
				!mounted.current ||
				!tabs.current.some(
					(tab) =>
						tab.id === id && !RepositoryWorkspaceModel.isBusy(tab.workspace)
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

				if (result.ok) onRepositoryReady?.(result.value.repository.root);

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
		},
		[readRepository, send, onRepositoryReady]
	);

	useEffect(() => {
		for (const tab of tabs.current) {
			const workspace = tab.workspace;

			if (
				!workspace.repository &&
				workspace.repositoryPath &&
				workspace.loading &&
				!requests.current.has(tab.id)
			)
				void read(tab.id, workspace.repositoryPath);
		}
	}, [read, state.tabs]);

	const open = async (id: string): Promise<void> => {
		if (picking.current || setups.current.has(id)) return;

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

		if (path) {
			if (tabs.current.find((tab) => tab.id === id)?.kind === "empty")
				dispatch({ type: "fill", id, path });

			await read(id, path);
		}
	};

	const refresh = async (id: string): Promise<void> => {
		const workspace = tabs.current.find((tab) => tab.id === id)?.workspace;
		const path = workspace?.repository?.root ?? workspace?.repositoryPath;

		if (path) await read(id, path);
	};

	const setup = async (
		id: string,
		request: RepositorySetupRequest,
		blockClose: () => void
	): Promise<RepositorySetupResult> => {
		const tab = tabs.current.find((item) => item.id === id);

		if (
			!tab ||
			tab.workspace.preview ||
			tab.workspace.repository ||
			tab.workspace.loading ||
			picking.current ||
			setups.current.size ||
			RepositoryWorkspaceModel.isBusy(tab.workspace)
		)
			return {
				ok: false,
				message: "Wait for the current operation to finish.",
			};

		const controller = new AbortController();

		setups.current.set(id, controller);
		blockClose();
		send(id, { type: "operation-started" });
		let createdPath: string | undefined;

		try {
			const result = await setupRepository(request, controller.signal);

			if (!result.ok) return result;

			createdPath = result.path;

			if (mounted.current && !controller.signal.aborted)
				onRepositoryReady?.(result.path);

			// A successful write must not be repeated if only the subsequent read fails.
			const loaded = await readRepository(result.path, controller.signal);

			if (!loaded.ok)
				return {
					ok: false,
					message:
						"Repository created, but it could not be read. Try opening it again.",
					openPath: result.path,
				};

			send(id, {
				type: "operation-finished",
				snapshot: loaded.value,
				error: null,
			});

			return result;
		} catch {
			return {
				ok: false,
				openPath: createdPath,
				message: createdPath
					? "Repository created, but it could not be read. Try opening it again."
					: "Setup did not finish. Review the destination before retrying.",
			};
		} finally {
			setups.current.delete(id);
			send(id, { type: "operation-finished", error: null });
		}
	};

	return {
		open,
		refresh,
		pickingId,
		read,
		setup,
		cancelSetup: (id: string) => setups.current.get(id)?.abort(),
	};
}
