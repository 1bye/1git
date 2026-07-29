import { cn } from "@1git/ui/lib/utils";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

const buttonVariants = cva(
	"inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium text-sm outline-none transition-[background-color,color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-ring/25 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
	{
		defaultVariants: {
			size: "default",
			variant: "default",
		},
		variants: {
			size: {
				default: "h-9 px-4",
				icon: "size-9",
				"icon-sm": "size-8",
				lg: "h-10 rounded-xl px-5",
				sm: "h-8 gap-1.5 rounded-lg px-3 text-xs",
			},
			variant: {
				brand: "bg-brand text-brand-foreground shadow-sm hover:bg-brand-strong",
				default:
					"bg-foreground text-background shadow-sm hover:bg-foreground/88",
				destructive:
					"bg-destructive text-white shadow-sm hover:bg-destructive/90",
				ghost: "text-editor-muted hover:bg-hover hover:text-editor-ink",
				link: "text-brand underline-offset-4 hover:underline",
				outline:
					"border border-border bg-editor-surface text-editor-ink shadow-xs hover:bg-editor-sunken",
				secondary: "bg-editor-sunken text-editor-ink hover:bg-editor-sunken-2",
			},
		},
	}
);

type ButtonProps = ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & {
		asChild?: boolean;
	};

const Button = ({
	asChild = false,
	className,
	size,
	variant,
	...props
}: ButtonProps) => {
	const Component = asChild ? Slot : "button";

	return (
		<Component
			className={cn(buttonVariants({ className, size, variant }))}
			data-slot="button"
			{...props}
		/>
	);
};

export type { ButtonProps };
export { Button, buttonVariants };
