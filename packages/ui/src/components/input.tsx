import { cn } from "@1git/ui/lib/utils";
import type { ComponentProps } from "react";

const Input = ({ className, type, ...props }: ComponentProps<"input">) => (
	<input
		className={cn(
			"h-9 w-full min-w-0 rounded-lg border border-transparent bg-editor-surface px-3 text-editor-ink text-sm shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-editor-faint focus-visible:border-editor-muted focus-visible:ring-2 focus-visible:ring-editor-muted/15 disabled:pointer-events-none disabled:opacity-50",
			className
		)}
		data-name="Input"
		data-slot="input"
		type={type}
		{...props}
	/>
);

export { Input };
