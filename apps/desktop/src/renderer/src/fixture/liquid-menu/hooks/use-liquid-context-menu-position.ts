import type { MouseEventHandler, MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useState } from "react";

import {
	getConstrainedMenuAlignOffset,
	getContextMenuPointerClientX,
} from "@/fixture/liquid-menu/lib/liquid-menu-position.js";

interface UseLiquidContextMenuPositionOptions {
	readonly anchorElement: HTMLElement | null;
	readonly inlineInset?: number;
	readonly menuWidth: number;
}

interface LiquidContextMenuPosition {
	readonly alignOffset: number;
	readonly onContextMenu: MouseEventHandler<HTMLElement>;
	readonly resetPointer: () => void;
}

const DEFAULT_INLINE_INSET = 8;

export const useLiquidContextMenuPosition = ({
	anchorElement,
	inlineInset = DEFAULT_INLINE_INSET,
	menuWidth,
}: UseLiquidContextMenuPositionOptions): LiquidContextMenuPosition => {
	const [pointerClientX, setPointerClientX] = useState<number | null>(null);
	const anchorRect = anchorElement?.getBoundingClientRect();

	const alignOffset = anchorRect
		? getConstrainedMenuAlignOffset({
				anchorLeft: anchorRect.left,
				anchorWidth: anchorRect.width,
				inlineInset,
				menuWidth,
				pointerClientX,
			})
		: 0;

	const capturePointer = useCallback(
		(event: ReactMouseEvent<HTMLElement>): void => {
			setPointerClientX(
				getContextMenuPointerClientX({
					clientX: event.clientX,
					clientY: event.clientY,
				})
			);
		},
		[]
	);

	const resetPointer = useCallback((): void => {
		setPointerClientX(null);
	}, []);

	return {
		alignOffset,
		onContextMenu: capturePointer,
		resetPointer,
	};
};
