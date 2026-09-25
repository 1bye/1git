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
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { ReactElement } from "react";
import { useState } from "react";

import {
	hasFileWorkingTreeChanges,
	isFileStaged,
} from "@/feature/workspace/lib/workspace-model.js";
import { LiquidMenuAutoSize } from "@/fixture/liquid-menu/components/liquid-menu-auto-size.js";

const TRAILING_PATH_SEPARATOR = /[\\/]+$/;

interface RepositoryFileContextActionsProps {
	readonly files: readonly FileChange[];
	readonly isPending: boolean;
	readonly onClearSelection: () => void;
	readonly onDiscard: (files: readonly FileChange[]) => Promise<boolean>;
	readonly onDismiss: () => void;
	readonly onSetStaged: (
		files: readonly FileChange[],
		shouldStage: boolean
	) => Promise<boolean>;
	readonly repositoryRoot: string;
}

const absoluteFilePath = (root: string, path: string): string =>
	`${root.replace(TRAILING_PATH_SEPARATOR, "")}/${path}`;

interface RepositoryFileDiscardConfirmationProps {
	readonly actionError: string | null;
	readonly discardTargets: readonly string[];
	readonly isPending: boolean;
	readonly onBack: () => void;
	readonly onDiscard: () => Promise<void>;
	readonly onDismiss: () => void;
}

function RepositoryFileDiscardConfirmation({
	actionError,
	discardTargets,
	isPending,
	onBack,
	onDiscard,
	onDismiss,
}: RepositoryFileDiscardConfirmationProps): ReactElement {
	const targetLabel =
		discardTargets.length === 1
			? (discardTargets[0] ?? "selected file")
			: `${discardTargets.length} selected files`;
	return (
		<>
			<DropdownMenuItem
				className="gap-2.5 py-2"
				closeOnClick={false}
				disabled={isPending}
				onClick={onBack}
			>
				<ArrowLeftIcon aria-hidden weight="bold" />
				Discard changes
			</DropdownMenuItem>
			<DropdownMenuSeparator />
			<div className="space-y-3 p-2">
				<div className="text-[10px] text-editor-muted leading-4">
					<p>Discard every staged and unstaged change in:</p>
					<ul className="mt-1 max-h-20 overflow-y-auto rounded-md bg-editor-sunken px-2 py-1 font-medium text-editor-ink">
						{discardTargets.map((target) => (
							<li className="truncate" key={target} title={target}>
								{target}
							</li>
						))}
					</ul>
					<p className="mt-1">You can undo for 10 seconds.</p>
				</div>
				{actionError ? (
					<p
						aria-live="polite"
						className="text-[10px] text-destructive leading-4"
						role="status"
					>
						{actionError}
					</p>
				) : null}
				<div className="flex justify-end gap-1.5">
					<Button
						disabled={isPending}
						onClick={onDismiss}
						size="sm"
						type="button"
						variant="ghost"
					>
						Cancel
					</Button>
					<Button
						aria-label={`Discard changes in ${targetLabel}`}
						disabled={isPending}
						onClick={onDiscard}
						size="sm"
						type="button"
						variant="destructive"
					>
						{isPending ? (
							<SpinnerGapIcon
								aria-hidden
								className="animate-spin"
								weight="bold"
							/>
						) : null}
						Discard
					</Button>
				</div>
			</div>
		</>
	);
}

export function RepositoryFileContextActions({
	files,
	isPending,
	onClearSelection,
	onDiscard,
	onDismiss,
	onSetStaged,
	repositoryRoot,
}: RepositoryFileContextActionsProps): ReactElement {
	const [actionError, setActionError] = useState<string | null>(null);
	const [view, setView] = useState<"actions" | "confirm-discard">("actions");
	const isMultiple = files.length > 1;
	const canStage = files.some(hasFileWorkingTreeChanges);
	const canUnstage = files.some(isFileStaged);
	const hasConflict = files.some((file) => file.recordType === "unmerged");
	const supportsZed = window.desktop.platform === "darwin";
	const run = async (
		action: () => Promise<boolean | undefined>,
		errorMessage: string
	): Promise<void> => {
		setActionError(null);
		try {
			const succeeded = await action();
			if (succeeded === false) {
				setActionError(errorMessage);
				return;
			}
			onDismiss();
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
				onClearSelection();
			}
			return succeeded;
		}, "The selected changes could not be discarded.");
	};
	const discardTargets = files.map((file) => file.path);

	return (
		<LiquidMenuAutoSize viewKey={view}>
			{view === "confirm-discard" ? (
				<RepositoryFileDiscardConfirmation
					actionError={actionError}
					discardTargets={discardTargets}
					isPending={isPending}
					onBack={() => setView("actions")}
					onDiscard={discardFiles}
					onDismiss={onDismiss}
				/>
			) : (
				<>
					<DropdownMenuItem
						closeOnClick={false}
						disabled={!canStage || isPending}
						onClick={() =>
							run(
								async () => await onSetStaged(files, true),
								"The selected files could not be staged."
							)
						}
					>
						<CheckIcon aria-hidden weight="bold" />
						{isMultiple ? "Stage selected" : "Stage file"}
					</DropdownMenuItem>
					<DropdownMenuItem
						closeOnClick={false}
						disabled={!canUnstage || isPending}
						onClick={() =>
							run(
								async () => await onSetStaged(files, false),
								"The selected files could not be unstaged."
							)
						}
					>
						<MinusIcon aria-hidden weight="bold" />
						{isMultiple ? "Unstage selected" : "Unstage file"}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						closeOnClick={false}
						onClick={() =>
							run(copyPaths, "The selected paths could not be copied.")
						}
					>
						<CopyIcon aria-hidden weight="duotone" />
						{isMultiple ? "Copy paths" : "Copy path"}
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
					{isMultiple ? (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								closeOnClick={false}
								onClick={() => {
									onClearSelection();
									onDismiss();
								}}
							>
								<XIcon aria-hidden weight="bold" />
								Clear selection
							</DropdownMenuItem>
						</>
					) : null}
					<DropdownMenuItem
						closeOnClick={false}
						disabled={isPending || hasConflict}
						onClick={() => setView("confirm-discard")}
						title={
							hasConflict
								? "Resolve conflicts before discarding changes."
								: undefined
						}
						variant="destructive"
					>
						<TrashIcon aria-hidden weight="duotone" />
						Discard changes…
					</DropdownMenuItem>
					{actionError ? (
						<p
							aria-live="polite"
							className="px-2 py-1 text-[10px] text-destructive leading-4"
							role="status"
						>
							{actionError}
						</p>
					) : null}
				</>
			)}
		</LiquidMenuAutoSize>
	);
}
