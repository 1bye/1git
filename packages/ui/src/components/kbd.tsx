import { cn } from "@1git/ui/lib/utils";
import type { ComponentProps } from "react";

function Kbd({ className, ...props }: ComponentProps<"kbd">) {
	return (
		<kbd
			className={cn(
				"pointer-events-none inline-flex h-5.5 w-fit min-w-5.5 select-none items-center justify-center gap-1 rounded-lg bg-muted in-data-[slot=input-group]:bg-input in-data-[slot=tooltip-content]:bg-background/20 px-1.5 font-medium in-data-[slot=tooltip-content]:text-background text-muted-foreground text-xs [font-family:var(--font-kbd)] dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-'])]:size-3",
				className
			)}
			data-name="Kbd"
			data-slot="kbd"
			{...props}
		/>
	);
}

function KbdGroup({ className, ...props }: ComponentProps<"kbd">) {
	return (
		<kbd
			className={cn("inline-flex items-center gap-1", className)}
			data-name="KbdGroup"
			data-slot="kbd-group"
			{...props}
		/>
	);
}

export { Kbd, KbdGroup };
