import { radius } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import type { EventPayload, Props, StyleDesc } from "@gpuix/react";
import { Children, useEffect, useRef, useState } from "react";

import { Text } from "./text";
import { defaultTokens, type UiTokens } from "./tokens";

/** An action control with mouse, Enter, and Space activation. Custom content needs an accessible name. */
export interface ButtonProps extends Pick<
	Props,
	| "children"
	| "ref"
	| "testId"
	| "tabIndex"
	| "autoFocus"
	| "onMouseDown"
	| "onMouseEnter"
	| "onMouseLeave"
	| "onKeyDown"
	| "onFocus"
	| "onBlur"
	| "aria-label"
	| "aria-expanded"
	| "aria-description"
	| "aria-id"
> {
	variant?: "primary" | "secondary" | "ghost";
	size?: "sm" | "md";
	disabled?: boolean;
	/** Gate the ring by input modality without removing keyboard focus or activation. */
	focusVisible?: boolean;
	onPress?: () => void;
	/** Secondary click, macOS Control-click, or Shift-F10; never activates the primary action. */
	onContextMenu?: (event: EventPayload) => void;
	style?: StyleDesc;
	textStyle?: StyleDesc;
	tokens?: UiTokens;
}

const styles = StyleSheet.create({
	root: ({ layout }: UiTokens) => ({
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		gap: layout.gap,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: "transparent",
		flexShrink: 0,
		cursor: "pointer",
		userSelect: "none",
	}),
	primary: ({ colors }: UiTokens) => ({
		backgroundColor: colors.accent,
		hover: { backgroundColor: colors.accentHover },
		active: { backgroundColor: colors.accentPressed },
	}),
	secondary: ({ colors }: UiTokens) => ({
		backgroundColor: colors.surface,
		hover: { backgroundColor: colors.surfaceHover },
		active: { backgroundColor: colors.surfacePressed },
	}),
	ghost: ({ colors }: UiTokens) => ({
		backgroundColor: "transparent",
		hover: { backgroundColor: colors.surface },
		active: { backgroundColor: colors.surfacePressed },
	}),
	sm: ({ layout }: UiTokens) => ({
		height: layout.smallControlHeight,
		paddingLeft: layout.smallControlPadding,
		paddingRight: layout.smallControlPadding,
	}),
	md: ({ layout }: UiTokens) => ({
		height: layout.controlHeight,
		paddingLeft: layout.controlPadding,
		paddingRight: layout.controlPadding,
	}),
	focused: ({ colors }: UiTokens) => ({ borderColor: colors.focusRing }),
	disabled: { opacity: 0.45, cursor: "not-allowed" },
	label: (
		{ colors }: UiTokens,
		variant: NonNullable<ButtonProps["variant"]>
	) => ({
		color: variant === "primary" ? colors.onAccent : colors.textControl,
	}),
});

/** Owns activation and focus behavior; plain text children receive the built-in label styles. */
export function Button({
	variant = "primary",
	size = "md",
	disabled = false,
	focusVisible = true,
	onPress,
	onContextMenu,
	onKeyDown,
	onFocus,
	onBlur,
	style,
	textStyle,
	tokens = defaultTokens,
	children,
	tabIndex = 0,
	autoFocus,
	"aria-label": ariaLabel,
	...props
}: ButtonProps) {
	const [focused, setFocused] = useState(false);
	const [spacePressed, setSpacePressed] = useState(false);
	// Native key down/up can share a React batch; activation must update synchronously.
	const spaceArmed = useRef(false);

	useEffect(() => {
		if (disabled) {
			spaceArmed.current = false;
			setSpacePressed(false);
		}
	}, [disabled]);

	const appearance = styles[variant](tokens);

	const rootStyle = StyleSheet.compose(
		styles.root(tokens),
		appearance,
		styles[size](tokens),
		style,
		!disabled &&
			focused &&
			focusVisible &&
			tokens.focusVisible !== false &&
			styles.focused(tokens),
		!disabled && spacePressed && appearance.active,
		disabled && styles.disabled
	);

	const labelStyle = StyleSheet.compose(
		styles.label(tokens, variant),
		textStyle
	);

	// Removing these states keeps a disabled button from responding visually to the pointer.
	const { hover: _hover, active: _active, ...restStyle } = rootStyle;
	const childNodes = Children.toArray(children);

	const isTextOnly = childNodes.every(
		(child) => typeof child === "string" || typeof child === "number"
	);

	const label = childNodes
		.filter((child) => typeof child === "string" || typeof child === "number")
		.join("");

	return (
		<div
			{...props}
			role="button"
			aria-label={ariaLabel ?? (label || undefined)}
			tabIndex={disabled ? undefined : tabIndex}
			autoFocus={!disabled && autoFocus}
			style={disabled ? restStyle : rootStyle}
			onFocus={(event) => {
				setFocused(true);
				onFocus?.(event);
			}}
			onBlur={(event) => {
				spaceArmed.current = false;
				setFocused(false);
				setSpacePressed(false);
				onBlur?.(event);
			}}
			onClick={(event) => {
				if (event.modifiers?.ctrl && onContextMenu) {
					onContextMenu(event);

					return;
				}

				if (!disabled) onPress?.();
			}}
			onAuxClick={(event) => {
				if (event.button === 2 || event.isRightClick) onContextMenu?.(event);
			}}
			onKeyDown={(event) => {
				if (event.key === "f10" && event.modifiers?.shift && onContextMenu) {
					onContextMenu(event);

					return;
				}

				onKeyDown?.(event);

				if (disabled || event.isHeld) return;

				if (event.key === "enter") onPress?.();

				if (event.key === "space") {
					spaceArmed.current = true;
					setSpacePressed(true);
				}
			}}
			onKeyUp={(event) => {
				if (event.key !== "space") return;

				const shouldPress = spaceArmed.current;

				spaceArmed.current = false;
				setSpacePressed(false);

				if (!disabled && shouldPress) onPress?.();
			}}
		>
			{isTextOnly ? (
				<Text
					tokens={tokens}
					size={size === "sm" ? "sm" : "md"}
					weight="medium"
					style={labelStyle}
				>
					{label}
				</Text>
			) : (
				Children.map(children, (child) =>
					typeof child === "string" || typeof child === "number" ? (
						<Text
							tokens={tokens}
							size={size === "sm" ? "sm" : "md"}
							weight="medium"
							style={labelStyle}
						>
							{child}
						</Text>
					) : (
						child
					)
				)
			)}
		</div>
	);
}
