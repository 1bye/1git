import type { FileChange } from "@1git/git";
import { Button } from "@1git/ui/components/button";
import { Input } from "@1git/ui/components/input";
import { Kbd } from "@1git/ui/components/kbd";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { FileCodeIcon } from "@phosphor-icons/react/dist/csr/FileCode";
import { FunnelSimpleIcon } from "@phosphor-icons/react/dist/csr/FunnelSimple";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import type { ChangeEvent, ReactElement } from "react";
import { useEffect, useRef } from "react";
import type { PendingWorkspaceAction } from "@/feature/workspace/hooks/use-git-workspace.js";
import { areAllFilesStaged } from "@/feature/workspace/lib/workspace-model.js";
import { RepositoryFileList } from "@/fixture/repository-workspace/components/repository-file-list.js";
import { REPOSITORY_FILE_NAVIGATOR_ID } from "@/fixture/repository-workspace/constants/repository-workspace.js";
import type { RepositoryFileNavigation } from "@/fixture/repository-workspace/hooks/use-repository-file-navigation.js";

interface RepositoryFileNavigatorProps {
	readonly allFiles: readonly FileChange[];
	readonly navigation: RepositoryFileNavigation;
	readonly onSetFileStaged: (
		file: FileChange,
		shouldStage: boolean
	) => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
	readonly position: number | null;
	readonly selectedFilePath: string | null;
}

export function RepositoryFileNavigator({
	allFiles,
	navigation,
	onSetFileStaged,
	pendingAction,
	position,
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
	const pinNavigator = (): void => {
		navigation.setPinned(true);
		navigation.acceptPreview();
	};

	return (
		<div
			className="relative"
			data-name="RepositoryFileNavigator"
			ref={containerRef}
		>
			<button
				aria-controls={
					navigation.isOpen ? REPOSITORY_FILE_NAVIGATOR_ID : undefined
				}
				aria-expanded={navigation.isOpen}
				aria-haspopup="dialog"
				aria-keyshortcuts="Meta+P Control+P"
				className="flex h-8 items-center gap-2 rounded-lg bg-editor-sunken px-2.5 font-medium text-editor-muted text-xss outline-none transition-colors hover:bg-editor-sunken-2 hover:text-editor-ink focus-visible:ring-2 focus-visible:ring-editor-muted/20"
				onClick={() => navigation.changeOpen(!navigation.isOpen)}
				type="button"
			>
				<FileCodeIcon aria-hidden className="size-3.5" weight="duotone" />
				<span className="text-editor-ink">
					{allFiles.length} {allFiles.length === 1 ? "change" : "changes"}
				</span>
				{position ? (
					<span className="text-editor-faint tabular-nums">
						{position}/{allFiles.length}
					</span>
				) : null}
				<Kbd className="ml-1 h-5 min-w-0 gap-0.5 bg-white px-1.5 text-[9px] text-editor-faint shadow-surface-1">
					<span>⌘</span>
					<span>P</span>
				</Kbd>
			</button>

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
						<Button
							aria-label="Pin changed files"
							onClick={pinNavigator}
							size="icon-sm"
							title="Keep files visible"
							type="button"
							variant="ghost"
						>
							<SidebarSimpleIcon
								aria-hidden
								className="size-3.5"
								weight="duotone"
							/>
						</Button>
					</div>
					<div className="border-editor-hairline border-t px-1 pt-1">
						<p
							aria-live="polite"
							className="sr-only"
						>{`${selectedFilePath ?? "No file"} previewed`}</p>
						<div className="max-h-[min(56vh,28rem)] overflow-y-auto overscroll-contain">
							<RepositoryFileList
								files={navigation.files}
								isStagingDisabled={pendingAction !== null}
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

interface RepositoryFileRailProps
	extends Omit<RepositoryFileNavigatorProps, "position"> {
	readonly onToggleAllFiles: () => Promise<void>;
}

export function RepositoryFileRail({
	allFiles,
	navigation,
	onSetFileStaged,
	onToggleAllFiles,
	pendingAction,
	selectedFilePath,
}: RepositoryFileRailProps): ReactElement {
	const allStaged = areAllFilesStaged(allFiles);
	const updateQuery = (event: ChangeEvent<HTMLInputElement>): void => {
		navigation.setQuery(event.target.value);
	};
	const toggleAllFiles = async (): Promise<void> => {
		await onToggleAllFiles();
	};

	return (
		<aside
			aria-label="Changed files"
			className="flex w-[310px] shrink-0 flex-col border-editor-hairline border-r bg-editor-surface"
			data-name="RepositoryFileRail"
		>
			<div className="flex h-11 shrink-0 items-center gap-2 px-2.5">
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
						placeholder="Filter files"
						type="search"
						value={navigation.query}
					/>
				</div>
				<Button
					aria-label="Unpin changed files"
					onClick={() => navigation.setPinned(false)}
					size="icon-sm"
					title="Hide file rail"
					type="button"
					variant="ghost"
				>
					<SidebarSimpleIcon
						aria-hidden
						className="size-3.5 rotate-180"
						weight="duotone"
					/>
				</Button>
			</div>
			<div className="flex h-8 shrink-0 items-center border-editor-hairline border-y px-2">
				<button
					className="flex items-center gap-1.5 rounded-md px-1.5 py-1 font-medium text-[10px] text-editor-muted outline-none hover:bg-editor-sunken hover:text-editor-ink focus-visible:ring-2 focus-visible:ring-editor-muted/20 disabled:opacity-50"
					disabled={pendingAction !== null || allFiles.length === 0}
					onClick={toggleAllFiles}
					type="button"
				>
					<CheckIcon aria-hidden className="size-3" weight="bold" />
					{allStaged ? "Unstage all" : "Stage all"}
				</button>
				<span className="ml-auto text-[10px] text-editor-faint tabular-nums">
					{allFiles.length} files
				</span>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-1">
				<RepositoryFileList
					files={navigation.files}
					isStagingDisabled={pendingAction !== null}
					onSelect={navigation.selectFile}
					onSetStaged={onSetFileStaged}
					query={navigation.query}
					selectedFilePath={selectedFilePath}
				/>
			</div>
		</aside>
	);
}
