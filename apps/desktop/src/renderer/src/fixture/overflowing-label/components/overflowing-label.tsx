import { cn } from "@1git/ui/lib/utils";
import type { ReactElement, ReactNode } from "react";

import { useOverflowingLabel } from "@/fixture/overflowing-label/hooks/use-overflowing-label.js";
import type { OverflowingLabelDirection } from "@/fixture/overflowing-label/lib/overflowing-label.js";

interface OverflowingLabelProps {
	readonly children: ReactNode;
	readonly className?: string;
	readonly deferUntilVisible?: boolean;
	readonly direction?: OverflowingLabelDirection;
	readonly title?: string;
	readonly trackClassName?: string;
}

export function OverflowingLabel({
	children,
	className,
	deferUntilVisible = false,
	direction = "start-to-end",
	title,
	trackClassName,
}: OverflowingLabelProps): ReactElement {
	const { isOverflowing, style, trackRef, viewportRef } = useOverflowingLabel(
		deferUntilVisible,
		direction
	);

	return (
		<span
			className={cn(
				"pointer-events-none block min-w-0 overflow-hidden",
				className
			)}
			data-name="OverflowingLabelViewport"
			data-overflow-direction={direction}
			data-overflowing={isOverflowing ? "true" : undefined}
			ref={viewportRef}
			style={style}
			title={title}
		>
			<span
				className={cn(
					"inline-block min-w-max whitespace-nowrap",
					trackClassName
				)}
				data-name="OverflowingLabelTrack"
				ref={trackRef}
			>
				{children}
			</span>
		</span>
	);
}
