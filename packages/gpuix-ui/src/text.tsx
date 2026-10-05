import { typography, fontWeight, type TextSize } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import type { Props } from "@gpuix/react";
import { Children } from "react";

import { defaultTokens, type UiTokens } from "./tokens";

type TextChild = string | number | boolean | null | undefined;

/** Native text with explicit typography and color defaults. */
export interface TextProps extends Omit<Props, "children"> {
	children?: TextChild | readonly TextChild[];
	size?: TextSize;
	tone?: "default" | "muted" | "danger";
	weight?: keyof typeof fontWeight;
	tokens?: UiTokens;
}

const styles = StyleSheet.create({
	default: ({ colors }: UiTokens) => ({ color: colors.text }),
	muted: ({ colors }: UiTokens) => ({ color: colors.textMuted }),
	danger: ({ colors }: UiTokens) => ({ color: colors.danger }),
});

/** Renders GPUIX text while allowing the caller's style to take precedence. */
export function Text({
	size = "md",
	tone = "default",
	weight = "regular",
	tokens = defaultTokens,
	style,
	children,
	...props
}: TextProps) {
	return (
		<text
			{...props}
			style={StyleSheet.compose(
				typography[size],
				styles[tone](tokens),
				{ fontWeight: fontWeight[weight] },
				style
			)}
		>
			{Children.toArray(children).join("")}
		</text>
	);
}
