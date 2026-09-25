import { describe, expect, it } from "bun:test";
import { StyleSheet } from "../src";

StyleSheet.create({
  // @ts-expect-error Style entries must use GPUix properties.
  invalid: { notAStyleProperty: true },
  // @ts-expect-error Style functions must return GPUix properties.
  invalidFunction: () => ({ notAStyleProperty: true }),
});

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

  it("composes conditional styles with last-value precedence", () => {
    const base = {
      backgroundColor: "#111111",
      hover: { backgroundColor: "#222222", opacity: 0.9 },
      padding: 8,
    } as const;

    const selected = {
      backgroundColor: "#333333",
      hover: { backgroundColor: "#444444" },
    } as const;

    expect(StyleSheet.compose(base, false, null, undefined, selected)).toEqual({
      backgroundColor: "#333333",
      hover: { backgroundColor: "#444444", opacity: 0.9 },
      padding: 8,
    });
  });

  it("returns the original style when there is nothing to compose", () => {
    const style = { width: 12 } as const;

    expect(StyleSheet.compose(false, style)).toBe(style);
  });
});
