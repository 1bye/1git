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

/** Controlled or uncontrolled selection backed by GPUIX's native interaction primitives. */
export type SelectProps = ComponentProps<typeof PrimitiveRoot>;
/** Trigger props retain GPUIX state-dependent styles and host refs. */
export type SelectTriggerProps = ComponentProps<typeof PrimitiveTrigger>;
/** Selected-value display; use the root's `items` to map values to custom labels. */
export type SelectValueProps = ComponentProps<typeof PrimitiveValue>;
/** Popup positioning and native host props. */
export type SelectContentProps = ComponentProps<typeof PrimitiveContent>;
/** Option props retain selected, highlighted, and disabled state callbacks. */
export type SelectItemProps = ComponentProps<typeof PrimitiveItem>;

const styles = StyleSheet.create({
	trigger: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 8,
		minWidth: 160,
		height: 34,
		paddingLeft: 10,
		paddingRight: 10,
		borderWidth: 1,
		borderColor: "#3f3f46",
		borderRadius: 6,
		backgroundColor: "#242427",
		cursor: "pointer",
		userSelect: "none",
		hover: { backgroundColor: "#2c2c30" },
	},
	focused: { borderColor: "#c4b5fd" },
	open: { borderColor: "#818cf8" },
	disabled: {
		opacity: 0.45,
		cursor: "not-allowed",
		hover: { backgroundColor: "#242427" },
	},
	value: { color: "#ededf0", fontSize: 14 },
	content: {
		display: "flex",
		flexDirection: "column",
		minWidth: 160,
		maxHeight: 260,
		overflowY: "scroll",
		padding: 4,
		gap: 2,
		borderRadius: 8,
		borderWidth: 1,
		borderColor: "#3f3f46",
		backgroundColor: "#202023",
		boxShadow: {
			offsetX: 0,
			offsetY: 8,
			blurRadius: 20,
			spreadRadius: 0,
			color: "#00000055",
		},
	},
	item: {
		display: "flex",
		alignItems: "center",
		minHeight: 30,
		paddingLeft: 8,
		paddingRight: 8,
		borderRadius: 4,
		color: "#ededf0",
		fontSize: 14,
		cursor: "pointer",
		userSelect: "none",
	},
	selected: { backgroundColor: "#30304a" },
	highlighted: { backgroundColor: "#3b3b48" },
	disabledItem: { opacity: 0.45, cursor: "not-allowed" },
});

/** Owns selection and open state; delegates keyboard navigation and focus restoration to GPUIX. */
export const Select = PrimitiveRoot;

/** A styled trigger with a visible focus outline and optional state-dependent overrides. */
export function SelectTrigger({
	style,
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
					styles.trigger,
					state.open && styles.open,
					typeof style === "function" ? style(state) : style,
					!state.disabled && focused && styles.focused,
					state.disabled && styles.disabled
				)
			}
		/>
	);
}

/** Displays the current label or placeholder with explicit GPUIX text styling. */
export function SelectValue({ style, ...props }: SelectValueProps) {
	return (
		<PrimitiveValue
			{...props}
			style={StyleSheet.compose(styles.value, style)}
		/>
	);
}

/** Positions the options popup using GPUIX's floating layer. */
export function SelectContent({
	style,
	sideOffset = 6,
	...props
}: SelectContentProps) {
	return (
		<PrimitiveContent
			role="listbox"
			{...props}
			sideOffset={sideOffset}
			style={StyleSheet.compose(styles.content, style)}
		/>
	);
}

/** A styled option with native selection, highlighting, and disabled behavior. */
export function SelectItem({ style, ...props }: SelectItemProps) {
	return (
		<PrimitiveItem
			role="option"
			{...props}
			style={(state) =>
				StyleSheet.compose(
					styles.item,
					state.selected && styles.selected,
					state.highlighted && styles.highlighted,
					typeof style === "function" ? style(state) : style,
					state.disabled && styles.disabledItem
				)
			}
		/>
	);
}
