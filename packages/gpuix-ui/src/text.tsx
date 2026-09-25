import { StyleSheet } from "@1git/gpuix-stylesheet";
import type { Props } from "@gpuix/react";
import { Children } from "react";

type TextChild = string | number | boolean | null | undefined;

/** Native text with explicit typography and color defaults. */
export interface TextProps extends Omit<Props, "children"> {
	children?: TextChild | readonly TextChild[];
	size?: "sm" | "md" | "lg";
	tone?: "default" | "muted" | "danger";
	weight?: "regular" | "medium" | "semibold";
}

const styles = StyleSheet.create({
	sm: { fontSize: 12 },
	md: { fontSize: 14 },
	lg: { fontSize: 20 },
	default: { color: "#ededf0" },
	muted: { color: "#a1a1aa" },
	danger: { color: "#f87171" },
	regular: { fontWeight: 400 },
	medium: { fontWeight: 500 },
	semibold: { fontWeight: 600 },
});

/** Renders GPUIX text while allowing the caller's style to take precedence. */
export function Text({
	size = "md",
	tone = "default",
	weight = "regular",
	style,
	children,
	...props
}: TextProps) {
	return (
		<text
			{...props}
			style={StyleSheet.compose(
				styles[size],
				styles[tone],
				styles[weight],
				style
			)}
		>
			{Children.toArray(children).join("")}
		</text>
	);
}
