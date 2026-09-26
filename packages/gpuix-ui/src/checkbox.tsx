import { StyleSheet } from "@1git/gpuix-stylesheet";
import type { Props, StyleDesc } from "@gpuix/react";
import { useEffect, useRef, useState } from "react";

import { defaultTokens, type UiTokens } from "./tokens";

/** Controlled inclusion state; indeterminate activates to checked. */
export type CheckboxState = boolean | "indeterminate";

/** A standalone checkbox. Supply an accessible name; compose any visible label beside it. */
export interface CheckboxProps extends Pick<
  Props,
  | "ref"
  | "testId"
  | "tabIndex"
  | "autoFocus"
  | "onFocus"
  | "onBlur"
  | "onMouseDown"
  | "onMouseEnter"
  | "onMouseLeave"
  | "onKeyDown"
  | "aria-id"
  | "aria-description"
> {
  "aria-label": string;
  checked: CheckboxState;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  style?: StyleDesc;
  tokens?: UiTokens;
}

const styles = StyleSheet.create({
  root: ({ layout }: UiTokens) => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: layout.smallControlHeight,
    height: layout.smallControlHeight,
    flexShrink: 0,
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 5,
    cursor: "pointer",
  }),
  box: ({ colors }: UiTokens, checked: CheckboxState) => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 12,
    height: 12,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: checked ? colors.accentBorder : colors.border,
    backgroundColor: checked ? colors.accent : colors.field,
    pointerEvents: "none",
  }),
});

/** Token-styled checkbox with mouse/Space activation, mixed state, and keyboard-only focus. */
export function Checkbox({
  checked,
  onCheckedChange,
  disabled = false,
  tokens = defaultTokens,
  style,
  tabIndex = 0,
  autoFocus,
  onFocus,
  onBlur,
  onMouseDown,
  onKeyDown,
  ...props
}: CheckboxProps) {
  const [focused, setFocused] = useState(false);
  const [pointerFocus, setPointerFocus] = useState(false);
  const [pressed, setPressed] = useState(false);
  const armed = useRef(false);

  useEffect(() => {
    if (disabled) {
      armed.current = false;
      setPressed(false);
    }
  }, [disabled]);

  const rootStyle = StyleSheet.compose(
    styles.root(tokens),
    {
      hover: { backgroundColor: tokens.colors.surfaceHover },
      active: { backgroundColor: tokens.colors.surfacePressed },
    },
    style,
    focused &&
    !pointerFocus &&
    !disabled && { borderColor: tokens.colors.focusRing },
    pressed && !disabled && { backgroundColor: tokens.colors.surfacePressed },
    disabled && { opacity: 0.45, cursor: "not-allowed" }
  );

  const { hover: _hover, active: _active, ...disabledStyle } = rootStyle;

  const stateLabel =
    checked === "indeterminate"
      ? "Partially checked"
      : checked
        ? "Checked"
        : "Unchecked";

  return (
    <div
      {...props}
      role="checkbox"
      aria-checked={checked === "indeterminate" ? "mixed" : checked}
      // Value text also conveys state on unpatched GPUIX 0.10.0.
      aria-valuetext={disabled ? `${stateLabel}, unavailable` : stateLabel}
      tabIndex={disabled ? undefined : tabIndex}
      autoFocus={!disabled && autoFocus}
      style={disabled ? disabledStyle : rootStyle}
      onMouseDown={(event) => {
        setPointerFocus(true);
        onMouseDown?.(event);
      }}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        armed.current = false;
        setPressed(false);
        setFocused(false);
        setPointerFocus(false);
        onBlur?.(event);
      }}
      onClick={() => {
        if (!disabled) onCheckedChange(checked !== true);
      }}
      onKeyDown={(event) => {
        setPointerFocus(false);
        onKeyDown?.(event);

        if (
          disabled ||
          event.isHeld ||
          event.modifiers?.cmd ||
          event.modifiers?.ctrl ||
          event.modifiers?.alt ||
          event.modifiers?.shift
        )
          return;

        if (event.key === "space") {
          armed.current = true;
          setPressed(true);
        }
      }}
      onKeyUp={(event) => {
        if (event.key !== "space") return;

        const activate = armed.current;

        armed.current = false;
        setPressed(false);

        if (!disabled && activate) onCheckedChange(checked !== true);
      }}
    >
      <div style={styles.box(tokens, checked)}>
        {checked ? (
          <svg
            source={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="${checked === "indeterminate" ? "M4 8h8" : "M3 8l3 3 7-7"}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`}
            style={{
              width: 10,
              height: 10,
              color: tokens.colors.onAccent,
              pointerEvents: "none",
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
