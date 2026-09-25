import { ComboboxItem } from "@1git/ui/components/combobox";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@1git/ui/components/tooltip";
import { cn } from "@1git/ui/lib/utils";
import type {
	ReactElement,
	KeyboardEvent as ReactKeyboardEvent,
	MouseEvent as ReactMouseEvent,
	RefCallback,
} from "react";
import { useCallback, useId } from "react";

import type { CommandLensTargetOptions } from "@/feature/command-lens/hooks/use-command-lens-context.js";
import { useCommandLensTarget } from "@/feature/command-lens/hooks/use-command-lens-target.js";
import { getRepositoryOwner } from "@/feature/workspace/lib/repository-owner.js";
import {
	formatCommitDate,
	formatRelativeTime,
	recentRepositoryName,
} from "@/feature/workspace/lib/workspace-model.js";
import type { WorkspaceTabState } from "@/feature/workspace/types/git-workspace.js";
import { LiquidContextMenuTrigger } from "@/fixture/liquid-menu/components/liquid-menu.js";
import { RepositoryOwnerThumbnail } from "@/fixture/repository-item/components/repository-owner-thumbnail.js";

import type {
	RecentRepositoryPreview,
	RecentRepositoryRecord,
} from "../../../../../shared/repository-session.js";

type RepositoryItemVariant = "menu" | "welcome";

interface RepositoryItemProps {
	readonly asContextMenuTrigger?: boolean;
	readonly commandLens?: Omit<CommandLensTargetOptions, "disabled">;
	readonly contextOpen: boolean;
	readonly disabled: boolean;
	readonly onClick: (event: ReactMouseEvent<HTMLElement>) => void;
	readonly onContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void;
	readonly onElementChange?: RefCallback<HTMLElement>;
	readonly onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
	readonly pickerValue?: unknown;
	readonly preview: RecentRepositoryPreview | null;
	readonly repository: RecentRepositoryRecord;
	readonly variant: RepositoryItemVariant;
	readonly workspace: WorkspaceTabState | null;
}

interface RepositoryItemCommandLensOptions {
	readonly commandLens: RepositoryItemProps["commandLens"];
	readonly disabled: boolean;
	readonly onElementChange: RepositoryItemProps["onElementChange"];
	readonly repositoryPath: string;
}

function RepositoryTooltipDetails({
	preview,
}: {
	readonly preview: RecentRepositoryPreview | null;
}): ReactElement {
	if (!preview) {
		return (
			<span className="mt-1.5 block text-[10px] opacity-65">
				Loading repository details…
			</span>
		);
	}

	if (!preview.latestCommit) {
		return (
			<span className="mt-1.5 block text-[10px] opacity-65">
				No commits yet
			</span>
		);
	}

	return (
		<>
			<span className="mt-1.5 line-clamp-2 block font-medium">
				{preview.latestCommit.summary}
			</span>
			<span className="mt-1 block text-[10px] opacity-65">
				Latest commit {formatCommitDate(preview.latestCommit.committedAt)} by{" "}
				{preview.latestCommit.author.name}
			</span>
		</>
	);
}

const useRepositoryItemCommandLens = ({
	commandLens,
	disabled,
	onElementChange,
	repositoryPath,
}: RepositoryItemCommandLensOptions): {
	readonly ariaKeyShortcuts: string | undefined;
	readonly setElement: RefCallback<HTMLElement>;
} => {
	const target = useCommandLensTarget({
		commands: commandLens?.commands ?? [],
		disabled: disabled || !commandLens,
		highlightInsetBlock: commandLens?.highlightInsetBlock,
		highlightInsetInline: commandLens?.highlightInsetInline,
		highlightOutset: commandLens?.highlightOutset,
		hintLayout: commandLens?.hintLayout,
		id: commandLens?.id ?? `repository-item:${repositoryPath}`,
		navigationDefault: commandLens?.navigationDefault,
		navigationGroup: commandLens?.navigationGroup,
		navigationOrder: commandLens?.navigationOrder,
		navigationOrientation: commandLens?.navigationOrientation,
		placement: commandLens?.placement,
		plainArrowNavigation: commandLens?.plainArrowNavigation,
		radius: commandLens?.radius,
	});

	const setElement = useCallback(
		(element: HTMLElement | null): void => {
			onElementChange?.(element);
			target.ref(element);
		},
		[onElementChange, target.ref]
	);

	return {
		ariaKeyShortcuts: target.ariaKeyShortcuts,
		setElement,
	};
};

