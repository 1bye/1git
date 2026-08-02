import { cn } from "@1git/ui/lib/utils";
import type { ComponentProps, CSSProperties, ReactElement } from "react";
import { LIQUID_MENU_MOTION } from "@/fixture/liquid-menu/constants/liquid-menu.js";

interface LiquidMenuDimScopeStyle extends CSSProperties {
	readonly "--liquid-menu-backdrop-opacity": number;
	readonly "--liquid-menu-dim-overflow-block-end": string;
}

interface LiquidMenuDimScopeProps extends ComponentProps<"div"> {
	readonly overflowBlockEnd?: number;
}

export function LiquidMenuDimScope({
	className,
	overflowBlockEnd = 0,
	style,
	...props
}: LiquidMenuDimScopeProps): ReactElement {
	const scopeStyle: LiquidMenuDimScopeStyle = {
		...style,
		"--liquid-menu-backdrop-opacity": LIQUID_MENU_MOTION.backdropOpacity,
		"--liquid-menu-dim-overflow-block-end": `${overflowBlockEnd}px`,
	};

	return (
		<div
			className={cn("relative isolate", className)}
			data-liquid-menu-dim-scope
			style={scopeStyle}
			{...props}
		/>
	);
}
