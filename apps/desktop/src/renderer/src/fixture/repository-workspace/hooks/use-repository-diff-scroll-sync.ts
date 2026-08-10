import type { RefObject } from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { scrollElementIntoViewport } from "@/fixture/repository-workspace/lib/scroll-element-into-viewport.js";

interface UseRepositoryDiffScrollSyncOptions {
	readonly activePath: string | null;
	readonly containerRef: RefObject<HTMLElement | null>;
	readonly contentKey: string;
	readonly onActivePathChange: (path: string) => void;
}

const DIFF_FILE_SELECTOR = "[data-repository-diff-path]";
const DIFF_HEADER_OFFSET = 58;
const SCROLL_END_EPSILON = 1;

interface RepositoryDiffScrollPosition {
	readonly clientHeight: number;
	readonly scrollHeight: number;
	readonly scrollTop: number;
}

export const getRepositoryDiffScrollEndPath = (
	position: RepositoryDiffScrollPosition,
	paths: readonly string[]
): string | null => {
	const hasScrollableOverflow =
		position.scrollHeight > position.clientHeight + SCROLL_END_EPSILON;
	const isAtScrollEnd =
		position.scrollTop + position.clientHeight >=
		position.scrollHeight - SCROLL_END_EPSILON;
	return hasScrollableOverflow && isAtScrollEnd ? (paths.at(-1) ?? null) : null;
};

export const scrollRepositoryDiffPathIntoView = (
	container: HTMLElement,
	path: string
): boolean => {
	const file = [
		...container.querySelectorAll<HTMLElement>(DIFF_FILE_SELECTOR),
	].find((candidate) => candidate.dataset.repositoryDiffPath === path);
	if (!file) {
		return false;
	}
	scrollElementIntoViewport(container, file, { block: "start" });
	return true;
};

export const useRepositoryDiffScrollSync = ({
	activePath,
	containerRef,
	contentKey,
	onActivePathChange,
}: UseRepositoryDiffScrollSyncOptions): void => {
	const activePathRef = useRef(activePath);
	const observedActivePathRef = useRef<string | null>(null);
	const onActivePathChangeRef = useRef(onActivePathChange);
	const synchronizingActivePathRef = useRef<string | null>(null);
	activePathRef.current = activePath;
	onActivePathChangeRef.current = onActivePathChange;

	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!(container && activePath && contentKey)) {
			synchronizingActivePathRef.current = null;
			return;
		}
		const wasObservedPath = observedActivePathRef.current === activePath;
		observedActivePathRef.current = null;
		if (wasObservedPath) {
			return;
		}
		synchronizingActivePathRef.current = activePath;
		if (!scrollRepositoryDiffPathIntoView(container, activePath)) {
			synchronizingActivePathRef.current = null;
			return;
		}
		const frameId = requestAnimationFrame(() => {
			if (synchronizingActivePathRef.current === activePath) {
				synchronizingActivePathRef.current = null;
			}
		});
		return () => {
			cancelAnimationFrame(frameId);
		};
	}, [activePath, containerRef, contentKey]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}

		const files = container.querySelectorAll<HTMLElement>(DIFF_FILE_SELECTOR);
		if (!(contentKey || files.length > 0)) {
			return;
		}
		const filePaths = [...files].flatMap((file) => {
			const path = file.dataset.repositoryDiffPath;
			return path ? [path] : [];
		});
		const changeActivePath = (path: string | null): void => {
			if (synchronizingActivePathRef.current) {
				if (path === synchronizingActivePathRef.current) {
					synchronizingActivePathRef.current = null;
				}
				return;
			}
			if (path && path !== activePathRef.current) {
				activePathRef.current = path;
				observedActivePathRef.current = path;
				onActivePathChangeRef.current(path);
			}
		};
		const getScrollEndPath = (): string | null =>
			getRepositoryDiffScrollEndPath(container, filePaths);
		const handleScroll = (): void => {
			changeActivePath(getScrollEndPath());
		};
		let intersectionObserver: IntersectionObserver | null = null;
		const observeFiles = (containerHeight: number): void => {
			intersectionObserver?.disconnect();
			const bottomInset = Math.max(
				0,
				Math.round(containerHeight) - DIFF_HEADER_OFFSET - 1
			);
			intersectionObserver = new IntersectionObserver(
				(entries) => {
					const scrollEndPath = getScrollEndPath();
					if (scrollEndPath) {
						changeActivePath(scrollEndPath);
						return;
					}
					const activeEntry = entries.find((entry) => entry.isIntersecting);
					if (!(activeEntry?.target instanceof HTMLElement)) {
						return;
					}
					changeActivePath(
						activeEntry.target.dataset.repositoryDiffPath ?? null
					);
				},
				{
					root: container,
					rootMargin: `-${DIFF_HEADER_OFFSET}px 0px -${bottomInset}px 0px`,
					threshold: 0,
				}
			);
			for (const file of files) {
				intersectionObserver.observe(file);
			}
		};

		container.addEventListener("scroll", handleScroll, { passive: true });
		observeFiles(container.clientHeight);
		const resizeObserver = new ResizeObserver((entries) => {
			const [containerEntry] = entries;
			if (containerEntry) {
				observeFiles(containerEntry.contentRect.height);
			}
		});
		resizeObserver.observe(container);

		return () => {
			container.removeEventListener("scroll", handleScroll);
			intersectionObserver?.disconnect();
			resizeObserver.disconnect();
		};
	}, [containerRef, contentKey]);
};
