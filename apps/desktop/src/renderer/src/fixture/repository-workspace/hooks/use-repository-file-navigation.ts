import type { FileChange } from "@1git/git";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RepositoryTab } from "@/feature/workspace/hooks/use-git-workspace.js";
import {
	filterRepositoryFiles,
	getRepositoryFileAtBoundedOffset,
	getRepositoryFileAtOffset,
	getRepositoryFileRowId,
	groupRepositoryFiles,
	type RepositoryFileSelectionMode,
	updateRepositoryFileSelection,
} from "@/fixture/repository-workspace/lib/repository-navigation.js";
import { scrollElementIntoViewport } from "@/fixture/repository-workspace/lib/scroll-element-into-viewport.js";

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
	readonly clearFileSelection: () => void;
	readonly files: readonly FileChange[];
	readonly isOpen: boolean;
	readonly openNavigator: () => void;
	readonly query: string;
	readonly selectedFilePaths: ReadonlySet<string>;
	readonly selectedFiles: readonly FileChange[];
	readonly selectFile: (
		file: FileChange,
		mode?: RepositoryFileSelectionMode
	) => void;
	readonly selectNextFile: () => void;
	readonly selectPreviousFile: () => void;
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

const isLiquidMenuTarget = (target: EventTarget | null): boolean =>
	target instanceof Element && target.closest("[data-liquid-surface]") !== null;

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

