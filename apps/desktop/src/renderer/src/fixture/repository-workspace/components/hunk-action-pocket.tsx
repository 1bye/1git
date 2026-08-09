import type { ChangeHunkInput, HunkAction } from "@1git/git";
import { Button } from "@1git/ui/components/button";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@1git/ui/components/dropdown-menu";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type { ReactElement } from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	LiquidMenuContent,
	LiquidMenuRoot,
} from "@/fixture/liquid-menu/components/liquid-menu.js";
import { LiquidMenuAutoSize } from "@/fixture/liquid-menu/components/liquid-menu-auto-size.js";
import type { LiquidMenuRect } from "@/fixture/liquid-menu/lib/liquid-menu-geometry.js";
import { getLiquidMenuLayerZIndices } from "@/fixture/liquid-menu/lib/liquid-menu-stack.js";
import { createLiquidGeometryTracker } from "@/fixture/liquid-surface/lib/track-liquid-geometry.js";
import {
	REPOSITORY_HUNK_ACTION_ANCHOR_GEOMETRY,
	REPOSITORY_HUNK_ACTION_WIDTH_CLASS_NAME,
} from "@/fixture/repository-workspace/constants/repository-diff.js";
import { measureHunkActionSelection } from "@/fixture/repository-workspace/lib/hunk-action-anchor.js";

type HunkActionView = "actions" | "confirm-discard";

const HUNK_ACTION_ANCHOR_Z_INDEX = getLiquidMenuLayerZIndices(0).selection;

export interface HunkActionSelection {
	readonly anchorBounds: LiquidMenuRect;
	readonly anchorElement: HTMLButtonElement;
	readonly hunkIndex: number;
	readonly path: string;
	readonly target: "staged" | "working";
	readonly viewportElement: HTMLElement;
}

export type HunkActionHandler = (input: ChangeHunkInput) => Promise<boolean>;

interface HunkActionPocketProps {
	readonly isPending: boolean;
	readonly onChangeHunk: HunkActionHandler;
	readonly onOpenChange: (isOpen: boolean) => void;
	readonly onPresenceChange: (isPresent: boolean) => void;
	readonly open: boolean;
	readonly selection: HunkActionSelection;
}

