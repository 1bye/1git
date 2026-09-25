import { StyleSheet } from "@1git/gpuix-stylesheet";
import {
	Root as PrimitiveRoot,
	Trigger as PrimitiveTrigger,
	Value as PrimitiveValue,
	Content as PrimitiveContent,
	Item as PrimitiveItem,
} from "@gpuix/react/select";
import type { ComponentProps } from "react";
import { useState } from "react";

import { defaultTokens, type UiTokens } from "./tokens";

/** Controlled or uncontrolled selection backed by GPUIX's native interaction primitives. */
export type SelectProps = ComponentProps<typeof PrimitiveRoot>;
/** Trigger props retain GPUIX state-dependent styles and host refs. */
export type SelectTriggerProps = ComponentProps<typeof PrimitiveTrigger> & {
	tokens?: UiTokens;
};
/** Selected-value display; use the root's `items` to map values to custom labels. */
export type SelectValueProps = ComponentProps<typeof PrimitiveValue> & {
	tokens?: UiTokens;
};
/** Popup positioning and native host props. */
export type SelectContentProps = ComponentProps<typeof PrimitiveContent> & {
	tokens?: UiTokens;
};
/** Option props retain selected, highlighted, and disabled state callbacks. */
export type SelectItemProps = ComponentProps<typeof PrimitiveItem> & {
	tokens?: UiTokens;
};

const styles = StyleSheet.create({
	trigger: ({ colors, layout }: UiTokens) => ({
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: layout.gap,
		minWidth: 160,
		height: layout.controlHeight,
		paddingLeft: layout.fieldPadding,
		paddingRight: layout.fieldPadding,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: 6,
		backgroundColor: colors.field,
		cursor: "pointer",
		userSelect: "none",
		hover: { backgroundColor: colors.fieldHover },
	}),
	focused: ({ colors }: UiTokens) => ({ borderColor: colors.focusRing }),
	open: ({ colors }: UiTokens) => ({ borderColor: colors.accentBorder }),
	disabled: ({ colors }: UiTokens) => ({
		opacity: 0.45,
		cursor: "not-allowed",
		hover: { backgroundColor: colors.field },
	}),
	value: ({ colors }: UiTokens) => ({ color: colors.text, fontSize: 14 }),
	content: ({ colors, layout }: UiTokens) => ({
		display: "flex",
		flexDirection: "column",
		minWidth: 160,
		maxHeight: 260,
		overflowY: "scroll",
		padding: layout.menuPadding,
		gap: layout.menuGap,
		borderRadius: 8,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.overlay,
		boxShadow: {
			offsetX: 0,
			offsetY: 8,
			blurRadius: 20,
			spreadRadius: 0,
			color: colors.shadow,
		},
	}),
	item: ({ colors, layout }: UiTokens) => ({
		display: "flex",
		alignItems: "center",
		minHeight: layout.itemHeight,
		paddingLeft: layout.itemPadding,
		paddingRight: layout.itemPadding,
		borderRadius: 4,
		color: colors.text,
		fontSize: 14,
		cursor: "pointer",
		userSelect: "none",
	}),
	selected: ({ colors }: UiTokens) => ({ backgroundColor: colors.selected }),
	highlighted: ({ colors }: UiTokens) => ({
		backgroundColor: colors.highlighted,
	}),
	disabledItem: { opacity: 0.45, cursor: "not-allowed" },
});

/** Owns selection and open state; delegates keyboard navigation and focus restoration to GPUIX. */
export const Select = PrimitiveRoot;

/** A styled trigger with a visible focus outline and optional state-dependent overrides. */
export function SelectTrigger({
	style,
	tokens = defaultTokens,
	onFocus,
	onBlur,
	...props
}: SelectTriggerProps) {
	const [focused, setFocused] = useState(false);

	return (
		<PrimitiveTrigger
			role="combobox"
			{...props}
			onFocus={(event) => {
				setFocused(true);
				onFocus?.(event);
			}}
			onBlur={(event) => {
				setFocused(false);
				onBlur?.(event);
			}}
			style={(state) =>
				StyleSheet.compose(
					styles.trigger(tokens),
					state.open && styles.open(tokens),
					typeof style === "function" ? style(state) : style,
					!state.disabled && focused && styles.focused(tokens),
					state.disabled && styles.disabled(tokens)
				)
			}
		/>
	);
}

/** Displays the current label or placeholder with explicit GPUIX text styling. */
export function SelectValue({
	style,
	tokens = defaultTokens,
	...props
}: SelectValueProps) {
	return (
		<PrimitiveValue
			{...props}
			style={StyleSheet.compose(styles.value(tokens), style)}
		/>
	);
}

/** Positions the options popup using GPUIX's floating layer. */
export function SelectContent({
	style,
	tokens = defaultTokens,
	sideOffset = 6,
	...props
}: SelectContentProps) {
	return (
		<PrimitiveContent
			role="listbox"
			{...props}
			sideOffset={sideOffset}
			style={StyleSheet.compose(styles.content(tokens), style)}
		/>
	);
}

/** A styled option with native selection, highlighting, and disabled behavior. */
export function SelectItem({
	style,
	tokens = defaultTokens,
	...props
}: SelectItemProps) {
	return (
		<PrimitiveItem
			role="option"
			{...props}
			style={(state) =>
				StyleSheet.compose(
					styles.item(tokens),
					state.selected && styles.selected(tokens),
					state.highlighted && styles.highlighted(tokens),
					typeof style === "function" ? style(state) : style,
					state.disabled && styles.disabledItem
				)
			}
		/>
	);
}
