import type { RefObject } from "react";
import { useEffect, useRef } from "react";

interface UseRepositoryDiffScrollSyncOptions {
	readonly activePath: string | null;
	readonly containerRef: RefObject<HTMLElement | null>;
	readonly contentKey: string;
	readonly onActivePathChange: (path: string) => void;
}

const DIFF_FILE_SELECTOR = "[data-repository-diff-path]";
const DIFF_HEADER_OFFSET = 58;

export const useRepositoryDiffScrollSync = ({
	activePath,
	containerRef,
	contentKey,
	onActivePathChange,
}: UseRepositoryDiffScrollSyncOptions): void => {
	const activePathRef = useRef(activePath);
	const onActivePathChangeRef = useRef(onActivePathChange);
	activePathRef.current = activePath;
	onActivePathChangeRef.current = onActivePathChange;

	useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}

		const files = container.querySelectorAll<HTMLElement>(DIFF_FILE_SELECTOR);
		if (!(contentKey || files.length > 0)) {
			return;
		}
		let intersectionObserver: IntersectionObserver | null = null;
		const observeFiles = (containerHeight: number): void => {
			intersectionObserver?.disconnect();
			const bottomInset = Math.max(
				0,
				Math.round(containerHeight) - DIFF_HEADER_OFFSET - 1
			);
			intersectionObserver = new IntersectionObserver(
				(entries) => {
					const activeEntry = entries.find((entry) => entry.isIntersecting);
					if (!(activeEntry?.target instanceof HTMLElement)) {
						return;
					}
					const nextPath = activeEntry.target.dataset.repositoryDiffPath;
					if (nextPath && nextPath !== activePathRef.current) {
						activePathRef.current = nextPath;
						onActivePathChangeRef.current(nextPath);
					}
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

		observeFiles(container.clientHeight);
		const resizeObserver = new ResizeObserver((entries) => {
			const [containerEntry] = entries;
			if (containerEntry) {
				observeFiles(containerEntry.contentRect.height);
			}
		});
		resizeObserver.observe(container);

		return () => {
			intersectionObserver?.disconnect();
			resizeObserver.disconnect();
		};
	}, [containerRef, contentKey]);
};
