import type { FileChange } from "@1git/git";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RepositoryTab } from "@/feature/workspace/hooks/use-git-workspace.js";
import {
	filterRepositoryFiles,
	getRepositoryFileAtOffset,
} from "@/fixture/repository-workspace/lib/repository-navigation.js";

interface UseRepositoryFileNavigationOptions {
	readonly files: readonly FileChange[];
	readonly onRequestChanges: () => Promise<void>;
	readonly onSelectFile: (file: FileChange) => Promise<void>;
	readonly selectedFilePath: string | null;
	readonly sessionId: string;
	readonly tab: RepositoryTab;
}

export interface RepositoryFileNavigation {
	readonly acceptPreview: () => void;
	readonly cancelPreview: () => void;
	readonly changeOpen: (isOpen: boolean) => void;
	readonly files: readonly FileChange[];
	readonly isOpen: boolean;
	readonly openNavigator: () => void;
	readonly query: string;
	readonly selectFile: (file: FileChange) => void;
	readonly setQuery: (query: string) => void;
}

const isEditableTarget = (target: EventTarget | null): boolean => {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	return (
		target.isContentEditable ||
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	);
};

const isNavigatorShortcut = (event: KeyboardEvent): boolean =>
	(event.metaKey || event.ctrlKey) &&
	!event.altKey &&
	event.key.toLocaleLowerCase() === "p";

const arrowOffset = (key: string): number | null => {
	if (key === "ArrowDown") {
		return 1;
	}
	if (key === "ArrowUp") {
		return -1;
	}
	return null;
};

export const useRepositoryFileNavigation = ({
	files,
	onRequestChanges,
	onSelectFile,
	selectedFilePath,
	sessionId,
	tab,
}: UseRepositoryFileNavigationOptions): RepositoryFileNavigation => {
	const [isOpen, setIsOpen] = useState(false);
	const [query, setQuery] = useState("");
	const originalPathRef = useRef<string | null>(null);
	const previewPathRef = useRef<string | null>(selectedFilePath);
	const selectedPathRef = useRef<string | null>(selectedFilePath);
	const previousSessionIdRef = useRef(sessionId);
	const visibleFiles = useMemo(
		() => filterRepositoryFiles(files, query),
		[files, query]
	);

	useEffect(() => {
		selectedPathRef.current = selectedFilePath;
		previewPathRef.current = selectedFilePath;
	}, [selectedFilePath]);

	useEffect(() => {
		if (previousSessionIdRef.current === sessionId) {
			return;
		}
		previousSessionIdRef.current = sessionId;
		setIsOpen(false);
		setQuery("");
		originalPathRef.current = null;
		previewPathRef.current = null;
	}, [sessionId]);

	const performSelection = useCallback(
		(file: FileChange): void => {
			previewPathRef.current = file.path;
			onSelectFile(file).catch(() => {
				// The workspace hook exposes the operation error in the app notice.
			});
		},
		[onSelectFile]
	);
	const openNavigator = useCallback((): void => {
		const fallbackPath = files[0]?.path ?? null;
		const originalPath = files.some(
			(file) => file.path === selectedPathRef.current
		)
			? selectedPathRef.current
			: fallbackPath;
		originalPathRef.current = originalPath;
		previewPathRef.current = originalPath;
		setIsOpen(true);
	}, [files]);
	const acceptPreview = useCallback((): void => {
		originalPathRef.current = null;
		setIsOpen(false);
	}, []);
	const cancelPreview = useCallback((): void => {
		const originalFile = files.find(
			(file) => file.path === originalPathRef.current
		);
		originalPathRef.current = null;
		setIsOpen(false);
		if (originalFile && originalFile.path !== selectedPathRef.current) {
			performSelection(originalFile);
		}
	}, [files, performSelection]);
	const changeOpen = useCallback(
		(nextIsOpen: boolean): void => {
			if (nextIsOpen) {
				openNavigator();
				return;
			}
			acceptPreview();
		},
		[acceptPreview, openNavigator]
	);
	const selectFile = useCallback(
		(file: FileChange): void => {
			performSelection(file);
			acceptPreview();
		},
		[acceptPreview, performSelection]
	);
	const selectAtOffset = useCallback(
		(offset: number, candidates: readonly FileChange[]): void => {
			const file = getRepositoryFileAtOffset(
				candidates,
				previewPathRef.current,
				offset
			);
			if (file) {
				performSelection(file);
			}
		},
		[performSelection]
	);
	const requestChangesAndOpen = useCallback(async (): Promise<void> => {
		await onRequestChanges();
		openNavigator();
	}, [onRequestChanges, openNavigator]);
	const handleNavigatorShortcut = useCallback(
		(event: KeyboardEvent): boolean => {
			if (!isNavigatorShortcut(event)) {
				return false;
			}
			event.preventDefault();
			if (files.length === 0) {
				return true;
			}
			if (tab === "history") {
				requestChangesAndOpen().catch(() => {
					// The workspace hook exposes the operation error in the app notice.
				});
			} else {
				openNavigator();
			}
			return true;
		},
		[files.length, openNavigator, requestChangesAndOpen, tab]
	);
	const handlePreviewKey = useCallback(
		(event: KeyboardEvent): void => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				cancelPreview();
				return;
			}
			if (event.key === "Enter") {
				event.preventDefault();
				acceptPreview();
				return;
			}
			const offset = arrowOffset(event.key);
			if (offset !== null) {
				event.preventDefault();
				selectAtOffset(offset, visibleFiles);
			}
		},
		[acceptPreview, cancelPreview, selectAtOffset, visibleFiles]
	);
	const handleDirectNavigationKey = useCallback(
		(event: KeyboardEvent): void => {
			const offset = arrowOffset(event.key);
			const hasDirectNavigationModifiers =
				event.altKey && !event.metaKey && !event.ctrlKey;
			if (
				offset === null ||
				!hasDirectNavigationModifiers ||
				tab !== "changes" ||
				isEditableTarget(event.target)
			) {
				return;
			}
			event.preventDefault();
			selectAtOffset(offset, files);
		},
		[files, selectAtOffset, tab]
	);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent): void => {
			if (handleNavigatorShortcut(event)) {
				return;
			}
			if (isOpen) {
				handlePreviewKey(event);
				return;
			}
			handleDirectNavigationKey(event);
		};
		window.addEventListener("keydown", handleKeyDown, true);
		return () => window.removeEventListener("keydown", handleKeyDown, true);
	}, [
		handleDirectNavigationKey,
		handleNavigatorShortcut,
		handlePreviewKey,
		isOpen,
	]);

	return {
		acceptPreview,
		cancelPreview,
		changeOpen,
		files: visibleFiles,
		isOpen,
		openNavigator,
		query,
		selectFile,
		setQuery,
	};
};
