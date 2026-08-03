import type {
	ReactElement,
	MouseEvent as ReactMouseEvent,
	RefCallback,
} from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	OpenRepositoryOptions,
	WorkspaceTabState,
} from "@/feature/workspace/hooks/use-git-workspace.js";
import type { CommandLensTargetOptions } from "@/fixture/command-lens/hooks/use-command-lens-context.js";
import {
	LiquidContextMenuRoot,
	LiquidMenuContent,
} from "@/fixture/liquid-menu/components/liquid-menu.js";
import { useLiquidContextMenuPosition } from "@/fixture/liquid-menu/hooks/use-liquid-context-menu-position.js";
import { RepositoryContextActions } from "@/fixture/repository-item/components/repository-context-actions.js";
import { RepositoryItem } from "@/fixture/repository-item/components/repository-item.js";
import {
	REPOSITORY_CONTEXT_MENU_ANCHOR_GEOMETRY,
	REPOSITORY_CONTEXT_MENU_WIDTH,
	REPOSITORY_CONTEXT_MENU_WIDTH_CLASS_NAME,
} from "@/fixture/repository-item/constants/repository-context-menu.js";
import { shouldOpenRepositoryInBackground } from "@/fixture/repository-item/lib/repository-context-menu.js";
import type {
	RecentRepositoryPreview,
	RecentRepositoryRecord,
} from "../../../../../shared/repository-session.js";

interface RepositoryContextMenuProps {
	readonly commandLens?: Omit<CommandLensTargetOptions, "disabled">;
	readonly disabled: boolean;
	readonly metaKey?: boolean;
	readonly onContextOpenChange?: (isOpen: boolean) => void;
	readonly onContextPresenceChange?: (isPresent: boolean) => void;
	readonly onForgetRecent: (path: string) => Promise<void>;
	readonly onItemElementChange?: RefCallback<HTMLElement>;
	readonly onOpen: (
		path: string,
		options?: OpenRepositoryOptions
	) => Promise<void>;
	readonly onOpenForeground?: () => void;
	readonly open?: boolean;
	readonly pickerValue?: unknown;
	readonly preview: RecentRepositoryPreview | null;
	readonly repository: RecentRepositoryRecord;
	readonly variant: "menu" | "welcome";
	readonly workspace: WorkspaceTabState | null;
}

export function RepositoryContextMenu({
	commandLens,
	disabled,
	metaKey = false,
	onContextOpenChange,
	onContextPresenceChange,
	onForgetRecent,
	onItemElementChange,
	onOpen,
	onOpenForeground,
	open,
	pickerValue,
	preview,
	repository,
	variant,
	workspace,
}: RepositoryContextMenuProps): ReactElement {
	const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null);
	const [internalOpen, setInternalOpen] = useState(false);
	const [isPresent, setIsPresent] = useState(false);
	const onContextOpenChangeRef = useRef(onContextOpenChange);
	const onContextPresenceChangeRef = useRef(onContextPresenceChange);
	onContextOpenChangeRef.current = onContextOpenChange;
	onContextPresenceChangeRef.current = onContextPresenceChange;
	const isOpen = open ?? internalOpen;
	const contextMenuPosition = useLiquidContextMenuPosition({
		anchorElement,
		menuWidth: REPOSITORY_CONTEXT_MENU_WIDTH,
	});
	const getAnchor = useCallback(
		(): Element | null => anchorElement,
		[anchorElement]
	);
	const setItemElement = useCallback(
		(element: HTMLElement | null): void => {
			setAnchorElement(element);
			onItemElementChange?.(element);
		},
		[onItemElementChange]
	);
	const changeOpen = useCallback(
		(nextIsOpen: boolean): void => {
			if (open === undefined) {
				setInternalOpen(nextIsOpen);
			}
			if (!nextIsOpen) {
				contextMenuPosition.resetPointer();
			}
			onContextOpenChange?.(nextIsOpen);
		},
		[contextMenuPosition.resetPointer, onContextOpenChange, open]
	);
	const changePresence = useCallback(
		(nextIsPresent: boolean): void => {
			setIsPresent(nextIsPresent);
			onContextPresenceChange?.(nextIsPresent);
		},
		[onContextPresenceChange]
	);
	const openRepository = async (
		event: ReactMouseEvent<HTMLElement>
	): Promise<void> => {
		const openInBackground = shouldOpenRepositoryInBackground(
			event.metaKey,
			metaKey
		);
		if (openInBackground) {
			(
				event as ReactMouseEvent<HTMLElement> & {
					preventBaseUIHandler?: () => void;
				}
			).preventBaseUIHandler?.();
		}
		if (!openInBackground) {
			onOpenForeground?.();
		}
		await onOpen(repository.path, { activate: !openInBackground });
	};
	const item = (
		<RepositoryItem
			asContextMenuTrigger
			commandLens={commandLens}
			contextOpen={isOpen || isPresent}
			disabled={disabled}
			onClick={openRepository}
			onContextMenu={contextMenuPosition.onContextMenu}
			onElementChange={setItemElement}
			pickerValue={pickerValue}
			preview={preview}
			repository={repository}
			variant={variant}
			workspace={workspace}
		/>
	);
	const actions = (
		<RepositoryContextActions
			onDismiss={() => changeOpen(false)}
			onForgetRecent={onForgetRecent}
			onOpen={onOpen}
			onOpenForeground={onOpenForeground}
			preview={preview}
			repository={repository}
			workspace={workspace}
		/>
	);

	useEffect(
		() => (): void => {
			onContextOpenChangeRef.current?.(false);
			onContextPresenceChangeRef.current?.(false);
		},
		[]
	);

	return (
		<LiquidContextMenuRoot
			anchor={getAnchor}
			anchorGeometry={REPOSITORY_CONTEXT_MENU_ANCHOR_GEOMETRY}
			onOpenChange={changeOpen}
			onPresenceChange={changePresence}
			open={isOpen}
		>
			{item}
			{isOpen ? (
				<LiquidMenuContent
					align="start"
					alignOffset={contextMenuPosition.alignOffset}
					aria-label={`Actions for ${repository.path}`}
					className={`${REPOSITORY_CONTEXT_MENU_WIDTH_CLASS_NAME} p-1.5`}
					side="bottom"
					sideOffset={0}
				>
					{actions}
				</LiquidMenuContent>
			) : null}
		</LiquidContextMenuRoot>
	);
}