export function HunkActionPocket({
	isPending,
	onChangeHunk,
	onOpenChange,
	onPresenceChange,
	open,
	selection,
}: HunkActionPocketProps): ReactElement {
	const [view, setView] = useState<HunkActionView>("actions");
	const [actionError, setActionError] = useState<string | null>(null);
	const anchorRef = useRef<HTMLSpanElement | null>(null);
	const getAnchor = useCallback((): Element | null => anchorRef.current, []);
	const getAnchorViewport = useCallback(
		(): Element | null => selection.viewportElement,
		[selection.viewportElement]
	);
	const changeOpen = useCallback(
		(nextIsOpen: boolean): void => {
			onOpenChange(nextIsOpen);
			if (!nextIsOpen) {
				setActionError(null);
				setView("actions");
			}
		},
		[onOpenChange]
	);
	const positionAnchor = useCallback(
		(anchor: HTMLSpanElement): void => {
			const measurement = measureHunkActionSelection(
				selection.anchorElement,
				selection.anchorBounds,
				selection.viewportElement
			);
			if (!measurement) {
				anchor.style.visibility = "hidden";
				changeOpen(false);
				return;
			}
			const { anchor: bounds, visibleAnchor } = measurement;
			const clipBottom =
				bounds.top + bounds.height - (visibleAnchor.top + visibleAnchor.height);
			const clipLeft = visibleAnchor.left - bounds.left;
			const clipRight =
				bounds.left + bounds.width - (visibleAnchor.left + visibleAnchor.width);
			const clipTop = visibleAnchor.top - bounds.top;
			anchor.style.clipPath = `inset(${clipTop}px ${clipRight}px ${clipBottom}px ${clipLeft}px)`;
			anchor.style.height = `${bounds.height}px`;
			anchor.style.left = `${bounds.left}px`;
			anchor.style.top = `${bounds.top}px`;
			anchor.style.visibility = "visible";
			anchor.style.width = `${bounds.width}px`;
		},
		[
			changeOpen,
			selection.anchorBounds,
			selection.anchorElement,
			selection.viewportElement,
		]
	);
	const setAnchorElement = useCallback(
		(anchor: HTMLSpanElement | null): void => {
			anchorRef.current = anchor;
			if (anchor) {
				positionAnchor(anchor);
			}
		},
		[positionAnchor]
	);
	useLayoutEffect(() => {
		const anchor = anchorRef.current;
		if (!anchor) {
			return;
		}
		const tracker = createLiquidGeometryTracker(() => {
			positionAnchor(anchor);
		});
		const trackedElements = [selection.viewportElement, anchor];
		if (selection.anchorElement.isConnected) {
			trackedElements.push(selection.anchorElement);
		}
		tracker.setElements(trackedElements);
		return tracker.disconnect;
	}, [positionAnchor, selection.anchorElement, selection.viewportElement]);
	const runAction = async (action: HunkAction): Promise<void> => {
		setActionError(null);
		const succeeded = await onChangeHunk({
			action,
			allowDestructive: action === "discard",
			hunkIndex: selection.hunkIndex,
			path: selection.path,
		});
		if (succeeded) {
			changeOpen(false);
			return;
		}
		setActionError("The hunk changed before the action could be applied.");
	};

	return (
		<>
			{createPortal(
				<span
					aria-hidden
					className="pointer-events-none fixed flex items-center justify-center rounded-md bg-editor-ink text-white"
					data-name="RepositoryHunkActionAnchor"
					ref={setAnchorElement}
					style={{
						zIndex: HUNK_ACTION_ANCHOR_Z_INDEX,
					}}
				>
					<DotsThreeIcon aria-hidden className="size-3.5" weight="bold" />
				</span>,
				document.body
			)}
			<LiquidMenuRoot
				anchor={getAnchor}
				anchorClip={getAnchorViewport}
				anchorGeometry={REPOSITORY_HUNK_ACTION_ANCHOR_GEOMETRY}
				disabled={isPending}
				onOpenChange={changeOpen}
				onPresenceChange={onPresenceChange}
				open={open}
			>
				<LiquidMenuContent
					align="start"
					anchor={getAnchor}
					aria-label={`Actions for hunk ${selection.hunkIndex + 1}`}
					className={`${REPOSITORY_HUNK_ACTION_WIDTH_CLASS_NAME} p-1.5`}
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
								Discard hunk
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<p className="px-2 py-2 text-[10px] text-editor-faint leading-4">
								This permanently restores these working-tree lines.
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
									onClick={() => runAction("discard")}
									size="sm"
									type="button"
									variant="destructive"
								>
									Discard
								</Button>
							</div>
							{actionError ? (
								<p
									aria-live="polite"
									className="px-2 py-1 text-[10px] text-destructive leading-4"
									role="status"
								>
									{actionError}
								</p>
							) : null}
						</LiquidMenuAutoSize>
					) : (
						<LiquidMenuAutoSize viewKey="actions">
							{selection.target === "working" ? (
								<DropdownMenuItem
									closeOnClick={false}
									disabled={isPending}
									onClick={() => runAction("stage")}
								>
									<CheckIcon
										aria-hidden
										className="text-editor-faint"
										weight="bold"
									/>
									Stage hunk
								</DropdownMenuItem>
							) : (
								<DropdownMenuItem
									closeOnClick={false}
									disabled={isPending}
									onClick={() => runAction("unstage")}
								>
									<MinusIcon
										aria-hidden
										className="text-editor-faint"
										weight="bold"
									/>
									Unstage hunk
								</DropdownMenuItem>
							)}
							{selection.target === "working" ? (
								<>
									<DropdownMenuSeparator />
									<DropdownMenuItem
										className="text-destructive focus:text-destructive"
										closeOnClick={false}
										disabled={isPending}
										onClick={() => setView("confirm-discard")}
									>
										<TrashIcon aria-hidden weight="duotone" />
										Discard hunk…
									</DropdownMenuItem>
								</>
							) : null}
							{actionError ? (
								<p
									aria-live="polite"
									className="px-2 py-1 text-[10px] text-destructive leading-4"
									role="status"
								>
									{actionError}
								</p>
							) : null}
						</LiquidMenuAutoSize>
					)}
				</LiquidMenuContent>
			</LiquidMenuRoot>
		</>
	);
}
