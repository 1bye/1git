import { cn } from "@1git/ui/lib/utils";
import type { ComponentProps } from "react";

const Card = ({ className, ...props }: ComponentProps<"div">) => (
	<div
		className={cn(
			"flex flex-col rounded-2xl border border-editor-hairline bg-card text-card-foreground shadow-surface-2",
			className
		)}
		data-slot="card"
		{...props}
	/>
);

const CardHeader = ({ className, ...props }: ComponentProps<"div">) => (
	<div
		className={cn(
			"grid auto-rows-min items-start gap-1.5 px-5 pt-5 has-data-[slot=card-action]:grid-cols-[1fr_auto]",
			className
		)}
		data-slot="card-header"
		{...props}
	/>
);

const CardTitle = ({ className, ...props }: ComponentProps<"div">) => (
	<div
		className={cn("font-semibold text-base tracking-[-0.01em]", className)}
		data-slot="card-title"
		{...props}
	/>
);

const CardDescription = ({ className, ...props }: ComponentProps<"div">) => (
	<div
		className={cn("text-editor-muted text-sm leading-5", className)}
		data-slot="card-description"
		{...props}
	/>
);

const CardAction = ({ className, ...props }: ComponentProps<"div">) => (
	<div
		className={cn(
			"col-start-2 row-span-2 row-start-1 self-start justify-self-end",
			className
		)}
		data-slot="card-action"
		{...props}
	/>
);

const CardContent = ({ className, ...props }: ComponentProps<"div">) => (
	<div
		className={cn("px-5 pb-5", className)}
		data-slot="card-content"
		{...props}
	/>
);

const CardFooter = ({ className, ...props }: ComponentProps<"div">) => (
	<div
		className={cn("flex items-center px-5 pb-5", className)}
		data-slot="card-footer"
		{...props}
	/>
);

export {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
};
