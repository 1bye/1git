import { cn } from "@1git/ui/lib/utils";
import type { ComponentProps } from "react";

const Textarea = ({ className, ...props }: ComponentProps<"textarea">) => (
	<textarea
		className={cn(
			"min-h-20 w-full min-w-0 resize-none rounded-lg border border-editor-hairline bg-editor-surface px-3 py-2 text-editor-ink text-sm shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-editor-faint focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/15 disabled:pointer-events-none disabled:opacity-50",
			className
		)}
		data-name="Textarea"
		data-slot="textarea"
		{...props}
	/>
);

export { Textarea };
