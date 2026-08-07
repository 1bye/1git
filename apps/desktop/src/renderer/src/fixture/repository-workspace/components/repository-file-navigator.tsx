import type { FileChange } from "@1git/git";
import { Input } from "@1git/ui/components/input";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { FunnelSimpleIcon } from "@phosphor-icons/react/dist/csr/FunnelSimple";
import type { ChangeEvent, ReactElement } from "react";
import { useEffect, useRef } from "react";
import type { PendingWorkspaceAction } from "@/feature/workspace/hooks/use-git-workspace.js";
import { areAllFilesStaged } from "@/feature/workspace/lib/workspace-model.js";
import { useCommandLensTarget } from "@/fixture/command-lens/hooks/use-command-lens-target.js";
import { RepositoryFileList } from "@/fixture/repository-workspace/components/repository-file-list.js";
import { REPOSITORY_FILE_NAVIGATOR_ID } from "@/fixture/repository-workspace/constants/repository-workspace.js";
import type { RepositoryFileNavigation } from "@/fixture/repository-workspace/hooks/use-repository-file-navigation.js";

interface RepositoryFileNavigatorProps {
	readonly navigation: RepositoryFileNavigation;
	readonly onDiscardFile: (file: FileChange) => Promise<boolean>;
	readonly onSetFileStaged: (
		file: FileChange,
		shouldStage: boolean
	) => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
	readonly selectedFilePath: string | null;
}

export function RepositoryFileNavigator({
	navigation,
	onDiscardFile,
	onSetFileStaged,
	pendingAction,
	selectedFilePath,
}: RepositoryFileNavigatorProps): ReactElement {
	const containerRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!navigation.isOpen) {
			return;
		}
		const focusFrame = window.requestAnimationFrame(() => {
			inputRef.current?.focus();
		});
		const closeOnOutsidePointer = (event: PointerEvent): void => {
			const { target } = event;
			if (target instanceof Node && !containerRef.current?.contains(target)) {
				navigation.acceptPreview();
			}
		};
		window.addEventListener("pointerdown", closeOnOutsidePointer, true);
		return () => {
			window.cancelAnimationFrame(focusFrame);
			window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
		};
	}, [navigation.acceptPreview, navigation.isOpen]);

	const updateQuery = (event: ChangeEvent<HTMLInputElement>): void => {
		navigation.setQuery(event.target.value);
	};
	return (
		<div
			aria-keyshortcuts="Meta+P Control+P"
			className="relative self-stretch"
			data-name="RepositoryFileNavigator"
			ref={containerRef}
		>
			{navigation.isOpen ? (
				<div
					aria-label="Changed file navigator"
					className="fade-in-0 zoom-in-95 absolute top-full left-0 z-40 mt-2 flex max-h-[min(68vh,34rem)] w-[350px] origin-top-left animate-in flex-col overflow-hidden rounded-2xl border border-editor-hairline-strong bg-editor-surface shadow-surface-5 duration-150"
					data-name="RepositoryFileNavigatorPopup"
					id={REPOSITORY_FILE_NAVIGATOR_ID}
					role="dialog"
				>
					<div className="flex items-center gap-2 p-2">
						<div className="relative min-w-0 flex-1">
							<FunnelSimpleIcon
								aria-hidden
								className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-editor-faint"
								weight="duotone"
							/>
							<Input
								aria-label="Filter changed files"
								className="h-8 bg-editor-sunken pl-8 text-xss shadow-none"
								onChange={updateQuery}
								placeholder="Jump to a changed file"
								ref={inputRef}
								type="search"
								value={navigation.query}
							/>
						</div>
					</div>
					<div className="border-editor-hairline border-t px-1 pt-1">
						<p
							aria-live="polite"
							className="sr-only"
						>{`${selectedFilePath ?? "No file"} previewed`}</p>
						<div className="max-h-[min(56vh,28rem)] overflow-y-auto overscroll-contain">
							<RepositoryFileList
								files={navigation.files}
								isDiscardDisabled={pendingAction !== null}
								isStagingDisabled={pendingAction !== null}
								onDiscard={onDiscardFile}
								onSelect={navigation.selectFile}
								onSetStaged={onSetFileStaged}
								query={navigation.query}
								selectedFilePath={selectedFilePath}
							/>
						</div>
					</div>
					<footer className="flex h-8 shrink-0 items-center gap-3 border-editor-hairline border-t px-3 text-[9px] text-editor-faint">
						<span>↑↓ Preview</span>
						<span>↵ Keep</span>
						<span>esc Restore</span>
					</footer>
				</div>
			) : null}
		</div>
	);
}

