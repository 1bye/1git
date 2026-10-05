import { typography, spacing, radius } from "@1git/design-tokens";
import type { ComponentProps } from "react";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import {
	Tooltip as PrimitiveRoot,
	TooltipProvider as PrimitiveProvider,
	TooltipTrigger as PrimitiveTrigger,
	TooltipContent as PrimitiveContent,
} from "@gpuix/react/tooltip";
import { defaultTokens, type UiTokens } from "./tokens";

/** Shared native hover delay and skip-delay behavior for a group of tooltips. */
export const TooltipProvider = PrimitiveProvider;
/** Native controlled/uncontrolled tooltip state, composed around trigger and content. */
export const Tooltip = PrimitiveRoot;
/** Use asChild with a native host, or a control forwarding its ref and focus/hover handlers. */
export const TooltipTrigger = PrimitiveTrigger;
/** Native placement and host props, with an explicitly selected palette. */
export type TooltipContentProps = ComponentProps<typeof PrimitiveContent> & {
	tokens?: UiTokens;
};

/** Inverted, non-interactive tooltip surface. Native anchoring clamps it to the viewport. */
export function TooltipContent({
	tokens = defaultTokens,
	style,
	sideOffset = 8,
	...props
}: TooltipContentProps) {
	return (
		<PrimitiveContent
			role="tooltip"
			{...props}
			sideOffset={sideOffset}
			style={StyleSheet.compose(
				{
					backgroundColor: tokens.colors.text,
					color: tokens.colors.background,
					...typography.md,
					paddingTop: spacing[1.5],
					paddingBottom: spacing[1.5],
					paddingLeft: spacing[2],
					paddingRight: spacing[2],
					borderRadius: radius.md,
					pointerEvents: "none",
					userSelect: "none",
				},
				style
			)}
		/>
	);
}
