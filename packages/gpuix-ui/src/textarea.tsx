import { radius, typography, fontWeight } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import type { TextareaProps as NativeTextareaProps } from "@gpuix/react";
import { useState } from "react";

import { defaultTokens, type UiTokens } from "./tokens";

/** Controlled native multiline editor. Callers own the value and provide an accessible name. */
export interface TextareaProps extends Omit<
	NativeTextareaProps,
	"children" | "value" | "onChange" | "aria-label"
> {
	value: string;
	onValueChange: (value: string) => void;
	"aria-label": string;
	tokens?: UiTokens;
}

const styles = StyleSheet.create({
	field: ({ colors, layout }: UiTokens) => ({
		minWidth: 0,
		flexShrink: 0,
		padding: layout.fieldPadding,
		borderWidth: 1,
		borderRadius: radius.md,
		borderColor: colors.border,
		backgroundColor: colors.field,
		color: colors.text,
		...typography.md,
		fontWeight: fontWeight.regular,
		cursor: "text",
	}),
});

/** Adds token styling and a focus outline; GPUIX owns editing, selection, scrolling and undo. */
export function Textarea({
	value,
	onValueChange,
	tokens = defaultTokens,
	style,
	theme,
	onFocus,
	onBlur,
	minRows = 3,
	maxRows = 6,
	tabIndex = 0,
	...props
}: TextareaProps) {
	const [focused, setFocused] = useState(false);

	return (
		<textarea
			{...props}
			value={value}
			minRows={minRows}
			maxRows={maxRows}
			tabIndex={tabIndex}
			theme={{ caret: tokens.colors.focusRing, ...theme }}
			style={StyleSheet.compose(
				styles.field(tokens),
				style,
				focused &&
					tokens.focusVisible !== false && {
						borderColor: tokens.colors.focusRing,
					}
			)}
			onChange={(event) => {
				if (event.value !== undefined) onValueChange(event.value);
			}}
			onFocus={(event) => {
				setFocused(true);
				onFocus?.(event);
			}}
			onBlur={(event) => {
				setFocused(false);
				onBlur?.(event);
			}}
		/>
	);
}