interface RepositoryFileRailProps extends RepositoryFileNavigatorProps {
	readonly allFiles: readonly FileChange[];
	readonly onToggleAllFiles: () => Promise<void>;
}

export function RepositoryFileRail({
	allFiles,
	navigation,
	onDiscardFile,
	onSetFileStaged,
	onToggleAllFiles,
	pendingAction,
	selectedFilePath,
}: RepositoryFileRailProps): ReactElement {
	const allStaged = areAllFilesStaged(allFiles);
	const commandLensTarget = useCommandLensTarget({
		commands: [
			{
				key: "ArrowUp",
				label: "Previous changed file",
				onInvoke: navigation.selectPreviousFile,
			},
			{
				key: "ArrowDown",
				label: "Next changed file",
				onInvoke: navigation.selectNextFile,
			},
		],
		disabled: allFiles.length === 0 || selectedFilePath === null,
		highlightOutset: 0,
		hintLayout: "floating",
		id: "repository-file-navigation",
		placement: "right",
		radius: 6,
	});
	const updateQuery = (event: ChangeEvent<HTMLInputElement>): void => {
		navigation.setQuery(event.target.value);
	};
	const toggleAllFiles = async (): Promise<void> => {
		await onToggleAllFiles();
	};

	return (
		<aside
			aria-label="Changed files"
			className="flex min-h-0 flex-1 flex-col bg-editor-surface"
			data-name="RepositoryFileRail"
		>
			<div className="flex h-9 shrink-0 items-center px-2">
				<div className="relative min-w-0 flex-1">
					<FunnelSimpleIcon
						aria-hidden
						className="absolute top-1/2 left-2 size-3 -translate-y-1/2 text-editor-faint"
						weight="duotone"
					/>
					<Input
						aria-label="Filter changed files"
						className="h-7 bg-editor-sunken pl-7 text-[11px] shadow-none"
						onChange={updateQuery}
						placeholder="Filter files"
						type="search"
						value={navigation.query}
					/>
				</div>
			</div>
			<div className="flex h-7 shrink-0 items-center px-2">
				<button
					className="flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-[9px] text-editor-muted outline-none hover:bg-editor-sunken hover:text-editor-ink focus-visible:ring-2 focus-visible:ring-editor-muted/20 disabled:opacity-50"
					disabled={pendingAction !== null || allFiles.length === 0}
					onClick={toggleAllFiles}
					type="button"
				>
					<CheckIcon aria-hidden className="size-2.5" weight="bold" />
					{allStaged ? "Unstage all" : "Stage all"}
				</button>
				<span className="ml-auto text-[9px] text-editor-faint tabular-nums">
					{allFiles.length}
				</span>
			</div>
			<div
				className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
				data-repository-file-viewport
			>
				<RepositoryFileList
					files={navigation.files}
					isDiscardDisabled={pendingAction !== null}
					isStagingDisabled={pendingAction !== null}
					onDiscard={onDiscardFile}
					onSelect={navigation.selectFile}
					onSetStaged={onSetFileStaged}
					query={navigation.query}
					selectedFilePath={selectedFilePath}
					selectedRowAriaKeyShortcuts={commandLensTarget.ariaKeyShortcuts}
					selectedRowRef={commandLensTarget.ref}
				/>
			</div>
		</aside>
	);
}
