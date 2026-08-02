import type {
	ReactElement,
	KeyboardEvent as ReactKeyboardEvent,
	MouseEvent as ReactMouseEvent,
} from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	OpenRepositoryOptions,
	WorkspaceTabState,
} from "@/feature/workspace/hooks/use-git-workspace.js";
import {
	LiquidContextMenuRoot,
	LiquidMenuContent,
	LiquidMenuSub,
	LiquidMenuSubContent,
} from "@/fixture/liquid-menu/components/liquid-menu.js";
import { RepositoryContextActions } from "@/fixture/repository-item/components/repository-context-actions.js";
import { RepositoryItem } from "@/fixture/repository-item/components/repository-item.js";
import {
	REPOSITORY_CONTEXT_MENU_ANCHOR_GEOMETRY,
	REPOSITORY_CONTEXT_MENU_WIDTH_CLASS_NAME,
} from "@/fixture/repository-item/constants/repository-context-menu.js";
import {
	isRepositoryContextMenuKey,
	shouldOpenRepositoryInBackground,
} from "@/fixture/repository-item/lib/repository-context-menu.js";
import type {
	RecentRepositoryPreview,
	RecentRepositoryRecord,
} from "../../../../../shared/repository-session.js";

type RepositoryContextMenuPlacement = "bottom" | "right";

interface RepositoryContextMenuProps {
	readonly disabled: boolean;
	readonly metaKey?: boolean;
	readonly onContextOpenChange?: (isOpen: boolean) => void;
	readonly onOpen: (
		path: string,
		options?: OpenRepositoryOptions
	) => Promise<void>;
	readonly onOpenForeground?: () => void;
	readonly open?: boolean;
	readonly placement: RepositoryContextMenuPlacement;
	readonly preview: RecentRepositoryPreview | null;
	readonly repository: RecentRepositoryRecord;
	readonly variant: "menu" | "welcome";
	readonly workspace: WorkspaceTabState | null;
}

export function RepositoryContextMenu({
	disabled,
	metaKey = false,
	onContextOpenChange,
	onOpen,
	onOpenForeground,
	open,
	placement,
	preview,
	repository,
	variant,
	workspace,
}: RepositoryContextMenuProps): ReactElement {
	const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null);
	const [internalOpen, setInternalOpen] = useState(false);
	const onContextOpenChangeRef = useRef(onContextOpenChange);
	const openedFromKeyboardRef = useRef(false);
	const submenuContentRef = useRef<HTMLDivElement>(null);
	onContextOpenChangeRef.current = onContextOpenChange;
	const isOpen = open ?? internalOpen;
	const getAnchor = useCallback(
		(): Element | null => anchorElement,
		[anchorElement]
	);
	const changeOpen = useCallback(
		(nextIsOpen: boolean): void => {
			if (open === undefined) {
				setInternalOpen(nextIsOpen);
			}
			onContextOpenChange?.(nextIsOpen);
		},
		[onContextOpenChange, open]
	);
	const openRepository = async (
		event: ReactMouseEvent<HTMLElement>
	): Promise<void> => {
		const openInBackground = shouldOpenRepositoryInBackground(
			event.metaKey,
			metaKey
		);
		if (!openInBackground) {
			onOpenForeground?.();
		}
		await onOpen(repository.path, { activate: !openInBackground });
	};
	const openNestedContextMenu = (event: ReactMouseEvent<HTMLElement>): void => {
		if (disabled) {
			return;
		}
		openedFromKeyboardRef.current = false;
		event.preventDefault();
		event.stopPropagation();
		changeOpen(true);
	};
	const openNestedContextMenuFromKeyboard = (
		event: ReactKeyboardEvent<HTMLElement>
	): void => {
		if (!(disabled || !isRepositoryContextMenuKey(event.key, event.shiftKey))) {
			openedFromKeyboardRef.current = true;
			event.preventDefault();
			event.stopPropagation();
			changeOpen(true);
		}
	};
	const item = (
		<RepositoryItem
			asContextMenuTrigger={placement === "bottom"}
			contextOpen={isOpen}
			disabled={disabled}
			onClick={openRepository}
			onContextMenu={placement === "right" ? openNestedContextMenu : undefined}
			onElementChange={setAnchorElement}
			onKeyDown={
				placement === "right" ? openNestedContextMenuFromKeyboard : undefined
			}
			preview={preview}
			repository={repository}
			variant={variant}
			workspace={workspace}
		/>
	);
	const actions = (
		<RepositoryContextActions
			onDismiss={() => changeOpen(false)}
			onOpen={onOpen}
			onOpenForeground={onOpenForeground}
			repositoryPath={repository.path}
		/>
	);

	useEffect(
		() => (): void => {
			onContextOpenChangeRef.current?.(false);
		},
		[]
	);
	useEffect(() => {
		if (!(isOpen && placement === "right" && openedFromKeyboardRef.current)) {
			return;
		}
		const focusFrame = requestAnimationFrame(() => {
			submenuContentRef.current
				?.querySelector<HTMLElement>('[data-slot="dropdown-menu-item"]')
				?.focus();
		});
		return () => cancelAnimationFrame(focusFrame);
	}, [isOpen, placement]);

	if (placement === "right") {
		return (
			<LiquidMenuSub
				anchor={anchorElement}
				onOpenChange={changeOpen}
				open={isOpen}
			>
				{item}
				{isOpen ? (
					<LiquidMenuSubContent
						align="center"
						anchor={getAnchor}
						aria-label={`Actions for ${repository.path}`}
						className={`${REPOSITORY_CONTEXT_MENU_WIDTH_CLASS_NAME} p-1.5`}
						ref={submenuContentRef}
						side="right"
						sideOffset={8}
					>
						{actions}
					</LiquidMenuSubContent>
				) : null}
			</LiquidMenuSub>
		);
	}

	return (
		<LiquidContextMenuRoot
			anchor={getAnchor}
			anchorGeometry={REPOSITORY_CONTEXT_MENU_ANCHOR_GEOMETRY}
			onOpenChange={changeOpen}
			open={isOpen}
		>
			{item}
			{isOpen ? (
				<LiquidMenuContent
					align="center"
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
