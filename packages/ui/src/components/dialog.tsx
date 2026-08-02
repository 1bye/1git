import { Button } from "@1git/ui/components/button";
import { surfaceClasses } from "@1git/ui/lib/surface-classes";
import { SurfaceProvider, useSurface } from "@1git/ui/lib/surface-context";
import { cn } from "@1git/ui/lib/utils";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import type { ComponentProps } from "react";

function Dialog(props: DialogPrimitive.Root.Props) {
	return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
	return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogClose(props: DialogPrimitive.Close.Props) {
	return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogContent({
	children,
	className,
	size = "sm",
	...props
}: DialogPrimitive.Popup.Props & {
	readonly size?: "lg" | "sm";
}) {
	const substrate = useSurface();
	const dialogLevel = Math.min(substrate + 4, 8);

	return (
		<DialogPrimitive.Portal>
			<DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 opacity-100 transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
			<DialogPrimitive.Popup
				className={cn(
					"fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 scale-100 rounded-2xl p-6 text-editor-ink opacity-100 outline-none transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] data-[ending-style]:scale-[0.97] data-[starting-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
					surfaceClasses(dialogLevel, 8),
					size === "sm" ? "max-w-[400px]" : "max-w-[540px]",
					className
				)}
				data-slot="dialog-content"
				{...props}
			>
				<SurfaceProvider value={dialogLevel}>
					{children}
					<DialogPrimitive.Close
						render={
							<Button
								aria-label="Close dialog"
								className="absolute top-3 right-3"
								size="icon-sm"
								variant="ghost"
							/>
						}
					>
						<XIcon aria-hidden className="size-4" />
					</DialogPrimitive.Close>
				</SurfaceProvider>
			</DialogPrimitive.Popup>
		</DialogPrimitive.Portal>
	);
}

function DialogHeader({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			className={cn("mb-5 flex flex-col gap-1.5", className)}
			data-slot="dialog-header"
			{...props}
		/>
	);
}

function DialogFooter({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			className={cn("mt-6 flex justify-end gap-2", className)}
			data-slot="dialog-footer"
			{...props}
		/>
	);
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
	return (
		<DialogPrimitive.Title
			className={cn(
				"font-semibold text-base text-editor-ink leading-tight",
				className
			)}
			data-slot="dialog-title"
			{...props}
		/>
	);
}

function DialogDescription({
	className,
	...props
}: DialogPrimitive.Description.Props) {
	return (
		<DialogPrimitive.Description
			className={cn("text-editor-muted text-xs leading-5", className)}
			data-slot="dialog-description"
			{...props}
		/>
	);
}

export {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
};
