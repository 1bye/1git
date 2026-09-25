/**
 * Covers: typed style definitions, conditional composition, interaction states,
 * and caller-owned input preservation.
 * Real: StyleSheet implementation and GPUIX StyleDesc types.
 * Doubles: none.
 * Requires: none.
 */
import { describe, expect, it } from "bun:test";

import { StyleSheet } from "../../src";

describe("StyleSheet", () => {
  it("preserves static styles and style functions", () => {
    const definitions = {
      root: { display: "flex" },
      size: (value: number) => ({ height: value, width: value }),
    } as const;

    const styles = StyleSheet.create(definitions);

    expect(styles).toBe(definitions);
    expect(styles.size(24)).toEqual({ height: 24, width: 24 });
  });

  it("constrains definitions to GPUIX styles at compile time", () => {
    StyleSheet.create({
      // @ts-expect-error Style entries must use GPUIX properties.
      invalid: { notAStyleProperty: true },
      // @ts-expect-error Style functions must return GPUIX properties.
      invalidFunction: () => ({ notAStyleProperty: true }),
    });
  });

  it("composes styles without mutating caller-owned inputs", () => {
    const base = {
      active: { opacity: 0.8 },
      backgroundColor: "#111111",
      hover: { backgroundColor: "#222222", opacity: 0.9 },
      padding: 8,
    } as const;
    const selected = {
      active: { backgroundColor: "#555555" },
      backgroundColor: "#333333",
      hover: { backgroundColor: "#444444" },
    } as const;

    const composed = StyleSheet.compose(base, false, null, undefined, selected);

    expect(composed).toEqual({
      active: { backgroundColor: "#555555", opacity: 0.8 },
      backgroundColor: "#333333",
      hover: { backgroundColor: "#444444", opacity: 0.9 },
      padding: 8,
    });
    expect(base).toEqual({
      active: { opacity: 0.8 },
      backgroundColor: "#111111",
      hover: { backgroundColor: "#222222", opacity: 0.9 },
      padding: 8,
    });
    expect(selected).toEqual({
      active: { backgroundColor: "#555555" },
      backgroundColor: "#333333",
      hover: { backgroundColor: "#444444" },
    });
  });

  it("preserves a lone style reference and handles an empty composition", () => {
    const style = { width: 12 } as const;

    expect(StyleSheet.compose(false, style)).toBe(style);
    expect(StyleSheet.compose(false, null, undefined)).toEqual({});
  });
});