export function RepositoryItem({
	asContextMenuTrigger = false,
	commandLens,
	contextOpen,
	disabled,
	onClick,
	onContextMenu,
	onElementChange,
	onKeyDown,
	pickerValue,
	preview,
	repository,
	variant,
	workspace,
}: RepositoryItemProps): ReactElement {
	const tooltipId = useId();
	const repositoryName = recentRepositoryName(repository);

	const owner =
		workspace?.owner ??
		(preview
			? getRepositoryOwner(preview.remotes, preview.head.upstream)
			: null);

	const branchName =
		workspace?.branch ?? (preview ? preview.head.branch : null);

	const thumbnailLabel = owner ? owner.namespace : repositoryName;

	const ownerTitle = owner
		? `${owner.namespace} on ${owner.host}`
		: "Local repository";

	const lastUsed = formatRelativeTime(repository.lastOpenedAt);
	const label = `${repositoryName}${branchName ? `, branch ${branchName}` : ""}, last used ${lastUsed}${workspace ? ", open" : ""}`;

	const commandLensTarget = useRepositoryItemCommandLens({
		commandLens,
		disabled,
		onElementChange,
		repositoryPath: repository.path,
	});

	const content = (
		<>
			<RepositoryOwnerThumbnail
				label={thumbnailLabel}
				owner={owner}
				size={variant === "menu" ? "sm" : "md"}
				title={ownerTitle}
			/>
			<span className="flex min-w-0 flex-1 items-baseline overflow-hidden">
				<span
					className={cn(
						"shrink-0 font-semibold text-editor-ink",
						variant === "welcome" && "text-xs"
					)}
				>
					{repositoryName}
				</span>
				{branchName ? (
					<>
						<span className="shrink-0 text-editor-faint">&nbsp;/&nbsp;</span>
						<span
							className={cn(
								"min-w-0 truncate font-normal text-editor-muted",
								variant === "welcome" && "text-xs"
							)}
						>
							{branchName}
						</span>
					</>
				) : (
					<span className="min-w-0 truncate font-normal text-editor-faint">
						&nbsp;/ Loading branch…
					</span>
				)}
			</span>
			<time
				className={cn(
					"shrink-0 font-normal text-editor-faint tabular-nums",
					variant === "menu" ? "text-[10px]" : "text-xss"
				)}
				dateTime={repository.lastOpenedAt}
				title={formatCommitDate(repository.lastOpenedAt)}
			>
				{lastUsed}
			</time>
			{workspace ? (
				<>
					<span
						aria-hidden
						className="size-1.5 shrink-0 rounded-full bg-brand"
					/>
					<span className="sr-only">Open repository</span>
				</>
			) : null}
		</>
	);

	const sharedProps = {
		"aria-describedby": tooltipId,
		"aria-keyshortcuts": commandLensTarget.ariaKeyShortcuts,
		"aria-label": label,
		"data-context-open": contextOpen ? "true" : undefined,
		"data-name": "RepositoryItem",
		onClick,
		onContextMenu,
		onKeyDown,
		ref: commandLensTarget.setElement,
	};

	const row =
		variant === "menu" ? (
			<ComboboxItem
				{...sharedProps}
				className={cn(
					"relative gap-2 transition-[background-color,opacity] duration-150",
					contextOpen && "z-20"
				)}
				disabled={disabled}
				value={pickerValue}
			>
				{content}
			</ComboboxItem>
		) : (
			<button
				{...sharedProps}
				className={cn(
					"group relative flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left outline-none transition-[background-color,opacity] duration-150 hover:bg-hover focus-visible:z-10 focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-brand/20 disabled:pointer-events-none disabled:opacity-50",
					contextOpen && "z-10"
				)}
				disabled={disabled}
				type="button"
			>
				{content}
			</button>
		);

	const trigger = asContextMenuTrigger ? (
		<LiquidContextMenuTrigger render={row} />
	) : (
		row
	);

	return (
		<Tooltip disabled={contextOpen}>
			<TooltipTrigger render={trigger} />
			<TooltipContent
				align="center"
				className="max-w-80 items-start"
				id={tooltipId}
				side="right"
				sideOffset={8}
			>
				<span className="min-w-0 py-1">
					<span className="block truncate font-semibold">{repositoryName}</span>
					<span className="mt-0.5 block break-all opacity-70">
						{repository.path}
					</span>
					<RepositoryTooltipDetails preview={preview} />
				</span>
			</TooltipContent>
		</Tooltip>
	);
}
