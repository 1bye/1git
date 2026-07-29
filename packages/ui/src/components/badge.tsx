import { cn } from "@1git/ui/lib/utils";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

const badgeVariants = cva(
	"inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 rounded-full border px-2.5 font-medium text-xs",
	{
		defaultVariants: {
			variant: "default",
		},
		variants: {
			variant: {
				brand: "border-transparent bg-brand-soft text-brand-strong",
				default: "border-transparent bg-foreground text-background",
				outline: "border-editor-hairline bg-transparent text-editor-muted",
				secondary: "border-transparent bg-editor-sunken text-editor-muted",
			},
		},
	}
);

type BadgeProps = ComponentProps<"span"> &
	VariantProps<typeof badgeVariants> & {
		asChild?: boolean;
	};

const Badge = ({
	asChild = false,
	className,
	variant,
	...props
}: BadgeProps) => {
	const Component = asChild ? Slot : "span";

	return (
		<Component
			className={cn(badgeVariants({ className, variant }))}
			data-slot="badge"
			{...props}
		/>
	);
};

export { Badge, badgeVariants };
