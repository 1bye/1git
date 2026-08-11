import type { FileChange } from "@1git/git";
import { Input } from "@1git/ui/components/input";
import {
	ScrollArea,
	ScrollAreaContent,
	ScrollAreaViewport,
	ScrollBar,
} from "@1git/ui/components/scroll-area";
import { FunnelSimpleIcon } from "@phosphor-icons/react/dist/csr/FunnelSimple";
import type { ChangeEvent, ReactElement, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useCommandLensTarget } from "@/feature/command-lens/hooks/use-command-lens-target.js";
import type { PendingWorkspaceAction } from "@/feature/workspace/types/git-workspace.js";
import { RepositoryFileList } from "@/fixture/repository-workspace/components/repository-file-list.js";
import type { RepositoryFileNavigation } from "@/fixture/repository-workspace/hooks/use-repository-file-navigation.js";

const REPOSITORY_FILE_NAVIGATOR_ID = "repository-file-navigator";

interface RepositoryFileViewportProps {
	readonly children: ReactNode;
	readonly className: string;
}

function RepositoryFileViewport({
	children,
	className,
}: RepositoryFileViewportProps): ReactElement {
	return (
		<ScrollArea
			className={className}
			data-desktop-interactive
			data-name="RepositoryFileScrollArea"
			overflowEdgeThreshold={{ yEnd: 1, yStart: 1 }}
		>
			<div
				className="pointer-events-none absolute top-0 right-2 left-0 z-10 h-7"
				data-repository-file-sticky-layer
			/>
			<ScrollAreaViewport
				className="max-h-[inherit] min-h-0"
				data-repository-file-viewport
			>
				<ScrollAreaContent>{children}</ScrollAreaContent>
			</ScrollAreaViewport>
			<ScrollBar />
		</ScrollArea>
	);
}

interface RepositoryFileNavigatorProps {
	readonly navigation: RepositoryFileNavigation;
	readonly onDiscardFiles: (files: readonly FileChange[]) => Promise<boolean>;
	readonly onSetFileStaged: (
		file: FileChange,
		shouldStage: boolean
	) => Promise<boolean>;
	readonly onSetFilesStaged: (
		files: readonly FileChange[],
		shouldStage: boolean
	) => Promise<boolean>;
	readonly pendingAction: PendingWorkspaceAction;
	readonly repositoryRoot: string;
	readonly selectedFilePath: string | null;
}

export function RepositoryFileNavigator({
	navigation,
	onDiscardFiles,
	onSetFileStaged,
	onSetFilesStaged,
	pendingAction,
	repositoryRoot,
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
					className="fade-in-0 zoom-in-95 absolute top-full right-0 z-40 mt-2 flex max-h-[min(68vh,34rem)] w-[350px] origin-top-right animate-in flex-col overflow-hidden rounded-2xl border border-editor-hairline-strong bg-editor-surface shadow-surface-5 duration-150"
					data-desktop-interactive
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
						<RepositoryFileViewport className="max-h-[min(56vh,28rem)]">
							<RepositoryFileList
								files={navigation.files}
								isDiscardDisabled={pendingAction !== null}
								isStagingDisabled={pendingAction !== null}
								onClearSelection={navigation.clearFileSelection}
								onDiscard={onDiscardFiles}
								onSelect={navigation.selectFile}
								onSetFilesStaged={onSetFilesStaged}
								onSetStaged={onSetFileStaged}
								query={navigation.query}
								repositoryRoot={repositoryRoot}
								selectedFilePath={selectedFilePath}
								selectedFilePaths={navigation.selectedFilePaths}
								selectedFiles={navigation.selectedFiles}
							/>
						</RepositoryFileViewport>
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
}

export function RepositoryFileRail({
	allFiles,
	navigation,
	onDiscardFiles,
	onSetFileStaged,
	onSetFilesStaged,
	pendingAction,
	repositoryRoot,
	selectedFilePath,
}: RepositoryFileRailProps): ReactElement {
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

	return (
		<aside
			aria-label="Changed files"
			className="relative z-20 flex min-h-0 flex-1 flex-col bg-transparent"
			data-name="RepositoryFileRail"
			data-repository-file-liquid-rail="changes"
			data-state="open"
		>
			<div className="flex h-9 shrink-0 items-center px-2">
				<div className="relative min-w-0 flex-1">
					<FunnelSimpleIcon
						aria-hidden
						className="absolute top-1/2 left-2 size-3 -translate-y-1/2 text-editor-faint"
						weight="regular"
					/>
					<Input
						aria-label="Filter changed files"
						className="h-7 bg-white/35 pl-7 text-[11px] shadow-none focus-visible:bg-white/60"
						onChange={updateQuery}
						placeholder="Filter files"
						type="search"
						value={navigation.query}
					/>
				</div>
			</div>
			<RepositoryFileViewport className="min-h-0 flex-1">
				<RepositoryFileList
					allFiles={allFiles}
					files={navigation.files}
					isDiscardDisabled={pendingAction !== null}
					isStagingDisabled={pendingAction !== null}
					onClearSelection={navigation.clearFileSelection}
					onDiscard={onDiscardFiles}
					onSelect={navigation.selectFile}
					onSetFilesStaged={onSetFilesStaged}
					onSetStaged={onSetFileStaged}
					query={navigation.query}
					repositoryRoot={repositoryRoot}
					selectedFilePath={selectedFilePath}
					selectedFilePaths={navigation.selectedFilePaths}
					selectedFiles={navigation.selectedFiles}
					selectedRowAriaKeyShortcuts={commandLensTarget.ariaKeyShortcuts}
					selectedRowRef={commandLensTarget.ref}
				/>
			</RepositoryFileViewport>
		</aside>
	);
}
