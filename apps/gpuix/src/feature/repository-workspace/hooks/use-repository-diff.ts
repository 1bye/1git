import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
	RepositoryDiff,
	type RepositoryDiffSection,
	type DiffSelection,
} from "../lib/repository-diff";
import { RepositoryPreviewCache } from "../lib/repository-preview-cache";
import type { WorkspaceEntry } from "../types";

/** Content and its identity move together; pending requests never relabel old pixels. */
export interface RepositoryPreviewResult {
	readonly cache: RepositoryPreviewCache;
	readonly root: string;
	readonly key: string;
	readonly change: DiffSelection;
	readonly retry: number;
	readonly sections: readonly RepositoryDiffSection[];
	readonly error: string | null;
	readonly ignoreWhitespace: boolean;
}

const loadingDelayMs = 200;
const neighbourDelayMs = 120;

/** Active-file read lifecycle; selection, refresh, view/tab changes and unmount cancel stale work. */
export function useRepositoryDiff(
	root: string,
	change: DiffSelection,
	paused: boolean,
	readDiff: typeof RepositoryDiff.read,
	suppliedCache?: RepositoryPreviewCache,
	suppliedVersion?: object,
	files?: readonly WorkspaceEntry[],
	ignoreWhitespace = false
) {
	const [retry, setRetry] = useState(0);
	const [result, setResult] = useState<RepositoryPreviewResult | null>(null);
	const [slowRequest, setSlowRequest] = useState<string | null>(null);
	const lastReady = useRef<RepositoryPreviewResult | null>(null);

	const cache = useMemo(
		() => suppliedCache ?? new RepositoryPreviewCache(readDiff),
		[suppliedCache, readDiff]
	);

	const version = suppliedVersion ?? readDiff;

	const request = useMemo(
		() => ({ root, change, version, ignoreWhitespace }),
		[root, change, version, ignoreWhitespace]
	);

	const key = cache.key(request);
	const progressKey = `${key}:${retry}`;
	const cached = paused ? undefined : cache.peek(request);

	const settled =
		!paused &&
		result?.cache === cache &&
		result.key === key &&
		result.retry === retry
			? result
			: null;

	const current = useMemo(
		() =>
			cached
				? {
						cache,
						root,
						key,
						change,
						retry,
						sections: cached,
						error: null,
						ignoreWhitespace,
					}
				: settled,
		[cache, root, key, change, retry, cached, settled, ignoreWhitespace]
	);

	// Remember committed cache hits before painting, not after an asynchronous read effect.
	useLayoutEffect(() => {
		if (current && !current.error) lastReady.current = current;
	}, [current]);

	const pending = current === null;

	const displayed =
		current ?? (lastReady.current?.root === root ? lastReady.current : null);

	useEffect(
		() => () => {
			if (!suppliedCache) cache.dispose();
			else queueMicrotask(() => cache.cancelPrefetch());
		},
		[cache, suppliedCache]
	);

	useEffect(() => {
		setSlowRequest(null);

		if (paused) {
			cache.invalidateWorking(root);

			return;
		}

		const controller = new AbortController();
		const timer = setTimeout(() => setSlowRequest(progressKey), loadingDelayMs);

		const read = async (): Promise<void> => {
			try {
				const response = await cache.read(request, controller.signal);

				if (controller.signal.aborted) return;

				setResult({
					cache,
					root,
					key,
					change,
					retry,
					sections: response.ok ? response.value : [],
					ignoreWhitespace,
					error: response.ok ? null : response.error.message,
				});
			} catch (error) {
				if (!controller.signal.aborted)
					setResult({
						cache,
						root,
						key,
						change,
						retry,
						sections: [],
						ignoreWhitespace,
						error:
							error instanceof Error
								? error.message
								: "Could not read this diff.",
					});
			} finally {
				clearTimeout(timer);
			}
		};

		void read();

		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [
		cache,
		request,
		root,
		change,
		key,
		progressKey,
		paused,
		retry,
		ignoreWhitespace,
	]);

	const readySections = current?.error ? undefined : current?.sections;

	useEffect(() => {
		if (!readySections || paused || !files) return;

		const index = files.findIndex(
			(entry) => (entry.change ?? entry.commitFile)?.path === change.path
		);

		if (index < 0) return;

		const neighbours = [files[index + 1], files[index - 1]].flatMap((entry) => {
			const selection = entry?.change ?? entry?.commitFile;

			return selection
				? [{ root, change: selection, version, ignoreWhitespace }]
				: [];
		});

		const timer = setTimeout(
			() => cache.prefetch(neighbours),
			neighbourDelayMs
		);

		return () => clearTimeout(timer);
	}, [
		cache,
		root,
		change.path,
		version,
		key,
		readySections,
		paused,
		files,
		ignoreWhitespace,
	]);

	return {
		result: displayed,
		pending,
		slow: pending && slowRequest === progressKey,
		retry: () => {
			cache.forget(request);
			setRetry((value) => value + 1);
		},
	};
}
