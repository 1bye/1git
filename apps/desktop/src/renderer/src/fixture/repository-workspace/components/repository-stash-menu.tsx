import type { StashInfo } from "@1git/git";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@1git/ui/components/dropdown-menu";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { FileCodeIcon } from "@phosphor-icons/react/dist/csr/FileCode";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type { ReactElement } from "react";
import { useState } from "react";
import { formatRelativeTime } from "@/feature/workspace/lib/workspace-model.js";
import {
	LiquidMenuSub,
	LiquidMenuSubContent,
	LiquidMenuSubTrigger,
} from "@/fixture/liquid-menu/components/liquid-menu.js";
import { LiquidMenuAutoSize } from "@/fixture/liquid-menu/components/liquid-menu-auto-size.js";

interface RepositoryStashMenuProps {
	readonly isPending: boolean;
	readonly onApply: (stash: StashInfo) => Promise<boolean>;
	readonly onDrop: (stash: StashInfo) => Promise<boolean>;
	readonly onPop: (stash: StashInfo) => Promise<boolean>;
	readonly stashes: readonly StashInfo[];
}

interface RepositoryStashMenuItemProps {
	readonly isPending: boolean;
	readonly onApply: (stash: StashInfo) => Promise<boolean>;
	readonly onDrop: (stash: StashInfo) => Promise<boolean>;
	readonly onPop: (stash: StashInfo) => Promise<boolean>;
	readonly stash: StashInfo;
}

function RepositoryStashMenuItem({
	isPending,
	onApply,
	onDrop,
	onPop,
	stash,
}: RepositoryStashMenuItemProps): ReactElement {
	const [isConfirmingDrop, setIsConfirmingDrop] = useState(false);
	const apply = async (): Promise<void> => {
		await onApply(stash);
	};
	const pop = async (): Promise<void> => {
		await onPop(stash);
	};
	const drop = async (): Promise<void> => {
		await onDrop(stash);
	};

	return (
		<LiquidMenuSub>
			<LiquidMenuSubTrigger disabled={isPending}>
				<FileCodeIcon
					aria-hidden
					className="text-editor-faint"
					weight="duotone"
				/>
				<span className="min-w-0 flex-1 truncate">{stash.summary}</span>
				<span className="shrink-0 font-normal text-[9px] text-editor-faint">
					{formatRelativeTime(stash.createdAt)}
				</span>
			</LiquidMenuSubTrigger>
			<LiquidMenuSubContent
				aria-label={`Actions for ${stash.summary}`}
				className="w-64 min-w-64 p-1"
				side="right"
				sideOffset={4}
			>
				<LiquidMenuAutoSize
					viewKey={isConfirmingDrop ? "confirm-drop" : "actions"}
				>
					{isConfirmingDrop ? (
						<>
							<DropdownMenuItem
								closeOnClick={false}
								disabled={isPending}
								onClick={() => setIsConfirmingDrop(false)}
							>
								<ArrowLeftIcon aria-hidden weight="bold" />
								Keep stash
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<p className="px-2 py-2 font-normal text-editor-faint text-xss leading-4">
								Permanently remove “{stash.summary}”?
							</p>
							<DropdownMenuItem
								aria-label={`Drop stash ${stash.summary}`}
								className="text-destructive focus:text-destructive"
								closeOnClick
								disabled={isPending}
								onClick={drop}
							>
								<TrashIcon aria-hidden weight="duotone" />
								Drop stash
							</DropdownMenuItem>
						</>
					) : (
						<>
							<DropdownMenuItem
								closeOnClick
								disabled={isPending}
								onClick={apply}
							>
								<ArrowCounterClockwiseIcon aria-hidden weight="duotone" />
								Apply
							</DropdownMenuItem>
							<DropdownMenuItem
								closeOnClick
								disabled={isPending}
								onClick={pop}
								title="Pop removes the stash after a successful apply. Git keeps it if conflicts occur."
							>
								<FileCodeIcon aria-hidden weight="duotone" />
								Pop
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								className="text-destructive focus:text-destructive"
								closeOnClick={false}
								disabled={isPending}
								onClick={() => setIsConfirmingDrop(true)}
							>
								<TrashIcon aria-hidden weight="duotone" />
								Drop stash…
							</DropdownMenuItem>
						</>
					)}
				</LiquidMenuAutoSize>
			</LiquidMenuSubContent>
		</LiquidMenuSub>
	);
}

export function RepositoryStashMenu({
	isPending,
	onApply,
	onDrop,
	onPop,
	stashes,
}: RepositoryStashMenuProps): ReactElement | null {
	if (stashes.length === 0) {
		return null;
	}

	return (
		<LiquidMenuSub>
			<LiquidMenuSubTrigger disabled={isPending}>
				<FileCodeIcon
					aria-hidden
					className="text-editor-faint"
					weight="duotone"
				/>
				Stashes
				<span className="ml-auto text-editor-faint tabular-nums">
					{stashes.length}
				</span>
			</LiquidMenuSubTrigger>
			<LiquidMenuSubContent
				aria-label="Stash shelf"
				className="max-h-72 w-72 min-w-72 overflow-y-auto p-1"
				side="right"
				sideOffset={4}
			>
				{stashes.map((stash) => (
					<RepositoryStashMenuItem
						isPending={isPending}
						key={stash.oid}
						onApply={onApply}
						onDrop={onDrop}
						onPop={onPop}
						stash={stash}
					/>
				))}
			</LiquidMenuSubContent>
		</LiquidMenuSub>
	);
}
