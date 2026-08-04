import type { RefObject } from "react";
import { useEffect } from "react";

interface UseRepositoryDiffScrollSyncOptions {
	readonly activePath: string | null;
	readonly containerRef: RefObject<HTMLElement | null>;
	readonly onActivePathChange: (path: string) => void;
}

const DIFF_FILE_SELECTOR = "[data-repository-diff-path]";
const DIFF_HEADER_OFFSET = 58;

const getActiveDiffPath = (container: HTMLElement): string | null => {
	const anchorTop = container.getBoundingClientRect().top + DIFF_HEADER_OFFSET;
	const files = container.querySelectorAll<HTMLElement>(DIFF_FILE_SELECTOR);
	let closestFile: HTMLElement | null = null;
	let closestDistance = Number.POSITIVE_INFINITY;

	for (const file of files) {
		const rect = file.getBoundingClientRect();
		if (rect.top <= anchorTop && rect.bottom > anchorTop) {
			return file.dataset.repositoryDiffPath ?? null;
		}
		const distance = Math.abs(rect.top - anchorTop);
		if (distance < closestDistance) {
			closestDistance = distance;
			closestFile = file;
		}
	}

	return closestFile?.dataset.repositoryDiffPath ?? null;
};

export const useRepositoryDiffScrollSync = ({
	activePath,
	containerRef,
	onActivePathChange,
}: UseRepositoryDiffScrollSyncOptions): void => {
	useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}
		let frameId: number | null = null;
		const updateActivePath = (): void => {
			frameId = null;
			const nextPath = getActiveDiffPath(container);
			if (nextPath && nextPath !== activePath) {
				onActivePathChange(nextPath);
			}
		};
		const scheduleUpdate = (): void => {
			if (frameId === null) {
				frameId = window.requestAnimationFrame(updateActivePath);
			}
		};
		const observer = new ResizeObserver(scheduleUpdate);
		observer.observe(container);
		container.addEventListener("scroll", scheduleUpdate, { passive: true });
		scheduleUpdate();

		return () => {
			if (frameId !== null) {
				window.cancelAnimationFrame(frameId);
			}
			observer.disconnect();
			container.removeEventListener("scroll", scheduleUpdate);
		};
	}, [activePath, containerRef, onActivePathChange]);
};
