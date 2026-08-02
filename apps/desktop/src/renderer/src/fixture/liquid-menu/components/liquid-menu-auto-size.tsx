import type { ReactElement, ReactNode } from "react";
import { useLiquidMenuSize } from "@/fixture/liquid-menu/hooks/use-liquid-menu-size.js";

interface LiquidMenuAutoSizeProps {
	readonly children: ReactNode;
	readonly viewKey?: string;
}

export function LiquidMenuAutoSize({
	children,
	viewKey,
}: LiquidMenuAutoSizeProps): ReactElement {
	const { containerStyle, contentRef } = useLiquidMenuSize();

	return (
		<div
			className="overflow-hidden"
			data-name="LiquidMenuAutoSize"
			style={containerStyle}
		>
			<div data-name="LiquidMenuNaturalSize" ref={contentRef}>
				<div data-name="LiquidMenuView" key={viewKey}>
					{children}
				</div>
			</div>
		</div>
	);
}
