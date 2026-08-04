import { cn } from "@1git/ui/lib/utils";
import type { ReactElement, ReactNode } from "react";
import { useOverflowingLabel } from "@/fixture/overflowing-label/hooks/use-overflowing-label.js";

interface OverflowingLabelProps {
	readonly children: ReactNode;
	readonly className?: string;
	readonly title?: string;
	readonly trackClassName?: string;
}

export function OverflowingLabel({
	children,
	className,
	title,
	trackClassName,
}: OverflowingLabelProps): ReactElement {
	const { isOverflowing, style, trackRef, viewportRef } = useOverflowingLabel();

	return (
		<span
			className={cn(
				"pointer-events-none block min-w-0 overflow-hidden",
				className
			)}
			data-name="OverflowingLabelViewport"
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
