import { cn } from "@1git/ui/lib/utils";
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import type { ComponentProps } from "react";

function ScrollArea({
	className,
	...props
}: ComponentProps<typeof ScrollAreaPrimitive.Root>) {
	return (
		<ScrollAreaPrimitive.Root
			className={cn("relative overflow-hidden", className)}
			data-slot="scroll-area"
			{...props}
		/>
	);
}

function ScrollAreaViewport({
	className,
	...props
}: ComponentProps<typeof ScrollAreaPrimitive.Viewport>) {
	return (
		<ScrollAreaPrimitive.Viewport
			className={cn(
				"size-full overscroll-contain rounded-[inherit] outline-none",
				className
			)}
			data-slot="scroll-area-viewport"
			{...props}
		/>
	);
}

function ScrollAreaContent({
	className,
	...props
}: ComponentProps<typeof ScrollAreaPrimitive.Content>) {
	return (
		<ScrollAreaPrimitive.Content
			className={cn("w-full min-w-0!", className)}
			data-slot="scroll-area-content"
			{...props}
		/>
	);
}

function ScrollBar({
	className,
	orientation = "vertical",
	...props
}: ComponentProps<typeof ScrollAreaPrimitive.Scrollbar>) {
	return (
		<ScrollAreaPrimitive.Scrollbar
			className={cn(
				"z-20 flex touch-none select-none p-0.5 opacity-60 transition-opacity data-[orientation=horizontal]:h-2 data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2 data-[orientation=horizontal]:flex-col data-hovering:opacity-100 data-scrolling:opacity-100",
				className
			)}
			data-slot="scroll-area-scrollbar"
			orientation={orientation}
			{...props}
		>
			<ScrollAreaPrimitive.Thumb
				className="relative flex-1 rounded-full bg-editor-faint/65"
				data-slot="scroll-area-thumb"
			/>
		</ScrollAreaPrimitive.Scrollbar>
	);
}

export { ScrollArea, ScrollAreaContent, ScrollAreaViewport, ScrollBar };
