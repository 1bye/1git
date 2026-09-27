import { useEffect, useState } from "react";

import {
	RepositoryDiff,
	type RepositoryDiffSection,
	type DiffSelection,
} from "../lib/repository-diff";

/** Active-file read lifecycle; selection, refresh, view/tab changes and unmount cancel stale work. */
export function useRepositoryDiff(
	root: string,
	change: DiffSelection,
	paused: boolean,
	readDiff: typeof RepositoryDiff.read
) {
	const [retry, setRetry] = useState(0);

	const [result, setResult] = useState<{
		root: string;
		change: DiffSelection;
		retry: number;
		sections: readonly RepositoryDiffSection[];
		error: string | null;
	} | null>(null);

	useEffect(() => {
		if (paused) return;

		const controller = new AbortController();

		const read = async (): Promise<void> => {
			try {
				const response = await readDiff(root, change, controller.signal);

				if (controller.signal.aborted) return;

				setResult({
					root,
					change,
					retry,
					sections: response.ok ? response.value : [],
					error: response.ok ? null : response.error.message,
				});
			} catch (error) {
				if (!controller.signal.aborted)
					setResult({
						root,
						change,
						retry,
						sections: [],
						error:
							error instanceof Error
								? error.message
								: "Could not read this diff.",
					});
			}
		};

		void read();

		return () => controller.abort();
	}, [root, change, paused, readDiff, retry]);

	const current =
		!paused &&
		result?.root === root &&
		result.change.path === change.path &&
		("commit" in result.change ? result.change.commit : null) ===
			("commit" in change ? change.commit : null) &&
		("commit" in result.change ? result.change.base : null) ===
			("commit" in change ? change.base : null) &&
		result.retry === retry
			? result
			: null;

	// Keep the native list mounted while re-reading the same file. It preserves its
	// logical scroll anchor when its patch changes; a new selection never reuses it.
	return { result: current, retry: () => setRetry((value) => value + 1) };
}
