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
import type {
	RepositoryDiscovery,
	RepositoryDiscoveryPreferences,
	RepositoryDiscoveryProgress,
} from "./repository-discovery";

const emptyProgress: RepositoryDiscoveryProgress = {
	paths: [],
	scanned: 0,
	skipped: 0,
	limited: false,
};

/** Owns one window's cancellable discovery; only Home/Add starts the initial scan. */
export function useRepositoryDiscovery({
	enabled,
	scan,
	preferences,
	onPreferencesChange,
}: {
	enabled: boolean;
	scan?: typeof RepositoryDiscovery.scan;
	preferences: RepositoryDiscoveryPreferences;
	onPreferencesChange: Dispatch<SetStateAction<RepositoryDiscoveryPreferences>>;
}) {
	const renderer = useGpuixRequired();
	const [progress, setProgress] = useState(emptyProgress);

	const [status, setStatus] = useState<
		"idle" | "scanning" | "complete" | "stopped"
	>("idle");

	const [error, setError] = useState<string | null>(null);
	const [picking, setPicking] = useState(false);
	const request = useRef<AbortController | null>(null);
	const started = useRef(false);
	const mounted = useRef(true);
	const picker = useRef(false);

	const start = useCallback(
		(folders: readonly string[]) => {
			if (!scan) return;

			request.current?.abort();
			const controller = new AbortController();

			request.current = controller;
			setError(null);
			setStatus("scanning");
			// Retain usable results until the replacement scan produces its first batch.
			void (async () => {
				try {
					const result = await scan(
						[homedir(), ...folders],
						controller.signal,
						(next) => {
							if (!controller.signal.aborted && mounted.current)
								setProgress(next);
						}
					);

					if (!controller.signal.aborted && mounted.current) {
						setProgress(result);
						setStatus("complete");
					}
				} catch (cause) {
					if (!controller.signal.aborted && mounted.current) {
						setStatus("stopped");
						setError(
							cause instanceof Error
								? cause.message
								: "Could not discover repositories."
						);
					}
				}
			})();
		},
		[scan]
	);

	useEffect(() => {
		if (!enabled || !scan || started.current) return;

		started.current = true;
		start(preferences.folders);
	}, [enabled, scan, start, preferences.folders]);

	useEffect(() => {
		mounted.current = true;

		return () => {
			mounted.current = false;
			request.current?.abort();
		};
	}, []);

	const paths = useMemo(() => {
		const hidden = new Set(preferences.hidden);

		return progress.paths.filter((path) => !hidden.has(path));
	}, [progress.paths, preferences.hidden]);

	const chooseFolder = async (): Promise<void> => {
		if (picker.current || !scan) return;

		picker.current = true;
		setPicking(true);
		setError(null);

		try {
			if (!renderer.promptForPaths)
				throw new Error("Folder selection is unavailable.");

			const selected = await renderer.promptForPaths({
				directories: true,
				files: false,
				multiple: false,
				prompt: "Scan for repositories",
			});

			const folder = selected?.[0];

			if (!mounted.current || !folder) return;

			const folders = [...new Set([...preferences.folders, folder])];

			onPreferencesChange((current) => ({ ...current, folders }));
			start(folders);
		} catch (cause) {
			if (mounted.current)
				setError(
					cause instanceof Error ? cause.message : "Could not choose a folder."
				);
		} finally {
			picker.current = false;

			if (mounted.current) setPicking(false);
		}
	};

	return {
		paths,
		progress,
		status,
		error,
		picking,
		available: !!scan,
		rescan: () => start(preferences.folders),
		chooseFolder,
		stop: () => {
			request.current?.abort();
			setStatus("stopped");
		},
		hide: (path: string) =>
			onPreferencesChange((current) => ({
				...current,
				hidden: [...new Set([...current.hidden, path])],
			})),
	};
}
