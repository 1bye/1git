import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type Dispatch,
	type SetStateAction,
} from "react";
import { useGpuixRequired } from "@gpuix/react";
import { homedir } from "node:os";
import {
	RepositoryDiscovery,
	type RepositoryDiscoveryPreferences,
	type RepositoryDiscoveryProgress,
} from "./repository-discovery";

const emptyProgress: RepositoryDiscoveryProgress = {
	paths: [],
	scanned: 0,
	skipped: 0,
	limited: false,
};

type ScanStatus = "idle" | "scanning" | "complete" | "stopped" | "unavailable";
interface FolderScan {
	readonly scope: string;
	readonly canonicalPath: string;
	readonly progress: RepositoryDiscoveryProgress;
	readonly status: ScanStatus;
	readonly error?: string;
}

/** Per-root cached scans; navigation is free and adding a folder never restarts Home. */
export function useRepositoryDiscovery({
	enabled,
	scan,
	preferences,
	onPreferencesChange,
	home = homedir(),
	remote = false,
	scanHome = true,
}: {
	enabled: boolean;
	scan?: typeof RepositoryDiscovery.scan;
	preferences: RepositoryDiscoveryPreferences;
	onPreferencesChange: Dispatch<SetStateAction<RepositoryDiscoveryPreferences>>;
	home?: string;
	remote?: boolean;
	/** Custom spaces scan only explicitly assigned folders. */
	scanHome?: boolean;
}) {
	const renderer = useGpuixRequired();

	const [runs, setRuns] = useState<ReadonlyMap<string, FolderScan>>(
		() => new Map()
	);

	const [pickerError, setPickerError] = useState<string | null>(null);
	const [picking, setPicking] = useState(false);
	const active = useRef(new Map<string, AbortController>());
	const pending = useRef(new Map<string, AbortController>());
	const started = useRef(new Set<string>());
	const mounted = useRef(true);
	const picker = useRef(false);

	const start = useCallback(
		(folders: readonly string[]) => {
			if (!scan) return;

			setPickerError(null);

			for (const path of new Set(folders)) {
				active.current.get(path)?.abort();
				pending.current.get(path)?.abort();
				pending.current.set(path, new AbortController());
				setRuns((current) =>
					new Map(current).set(path, {
						canonicalPath: current.get(path)?.canonicalPath ?? path,
						scope: home,
						progress: current.get(path)?.progress ?? emptyProgress,
						status: "scanning",
					})
				);
			}

			const pump = (): void => {
				if (!mounted.current) return;

				// Each scanner already has four workers. Bound simultaneous roots as well.
				for (const [path, controller] of pending.current) {
					if (active.current.size >= 2) break;

					if (active.current.has(path)) continue;

					pending.current.delete(path);
					active.current.set(path, controller);
					void (async () => {
						const update = (patch: Partial<FolderScan>): void => {
							if (controller.signal.aborted || !mounted.current) return;

							setRuns((current) => {
								const previous = current.get(path);

								return previous
									? new Map(current).set(path, { ...previous, ...patch })
									: current;
							});
						};

						try {
							const canonicalPath = remote
								? path
								: await RepositoryDiscovery.resolveFolder(path);

							if (controller.signal.aborted) return;

							update({ canonicalPath });
							const result = await scan(
								[canonicalPath],
								controller.signal,
								(progress) => update({ progress })
							);

							const unavailable = result.scanned === 0 && result.skipped > 0;

							update({
								progress: result,
								status: unavailable ? "unavailable" : "complete",
							});
						} catch (cause) {
							update({
								status: "unavailable",
								error:
									cause instanceof Error
										? cause.message
										: "Could not discover repositories.",
							});
						} finally {
							active.current.delete(path);
							pump();
						}
					})();
				}
			};

			pump();
		},
		[scan, home, remote]
	);

	useEffect(() => {
		if (!enabled || !scan) return;

		const roots = [...(scanHome ? [home] : []), ...preferences.folders].filter(
			(path) => !started.current.has(`${home}:${path}`)
		);

		for (const path of roots) started.current.add(`${home}:${path}`);

		if (roots.length) start(roots);
	}, [enabled, scan, start, preferences.folders, home, scanHome]);

	useEffect(() => {
		mounted.current = true;
		const requests = active.current;
		const queue = pending.current;

		return () => {
			mounted.current = false;

			for (const controller of [...requests.values(), ...queue.values()])
				controller.abort();

			queue.clear();
		};
	}, []);

	const visibleRuns = useMemo(
		() =>
			new Map(
				[...runs].filter(
					([path, run]) =>
						run.scope === home &&
						(scanHome || preferences.folders.includes(path))
				)
			),
		[runs, home, scanHome, preferences.folders]
	);

	const progress = useMemo(() => {
		const paths = new Set<string>();
		let scanned = 0;
		let skipped = 0;
		let limited = false;

		for (const run of visibleRuns.values()) {
			for (const path of run.progress.paths) paths.add(path);

			scanned += run.progress.scanned;
			skipped += run.progress.skipped;
			limited ||= run.progress.limited;
		}

		return { paths: [...paths], scanned, skipped, limited };
	}, [visibleRuns]);

	const paths = useMemo(() => {
		const hidden = new Set(preferences.hidden);

		return progress.paths.filter((path) => !hidden.has(path));
	}, [progress.paths, preferences.hidden]);

	const knownPaths = useMemo(() => {
		const hidden = new Set(preferences.hidden);

		return [
			...new Set(
				[...(scanHome ? runs : visibleRuns).values()].flatMap(
					(run) => run.progress.paths
				)
			),
		].filter((path) => !hidden.has(path));
	}, [runs, visibleRuns, scanHome, preferences.hidden]);

	const scanning = [...visibleRuns.values()].some(
		(run) => run.status === "scanning"
	);

	const stopped = [...visibleRuns.values()].some(
		(run) => run.status === "stopped" || run.status === "unavailable"
	);

	const status = scanning
		? "scanning"
		: stopped
			? "stopped"
			: visibleRuns.size
				? "complete"
				: "idle";

	const error =
		pickerError ??
		[...visibleRuns.values()].find((run) => run.error)?.error ??
		null;

	const folders = useMemo(
		() =>
			preferences.folders.map((path) => ({
				path,
				canonicalPath: runs.get(path)?.canonicalPath ?? path,
				status: runs.get(path)?.status ?? "idle",
			})),
		[preferences.folders, runs]
	);

	const chooseFolder = async (): Promise<void> => {
		if (picker.current || !scan) return;

		picker.current = true;
		setPicking(true);
		setPickerError(null);

		try {
			if (!renderer.promptForPaths)
				throw new Error("Folder selection is unavailable.");

			const selected = await renderer.promptForPaths({
				directories: true,
				files: false,
				multiple: false,
				prompt: "Add a repository folder",
			});

			if (!selected?.[0]) return;

			const folder = await RepositoryDiscovery.resolveFolder(selected[0]);

			if (!mounted.current) return;

			onPreferencesChange((current) => ({
				...current,
				folders: [...new Set([...current.folders, folder])],
			}));
			start([folder]);
		} catch (cause) {
			if (mounted.current)
				setPickerError(
					cause instanceof Error ? cause.message : "Could not choose a folder."
				);
		} finally {
			picker.current = false;

			if (mounted.current) setPicking(false);
		}
	};

	return {
		paths,
		knownPaths,
		progress,
		status,
		error,
		picking,
		available: !!scan,
		folders,
		rescan: (folder?: string) =>
			start(
				folder
					? [folder]
					: [...(scanHome ? [home] : []), ...preferences.folders]
			),
		chooseFolder,
		removeFolder: (path: string) => {
			active.current.get(path)?.abort();
			pending.current.get(path)?.abort();
			pending.current.delete(path);
			setRuns((current) => {
				const next = new Map(current);

				next.delete(path);

				return next;
			});
			onPreferencesChange((current) => ({
				...current,
				folders: current.folders.filter((folder) => folder !== path),
			}));
		},
		stop: () => {
			for (const controller of [
				...active.current.values(),
				...pending.current.values(),
			])
				controller.abort();

			pending.current.clear();
			setRuns(
				(current) =>
					new Map(
						[...current].map(([path, run]) => [
							path,
							run.status === "scanning" ? { ...run, status: "stopped" } : run,
						])
					)
			);
		},
		hide: (path: string) =>
			onPreferencesChange((current) => ({
				...current,
				hidden: [...new Set([...current.hidden, path])],
			})),
	};
}
