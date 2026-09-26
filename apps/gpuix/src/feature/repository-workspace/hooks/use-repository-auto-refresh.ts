import {
	createRendererState,
	registerEventHandler,
	unregisterEventHandler,
} from "@gpuix/native/host";
import { useGpuixRequired } from "@gpuix/react";
import { useEffect, useLayoutEffect, useRef, type Dispatch } from "react";
import type {
	WorkspaceTabsAction,
	WorkspaceTabsState,
} from "../../workspace-tabs/lib/workspace-tabs-model";
import type { RepositoryReader } from "../lib/repository-reader";
import { RepositoryRefresh } from "../lib/repository-refresh";
import type { RepositoryWatcher } from "../lib/repository-watcher";
import type { RepositoryWorkspaceAction } from "../lib/repository-workspace-model";

/** Shares one watcher/read queue per root, suspending it for any tab's explicit read or write. */
export function useRepositoryAutoRefresh(
	state: WorkspaceTabsState,
	dispatch: Dispatch<WorkspaceTabsAction>,
	readRepository: typeof RepositoryReader.read,
	watchRepository: typeof RepositoryWatcher.watch | undefined
) {
	const renderer = useGpuixRequired();
	const tabs = useRef(state.tabs);

	const monitors = useRef(
		new Map<
			string,
			{ key: string; refresh: RepositoryRefresh; stop: () => void }
		>()
	);

	useLayoutEffect(() => {
		tabs.current = state.tabs;

		for (const [root, monitor] of monitors.current) {
			monitor.refresh.setPaused(
				state.tabs.some(
					(tab) =>
						tab.workspace.repository?.root === root &&
						(tab.workspace.commit.pending || tab.workspace.loading)
				)
			);
		}
	}, [state.tabs]);

	useEffect(() => {
		const active = monitors.current;
		const handlers = createRendererState(renderer).current()?.eventHandlers;

		if (watchRepository && handlers)
			registerEventHandler(handlers, 0, "windowActivated", () => {
				for (const monitor of active.values()) monitor.refresh.invalidate();
			});

		return () => {
			if (watchRepository && handlers)
				unregisterEventHandler(handlers, 0, "windowActivated");

			for (const monitor of active.values()) {
				monitor.stop();
				monitor.refresh.dispose();
			}

			active.clear();
		};
	}, [renderer, watchRepository, readRepository, dispatch]);

	useEffect(() => {
		if (!watchRepository) return;

		const repositories = new Map(
			state.tabs.flatMap((tab) =>
				tab.workspace.repository && !tab.workspace.preview
					? [[tab.workspace.repository.root, tab.workspace.repository] as const]
					: []
			)
		);

		for (const [root, monitor] of monitors.current) {
			const repository = repositories.get(root);

			const key = repository
				? JSON.stringify([repository.gitDirectory, repository.commonDirectory])
				: null;

			if (key !== monitor.key) {
				monitor.stop();
				monitor.refresh.dispose();
				monitors.current.delete(root);
			}
		}

		for (const [root, repository] of repositories) {
			if (monitors.current.has(root)) continue;

			const send = (action: RepositoryWorkspaceAction): void => {
				for (const tab of tabs.current) {
					if (tab.workspace.repository?.root === root)
						dispatch({ type: "workspace", id: tab.id, action });
				}
			};

			const refresh = new RepositoryRefresh(
				async (signal) => {
					const result = await readRepository(root, signal);

					if (signal.aborted) return;

					send(
						result.ok
							? { type: "loaded", snapshot: result.value, automatic: true }
							: { type: "load-error", message: result.error.message }
					);
				},
				(message) => send({ type: "load-error", message })
			);

			refresh.setPaused(
				state.tabs.some(
					(tab) =>
						tab.workspace.repository?.root === root &&
						(tab.workspace.loading || tab.workspace.commit.pending)
				)
			);
			const stop = watchRepository(
				repository,
				() => refresh.invalidate(),
				(message) => send({ type: "watch-error", message })
			);

			monitors.current.set(root, {
				key: JSON.stringify([
					repository.gitDirectory,
					repository.commonDirectory,
				]),
				refresh,
				stop,
			});
			// Close the gap between the initial snapshot and installing the watcher.
			refresh.invalidate();
		}
	}, [state.tabs, watchRepository, readRepository, dispatch]);
}