const revealRepositoryFileRow = (path: string): void => {
	window.requestAnimationFrame(() => {
		const row = document.getElementById(getRepositoryFileRowId(path));
		const viewport = row?.closest<HTMLElement>(
			"[data-repository-file-viewport]"
		);
		row
			?.closest<HTMLUListElement>('[data-name="RepositoryFileList"]')
			?.focus({ preventScroll: true });
		if (row && viewport) {
			scrollElementIntoViewport(viewport, row);
		}
	});
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
	const [selectedFilePaths, setSelectedFilePaths] = useState<
		ReadonlySet<string>
	>(() => new Set());
	const originalPathRef = useRef<string | null>(null);
	const keyboardRangeAnchorPathRef = useRef<string | null>(null);
	const previewPathRef = useRef<string | null>(selectedFilePath);
	const selectionAnchorPathRef = useRef<string | null>(selectedFilePath);
	const selectedFilePathsRef = useRef<ReadonlySet<string>>(new Set());
	const selectedPathRef = useRef<string | null>(selectedFilePath);
	const previousSessionIdRef = useRef(sessionId);
	const visibleFiles = useMemo(
		() => filterRepositoryFiles(files, query),
		[files, query]
	);
	const orderedVisibleFiles = useMemo(() => {
		const groups = groupRepositoryFiles(visibleFiles);
		return [...groups.staged, ...groups.unstaged];
	}, [visibleFiles]);
	const orderedVisiblePaths = useMemo(
		() => orderedVisibleFiles.map((file) => file.path),
		[orderedVisibleFiles]
	);
	const selectedFiles = useMemo(
		() => files.filter((file) => selectedFilePaths.has(file.path)),
		[files, selectedFilePaths]
	);
	const changeSelectedFilePaths = useCallback(
		(paths: readonly string[]): void => {
			const nextPaths = new Set(paths);
			selectedFilePathsRef.current = nextPaths;
			setSelectedFilePaths(nextPaths);
		},
		[]
	);
	const clearFileSelection = useCallback((): void => {
		keyboardRangeAnchorPathRef.current = null;
		changeSelectedFilePaths([]);
		selectionAnchorPathRef.current = selectedPathRef.current;
	}, [changeSelectedFilePaths]);

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
		changeSelectedFilePaths([]);
		keyboardRangeAnchorPathRef.current = null;
		originalPathRef.current = null;
		previewPathRef.current = null;
		selectionAnchorPathRef.current = null;
	}, [changeSelectedFilePaths, sessionId]);

	useEffect(() => {
		const availablePaths = new Set(files.map((file) => file.path));
		const retainedPaths = [...selectedFilePathsRef.current].filter((path) =>
			availablePaths.has(path)
		);
		if (retainedPaths.length !== selectedFilePathsRef.current.size) {
			changeSelectedFilePaths(retainedPaths.length > 1 ? retainedPaths : []);
		}
		if (
			selectionAnchorPathRef.current &&
			!availablePaths.has(selectionAnchorPathRef.current)
		) {
			selectionAnchorPathRef.current = selectedFilePath;
		}
		if (
			keyboardRangeAnchorPathRef.current &&
			!availablePaths.has(keyboardRangeAnchorPathRef.current)
		) {
			keyboardRangeAnchorPathRef.current = null;
		}
	}, [changeSelectedFilePaths, files, selectedFilePath]);

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
	const applyFileSelection = useCallback(
		(
			file: FileChange,
			mode: RepositoryFileSelectionMode,
			anchorPath: string | null
		): void => {
			const selection = updateRepositoryFileSelection({
				activePath: selectedPathRef.current,
				anchorPath,
				mode,
				orderedPaths: orderedVisiblePaths,
				selectedPaths: selectedFilePathsRef.current,
				targetPath: file.path,
			});
			selectionAnchorPathRef.current = selection.anchorPath;
			changeSelectedFilePaths(selection.selectedPaths);
			const activeFile =
				files.find((candidate) => candidate.path === selection.activePath) ??
				file;
			performSelection(activeFile);
			acceptPreview();
		},
		[
			acceptPreview,
			changeSelectedFilePaths,
			files,
			orderedVisiblePaths,
			performSelection,
		]
	);
	const selectFile = useCallback(
		(file: FileChange, mode: RepositoryFileSelectionMode = "replace"): void => {
			keyboardRangeAnchorPathRef.current = null;
			applyFileSelection(file, mode, selectionAnchorPathRef.current);
		},
		[applyFileSelection]
	);
	const selectAtOffset = useCallback(
		(
			offset: number,
			candidates: readonly FileChange[],
			shouldFocus = false
		): void => {
			const file = getRepositoryFileAtOffset(
				candidates,
				previewPathRef.current,
				offset
			);
			if (file) {
				performSelection(file);
				if (shouldFocus) {
					revealRepositoryFileRow(file.path);
				}
			}
		},
		[performSelection]
	);
	const selectNextFile = useCallback((): void => {
		keyboardRangeAnchorPathRef.current = null;
		selectAtOffset(1, orderedVisibleFiles, true);
	}, [orderedVisibleFiles, selectAtOffset]);
	const selectPreviousFile = useCallback((): void => {
		keyboardRangeAnchorPathRef.current = null;
		selectAtOffset(-1, orderedVisibleFiles, true);
	}, [orderedVisibleFiles, selectAtOffset]);
	const selectRangeAtOffset = useCallback(
		(offset: number): void => {
			const file = getRepositoryFileAtBoundedOffset(
				orderedVisibleFiles,
				previewPathRef.current,
				offset
			);
			if (!file) {
				return;
			}
			const anchorPath =
				keyboardRangeAnchorPathRef.current ??
				previewPathRef.current ??
				file.path;
			keyboardRangeAnchorPathRef.current = anchorPath;
			applyFileSelection(file, "range", anchorPath);
			revealRepositoryFileRow(file.path);
		},
		[applyFileSelection, orderedVisibleFiles]
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
				selectAtOffset(offset, orderedVisibleFiles);
			}
		},
		[acceptPreview, cancelPreview, orderedVisibleFiles, selectAtOffset]
	);
	const handleDirectNavigationKey = useCallback(
		(event: KeyboardEvent): void => {
			if (isLiquidMenuTarget(event.target)) {
				return;
			}
			if (
				event.key === "Escape" &&
				selectedFilePathsRef.current.size > 0 &&
				!isEditableTarget(event.target)
			) {
				event.preventDefault();
				clearFileSelection();
				return;
			}
			const offset = arrowOffset(event.key);
			if (
				offset === null ||
				event.altKey ||
				event.ctrlKey ||
				event.metaKey ||
				tab !== "changes" ||
				isEditableTarget(event.target)
			) {
				return;
			}
			event.preventDefault();
			if (event.shiftKey) {
				selectRangeAtOffset(offset);
				return;
			}
			keyboardRangeAnchorPathRef.current = null;
			selectAtOffset(offset, orderedVisibleFiles, true);
		},
		[
			clearFileSelection,
			orderedVisibleFiles,
			selectAtOffset,
			selectRangeAtOffset,
			tab,
		]
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
		const handleKeyUp = (event: KeyboardEvent): void => {
			if (event.key === "Shift") {
				keyboardRangeAnchorPathRef.current = null;
			}
		};
		window.addEventListener("keydown", handleKeyDown, true);
		window.addEventListener("keyup", handleKeyUp, true);
		return () => {
			window.removeEventListener("keydown", handleKeyDown, true);
			window.removeEventListener("keyup", handleKeyUp, true);
		};
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
		clearFileSelection,
		files: orderedVisibleFiles,
		isOpen,
		openNavigator,
		query,
		selectedFilePaths,
		selectedFiles,
		selectFile,
		selectNextFile,
		selectPreviousFile,
		setQuery,
	};
};
