import type { CodeView } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import {
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
} from "react";
import type { RepositoryCodeViewAnnotation } from "@/fixture/repository-workspace/lib/repository-code-view.js";
import type { RepositoryDiffFileEntry } from "@/fixture/repository-workspace/lib/repository-diff-files.js";

interface UseRepositoryDiffScrollSyncOptions {
	readonly activePath: string | null;
	readonly contentKey: string;
	readonly entries: readonly RepositoryDiffFileEntry[];
	readonly onActivePathChange: (path: string) => void;
	readonly viewerRef: RefObject<CodeViewHandle<RepositoryCodeViewAnnotation> | null>;
}

const ACTIVE_PATH_SETTLE_MS = 80;
const DIFF_HEADER_OFFSET = 58;
const SCROLL_END_EPSILON = 1;

interface RepositoryDiffActivePathScheduler {
	readonly cancel: () => void;
	readonly flush: () => void;
	readonly schedule: (path: string) => void;
}

export const createRepositoryDiffActivePathScheduler = (
	onCommit: (path: string) => void,
	settleMs = ACTIVE_PATH_SETTLE_MS
): RepositoryDiffActivePathScheduler => {
	let pendingPath: string | null = null;
	let settleTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
	const cancel = (): void => {
		if (settleTimer !== null) {
			globalThis.clearTimeout(settleTimer);
			settleTimer = null;
		}
		pendingPath = null;
	};
	const flush = (): void => {
		if (settleTimer !== null) {
			globalThis.clearTimeout(settleTimer);
			settleTimer = null;
		}
		const path = pendingPath;
		pendingPath = null;
		if (path) {
			onCommit(path);
		}
	};
	const schedule = (path: string): void => {
		pendingPath = path;
		if (settleTimer !== null) {
			globalThis.clearTimeout(settleTimer);
		}
		settleTimer = globalThis.setTimeout(flush, settleMs);
	};
	return { cancel, flush, schedule };
};

export const getRepositoryCodeViewActiveEntry = (
	entries: readonly RepositoryDiffFileEntry[],
	viewer: Pick<
		CodeView<RepositoryCodeViewAnnotation>,
		"getHeight" | "getScrollHeight" | "getTopForItem"
	>,
	scrollTop: number
): RepositoryDiffFileEntry | null => {
	if (entries.length === 0) {
		return null;
	}
	if (
		viewer.getScrollHeight() > viewer.getHeight() + SCROLL_END_EPSILON &&
		scrollTop + viewer.getHeight() >=
			viewer.getScrollHeight() - SCROLL_END_EPSILON
	) {
		return entries.at(-1) ?? null;
	}
	const viewportTop = scrollTop + DIFF_HEADER_OFFSET;
	let low = 0;
	let high = entries.length - 1;
	let activeIndex = 0;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const entry = entries[middle];
		const itemTop = entry ? viewer.getTopForItem(entry.key) : undefined;
		if (itemTop === undefined || itemTop > viewportTop) {
			high = middle - 1;
		} else {
			activeIndex = middle;
			low = middle + 1;
		}
	}
	return entries[activeIndex] ?? null;
};

export const useRepositoryDiffScrollSync = ({
	activePath,
	contentKey,
	entries,
	onActivePathChange,
	viewerRef,
}: UseRepositoryDiffScrollSyncOptions): ((
	scrollTop: number,
	viewer: CodeView<RepositoryCodeViewAnnotation>
) => void) => {
	const activePathRef = useRef(activePath);
	const entriesRef = useRef(entries);
	const observedActivePathRef = useRef<string | null>(null);
	const onActivePathChangeRef = useRef(onActivePathChange);
	const synchronizingActivePathRef = useRef<string | null>(null);
	const schedulerRef = useRef<RepositoryDiffActivePathScheduler | null>(null);
	activePathRef.current = activePath;
	entriesRef.current = entries;
	onActivePathChangeRef.current = onActivePathChange;

	if (schedulerRef.current === null) {
		schedulerRef.current = createRepositoryDiffActivePathScheduler((path) => {
			if (path === activePathRef.current) {
				return;
			}
			activePathRef.current = path;
			observedActivePathRef.current = path;
			onActivePathChangeRef.current(path);
		});
	}

	useLayoutEffect(() => {
		const scheduler = schedulerRef.current;
		scheduler?.cancel();
		if (!(activePath && contentKey)) {
			synchronizingActivePathRef.current = null;
			return;
		}
		const wasObservedPath = observedActivePathRef.current === activePath;
		observedActivePathRef.current = null;
		if (wasObservedPath) {
			return;
		}
		const entry = entriesRef.current.find(
			(candidate) => candidate.path === activePath
		);
		if (!entry) {
			synchronizingActivePathRef.current = null;
			return;
		}
		synchronizingActivePathRef.current = activePath;
		viewerRef.current?.scrollTo({
			align: "start",
			behavior: "instant",
			id: entry.key,
			type: "item",
		});
		const frameId = requestAnimationFrame(() => {
			if (synchronizingActivePathRef.current === activePath) {
				synchronizingActivePathRef.current = null;
			}
		});
		return () => cancelAnimationFrame(frameId);
	}, [activePath, contentKey, viewerRef]);

	useEffect(
		() => () => {
			schedulerRef.current?.cancel();
		},
		[]
	);

	return useCallback(
		(
			scrollTop: number,
			viewer: CodeView<RepositoryCodeViewAnnotation>
		): void => {
			const entry = getRepositoryCodeViewActiveEntry(
				entriesRef.current,
				viewer,
				scrollTop
			);
			if (!entry) {
				return;
			}
			if (synchronizingActivePathRef.current) {
				if (entry.path === synchronizingActivePathRef.current) {
					synchronizingActivePathRef.current = null;
				}
				return;
			}
			schedulerRef.current?.schedule(entry.path);
		},
		[]
	);
};
