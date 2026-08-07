import type { FileChange } from "@1git/git";
import { Button } from "@1git/ui/components/button";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@1git/ui/components/dropdown-menu";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { CodeIcon } from "@phosphor-icons/react/dist/csr/Code";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { ReactElement } from "react";
import { useCallback, useRef, useState } from "react";
import {
	hasFileWorkingTreeChanges,
	isFileStaged,
} from "@/feature/workspace/lib/workspace-model.js";
import {
	LiquidMenuContent,
	LiquidMenuRoot,
	LiquidMenuTrigger,
} from "@/fixture/liquid-menu/components/liquid-menu.js";
import { LiquidMenuAutoSize } from "@/fixture/liquid-menu/components/liquid-menu-auto-size.js";
import {
	REPOSITORY_FILE_BULK_ACTION_ANCHOR_GEOMETRY,
	REPOSITORY_FILE_BULK_ACTION_WIDTH_CLASS_NAME,
} from "@/fixture/repository-workspace/constants/repository-workspace.js";

const TRAILING_PATH_SEPARATOR = /[\\/]+$/;

interface RepositoryFileBulkActionsProps {
	readonly files: readonly FileChange[];
	readonly isPending: boolean;
	readonly onClear: () => void;
	readonly onDiscard: (files: readonly FileChange[]) => Promise<boolean>;
	readonly onSetStaged: (
		files: readonly FileChange[],
		shouldStage: boolean
	) => Promise<boolean>;
	readonly repositoryRoot: string;
}

const absoluteFilePath = (root: string, path: string): string =>
	`${root.replace(TRAILING_PATH_SEPARATOR, "")}/${path}`;

