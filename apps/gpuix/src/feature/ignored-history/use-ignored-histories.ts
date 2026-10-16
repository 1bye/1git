import { watch, type FSWatcher } from "node:fs";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	IgnoredHistory,
	type IgnoredHistoryState,
	type IgnoredRepository,
} from "./ignored-history";

/** No content is retained in React state; each open local worktree has one capture lifecycle. */
export interface IgnoredHistoryStatus {
	readonly data?: IgnoredHistoryState;
	readonly error?: string;
	readonly busy: boolean;
}

/** Captures inactive tabs too; events are debounced and periodic scans reconcile missed events. */
export function useIgnoredHistories(
	repositories: readonly IgnoredRepository[],
	history: IgnoredHistory
) {
	const [statuses, setStatuses] = useState<
		Readonly<Record<string, IgnoredHistoryStatus>>
	>({});

	const latest = useRef(repositories);
	const refreshers = useRef(new Map<string, () => Promise<void>>());

	const signature = JSON.stringify(
		repositories
			.map(({ root, commonDirectory, gitDirectory }) => [
				root,
				commonDirectory,
				gitDirectory,
			])
			.sort()
	);

	useLayoutEffect(() => {
		latest.current = repositories;
	}, [repositories]);

	useEffect(() => {
		let disposed = false;
		const stops: (() => void)[] = [];

		const roots = new Map(
			latest.current.map((repository) => [repository.root, repository])
		);

		for (const repository of roots.values()) {
			let running = false;
			let again = false;
			let watcher: FSWatcher | undefined;
			let debounce: ReturnType<typeof setTimeout> | undefined;
			let enabled = false;
			let paused = false;
			const controller = new AbortController();

			const update = (status: IgnoredHistoryStatus) => {
				if (!disposed)
					setStatuses((current) => ({ ...current, [repository.root]: status }));
			};

			let data: IgnoredHistoryState | undefined;

			const refresh = async () => {
				if (disposed) return;

				if (running) {
					again = true;

					return;
				}

				running = true;

				try {
					const preferences = await history.preferences(repository);

					enabled = preferences.enabled;
					data ??= { preferences, files: [], bytes: 0, skipped: [] };
					data = await history.refresh(repository, controller.signal);
					enabled = data.preferences.enabled;
					paused = false;

					if (enabled && !watcher) {
						try {
							watcher = watch(
								repository.root,
								{ recursive: true },
								(_event, name) => {
									if (paused || name?.split(/[\\/]/u).includes(".git")) return;

									if (name && !name.endsWith(".gitignore")) {
										const path = name.replaceAll("\\", "/");

										if (
											!data?.preferences.paths.some(
												(selection) =>
													path === selection ||
													path.startsWith(`${selection}/`) ||
													selection.startsWith(`${path}/`)
											)
										)
											return;
									}

									clearTimeout(debounce);
									debounce = setTimeout(() => {
										void refresh();
									}, 600);
								}
							);
							watcher.on("error", () => {
								watcher?.close();
								watcher = undefined;
							});
						} catch {
							/* Periodic reconciliation remains available without native watching. */
						}
					}

					if (!enabled) {
						watcher?.close();
						watcher = undefined;
					}

					update({ data, busy: false });
				} catch (error) {
					paused = true;
					update({
						data,
						busy: false,
						error:
							error instanceof Error
								? error.message
								: "Ignored history could not be refreshed.",
					});
				} finally {
					running = false;

					if (again && !disposed) {
						again = false;
						void refresh();
					}
				}
			};

			refreshers.current.set(repository.root, refresh);
			void refresh();
			const timer = setInterval(() => {
				if (enabled && !paused) void refresh();
			}, 15_000);

			stops.push(() => {
				controller.abort();
				history.release(repository.root);
				clearInterval(timer);
				clearTimeout(debounce);
				watcher?.close();
				refreshers.current.delete(repository.root);
			});
		}

		return () => {
			disposed = true;

			for (const stop of stops) stop();
		};
	}, [history, signature]);

	const refresh = useCallback(async (root: string) => {
		await refreshers.current.get(root)?.();
	}, []);

	return { statuses, refresh };
}
