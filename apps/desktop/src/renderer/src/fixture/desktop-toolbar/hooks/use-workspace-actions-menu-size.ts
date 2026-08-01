import type { CSSProperties, RefCallback } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface WorkspaceActionsMenuSizeRefs {
	readonly containerStyle: CSSProperties | undefined;
	readonly contentRef: RefCallback<HTMLDivElement>;
}

const HEIGHT_EPSILON = 0.5;

export const useWorkspaceActionsMenuSize = (): WorkspaceActionsMenuSizeRefs => {
	const [height, setHeight] = useState<number | null>(null);
	const resizeObserverRef = useRef<ResizeObserver | null>(null);

	const contentRef = useCallback((content: HTMLDivElement | null): void => {
		resizeObserverRef.current?.disconnect();
		resizeObserverRef.current = null;
		if (!content) {
			return;
		}

		const resize = (): void => {
			const nextHeight = content.getBoundingClientRect().height;
			setHeight((currentHeight) =>
				currentHeight !== null &&
				Math.abs(currentHeight - nextHeight) < HEIGHT_EPSILON
					? currentHeight
					: nextHeight
			);
		};

		resize();
		const resizeObserver = new ResizeObserver(resize);
		resizeObserver.observe(content);
		resizeObserverRef.current = resizeObserver;
	}, []);

	useEffect(() => () => resizeObserverRef.current?.disconnect(), []);

	const containerStyle = useMemo<CSSProperties | undefined>(
		() => (height === null ? undefined : { height }),
		[height]
	);

	return { containerStyle, contentRef };
};