export function RepositoryFileBulkActions({
	files,
	isPending,
	onClear,
	onDiscard,
	onSetStaged,
	repositoryRoot,
}: RepositoryFileBulkActionsProps): ReactElement {
	const [actionError, setActionError] = useState<string | null>(null);
	const [isOpen, setIsOpen] = useState(false);
	const [view, setView] = useState<"actions" | "confirm-discard">("actions");
	const anchorRef = useRef<HTMLButtonElement | null>(null);
	const getAnchor = useCallback((): Element | null => anchorRef.current, []);
	const canStage = files.some(hasFileWorkingTreeChanges);
	const canUnstage = files.some(isFileStaged);
	const supportsZed = window.desktop.platform === "darwin";
	const changeOpen = useCallback((nextIsOpen: boolean): void => {
		setIsOpen(nextIsOpen);
		if (!nextIsOpen) {
			setActionError(null);
			setView("actions");
		}
	}, []);
	const run = async (
		action: () => Promise<boolean | undefined>,
		errorMessage: string,
		closeOnSuccess = true
	): Promise<void> => {
		setActionError(null);
		try {
			const succeeded = await action();
			if (succeeded === false) {
				setActionError(errorMessage);
				return;
			}
			if (closeOnSuccess) {
				changeOpen(false);
			}
		} catch {
			setActionError(errorMessage);
		}
	};
	const copyPaths = async (): Promise<undefined> => {
		const paths = files.map((file) =>
			absoluteFilePath(repositoryRoot, file.path)
		);
		await window.desktop.integrations.copyText(paths.join("\n"));
	};
	const openInZed = async (): Promise<undefined> => {
		await Promise.all(
			files.map((file) =>
				window.desktop.integrations.openInApplication(
					"zed",
					absoluteFilePath(repositoryRoot, file.path)
				)
			)
		);
	};
	const discardFiles = async (): Promise<void> => {
		await run(async () => {
			const succeeded = await onDiscard(files);
			if (succeeded) {
				onClear();
			}
			return succeeded;
		}, "The selected changes could not be discarded.");
	};

	return (
		<div
			className="absolute right-2 bottom-2 z-20"
			data-name="RepositoryFileBulkActions"
		>
			<LiquidMenuRoot
				anchor={getAnchor}
				anchorGeometry={REPOSITORY_FILE_BULK_ACTION_ANCHOR_GEOMETRY}
				disabled={isPending}
				onOpenChange={changeOpen}
				open={isOpen}
			>
				<LiquidMenuTrigger
					render={
						<button
							aria-label={`${files.length} selected files`}
							className="flex h-7 items-center gap-1.5 rounded-lg bg-editor-ink px-2.5 font-medium text-[10px] text-white outline-none transition-[transform,background-color] hover:bg-editor-ink/90 focus-visible:ring-2 focus-visible:ring-editor-muted/25 disabled:opacity-50"
							disabled={isPending}
							ref={anchorRef}
							type="button"
						>
							<span className="tabular-nums">{files.length} selected</span>
							<DotsThreeIcon aria-hidden className="size-3.5" weight="bold" />
						</button>
					}
				/>
				<LiquidMenuContent
					align="end"
					aria-label={`Actions for ${files.length} selected files`}
					className={`${REPOSITORY_FILE_BULK_ACTION_WIDTH_CLASS_NAME} p-1.5`}
					side="right"
					sideOffset={0}
				>
					{view === "confirm-discard" ? (
						<LiquidMenuAutoSize viewKey="confirm-discard">
							<DropdownMenuItem
								className="gap-2.5 py-2"
								closeOnClick={false}
								disabled={isPending}
								onClick={() => setView("actions")}
							>
								<ArrowLeftIcon aria-hidden weight="bold" />
								Discard selected changes
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<p className="px-2 py-2 text-[10px] text-editor-muted leading-4">
								Discard every staged and unstaged change in {files.length}{" "}
								files? You can undo for 10 seconds.
							</p>
							<div className="flex justify-end gap-1.5 p-1">
								<Button
									disabled={isPending}
									onClick={() => setView("actions")}
									size="sm"
									type="button"
									variant="ghost"
								>
									Cancel
								</Button>
								<Button
									disabled={isPending}
									onClick={discardFiles}
									size="sm"
									type="button"
									variant="destructive"
								>
									Discard
								</Button>
							</div>
						</LiquidMenuAutoSize>
					) : (
						<LiquidMenuAutoSize viewKey="actions">
							<DropdownMenuItem
								closeOnClick={false}
								disabled={!canStage || isPending}
								onClick={() =>
									run(
										async () => await onSetStaged(files, true),
										"The selected files could not be staged.",
										false
									)
								}
							>
								<CheckIcon aria-hidden weight="bold" />
								Stage selected
							</DropdownMenuItem>
							<DropdownMenuItem
								closeOnClick={false}
								disabled={!canUnstage || isPending}
								onClick={() =>
									run(
										async () => await onSetStaged(files, false),
										"The selected files could not be unstaged.",
										false
									)
								}
							>
								<MinusIcon aria-hidden weight="bold" />
								Unstage selected
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								closeOnClick={false}
								onClick={() =>
									run(copyPaths, "The selected paths could not be copied.")
								}
							>
								<CopyIcon aria-hidden weight="duotone" />
								Copy paths
							</DropdownMenuItem>
							{supportsZed ? (
								<DropdownMenuItem
									closeOnClick={false}
									onClick={() =>
										run(openInZed, "The selected files could not be opened.")
									}
								>
									<CodeIcon aria-hidden weight="duotone" />
									Open in Zed
								</DropdownMenuItem>
							) : null}
							<DropdownMenuSeparator />
							<DropdownMenuItem closeOnClick={false} onClick={onClear}>
								<XIcon aria-hidden weight="bold" />
								Clear selection
							</DropdownMenuItem>
							<DropdownMenuItem
								closeOnClick={false}
								disabled={
									isPending ||
									files.some((file) => file.recordType === "unmerged")
								}
								onClick={() => setView("confirm-discard")}
								variant="destructive"
							>
								<TrashIcon aria-hidden weight="duotone" />
								Discard changes…
							</DropdownMenuItem>
						</LiquidMenuAutoSize>
					)}
					{actionError ? (
						<p
							aria-live="polite"
							className="px-2 py-1 text-[10px] text-destructive leading-4"
							role="status"
						>
							{actionError}
						</p>
					) : null}
				</LiquidMenuContent>
			</LiquidMenuRoot>
		</div>
	);
}
