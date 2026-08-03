import { cn } from "@1git/ui/lib/utils";
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";

type ComboboxRootProps<
	Value,
	Multiple extends boolean | undefined = false,
> = ComboboxPrimitive.Root.Props<Value, Multiple>;

function Combobox<Value, Multiple extends boolean | undefined = false>(
	props: ComboboxRootProps<Value, Multiple>
) {
	return <ComboboxPrimitive.Root data-slot="combobox" {...props} />;
}

function ComboboxTrigger({ ...props }: ComboboxPrimitive.Trigger.Props) {
	return <ComboboxPrimitive.Trigger data-slot="combobox-trigger" {...props} />;
}

function ComboboxPortal({ ...props }: ComboboxPrimitive.Portal.Props) {
	return <ComboboxPrimitive.Portal data-slot="combobox-portal" {...props} />;
}

function ComboboxPositioner({
	className,
	...props
}: ComboboxPrimitive.Positioner.Props) {
	return (
		<ComboboxPrimitive.Positioner
			className={cn("isolate z-50 outline-none", className)}
			data-slot="combobox-positioner"
			{...props}
		/>
	);
}

function ComboboxPopup({ className, ...props }: ComboboxPrimitive.Popup.Props) {
	return (
		<ComboboxPrimitive.Popup
			className={cn(
				"data-[side=bottom]:slide-in-from-top-1 data-[side=inline-end]:slide-in-from-left-1 data-[side=inline-start]:slide-in-from-right-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 relative z-50 max-h-(--available-height) w-(--anchor-width) min-w-48 origin-(--transform-origin) overflow-y-auto overflow-x-hidden rounded-xl border border-editor-hairline-strong bg-editor-surface p-1 text-editor-ink shadow-none outline-none duration-100 data-closed:animate-out data-open:animate-in data-closed:overflow-hidden",
				className
			)}
			data-slot="combobox-popup"
			{...props}
		/>
	);
}

function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
	return (
		<ComboboxPrimitive.Input
			className={cn(
				"h-9 w-full min-w-0 rounded-lg bg-editor-surface px-3 text-editor-ink text-sm shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-editor-faint focus-visible:border-editor-muted focus-visible:ring-2 focus-visible:ring-editor-muted/15 disabled:pointer-events-none disabled:opacity-50",
				className
			)}
			data-name="Input"
			data-slot="combobox-input"
			{...props}
		/>
	);
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
	return (
		<ComboboxPrimitive.List
			className={cn("outline-none", className)}
			data-slot="combobox-list"
			{...props}
		/>
	);
}

function ComboboxItem({ className, ...props }: ComboboxPrimitive.Item.Props) {
	return (
		<ComboboxPrimitive.Item
			className={cn(
				"group/combobox-item relative flex cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 font-medium text-editor-ink text-xs outline-hidden data-disabled:pointer-events-none data-highlighted:bg-editor-sunken data-disabled:opacity-50 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
				className
			)}
			data-slot="combobox-item"
			{...props}
		/>
	);
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
	return (
		<ComboboxPrimitive.Empty
			className={cn(
				"px-3 py-5 text-center text-editor-faint text-xs empty:p-0",
				className
			)}
			data-slot="combobox-empty"
			{...props}
		/>
	);
}

function ComboboxSeparator({
	className,
	...props
}: ComboboxPrimitive.Separator.Props) {
	return (
		<ComboboxPrimitive.Separator
			className={cn("-mx-1 my-1 h-px bg-editor-hairline", className)}
			data-slot="combobox-separator"
			{...props}
		/>
	);
}

type ComboboxPopupProps = ComboboxPrimitive.Popup.Props;
type ComboboxPositionerProps = ComboboxPrimitive.Positioner.Props;

export type { ComboboxPopupProps, ComboboxPositionerProps, ComboboxRootProps };
export {
	Combobox,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
	ComboboxPopup,
	ComboboxPortal,
	ComboboxPositioner,
	ComboboxSeparator,
	ComboboxTrigger,
};
