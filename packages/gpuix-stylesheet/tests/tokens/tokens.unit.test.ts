/**
 * Covers: named token presets, nested shape checking, and independent style resolution.
 * Real: Tokens, StyleSheet, and TypeScript preset inference.
 * Doubles: none.
 * Requires: none.
 */
import { expect, expectTypeOf, it } from "bun:test";

import { StyleSheet, Tokens, type TokenSet } from "../../src";

it("preserves preset objects and literal names without selecting a preset", () => {
	const definitions = {
		dark: { text: "#ffffff", metrics: { padding: 8 }, rounded: true },
		light: { text: "#111111", metrics: { padding: 12 }, rounded: false },
	} as const;

	const presets = Tokens.create(definitions);

	expect(presets).toBe(definitions);
	expect(presets.dark).toBe(definitions.dark);
	expectTypeOf<keyof typeof presets>().toEqualTypeOf<"dark" | "light">();
	expectTypeOf(presets.dark.text).toEqualTypeOf<"#ffffff">();
	expectTypeOf<TokenSet<typeof presets>>().toEqualTypeOf<{
		readonly text: string;
		readonly metrics: { readonly padding: number };
		readonly rounded: boolean;
	}>();
});

it("rejects inconsistent token keys and value kinds at compile time", () => {
	// @ts-expect-error Each preset must provide the same keys.
	Tokens.create({ dark: { text: "#ffffff" }, light: {} });
	// @ts-expect-error Extra keys are inconsistent regardless of preset order.
	Tokens.create({ light: {}, dark: { text: "#ffffff" } });
	// @ts-expect-error Token kinds must agree; numeric strings are not numbers.
	Tokens.create({ compact: { padding: 8 }, comfortable: { padding: "12" } });
	// @ts-expect-error Nested groups must have the same keys.
	Tokens.create({ a: { sizes: { sm: 12 } }, b: { sizes: { sm: 14, md: 16 } } });
	// @ts-expect-error Nested value kinds must also agree.
	Tokens.create({ a: { sizes: { sm: 12 } }, b: { sizes: { sm: "14" } } });
	// @ts-expect-error A group cannot become a scalar in another preset.
	Tokens.create({ a: { sizes: { sm: 12 } }, b: { sizes: 14 } });
	// @ts-expect-error Functions are not token values.
	Tokens.create({ default: { padding: () => 8 } });
	// @ts-expect-error Arrays are not named token groups.
	Tokens.create({ default: { padding: [8, 12] } });
	// @ts-expect-error Null is not a token value.
	Tokens.create({ default: { padding: null } });
});

it("resolves palette and density independently without changing earlier styles", () => {
	const palettes = Tokens.create({
		dark: { background: "#111111", text: "#ffffff" },
		light: { background: "#ffffff", text: "#111111" },
	});

	const densities = Tokens.create({
		compact: { padding: 8 },
		comfortable: { padding: 12 },
	});

	type UiTokens = {
		colors: TokenSet<typeof palettes>;
		layout: TokenSet<typeof densities>;
	};
	const styles = StyleSheet.create({
		root: ({ colors, layout }: UiTokens) => ({
			backgroundColor: colors.background,
			color: colors.text,
			padding: layout.padding,
		}),
	});

	const initial = styles.root({
		colors: palettes.dark,
		layout: densities.compact,
	});

	const recolored = styles.root({
		colors: palettes.light,
		layout: densities.compact,
	});

	const resized = styles.root({
		colors: palettes.light,
		layout: densities.comfortable,
	});

	const customized = styles.root({
		colors: { ...palettes.light, text: "#123456" },
		layout: { padding: 10 },
	});

	expect(initial).toEqual({
		backgroundColor: "#111111",
		color: "#ffffff",
		padding: 8,
	});
	expect(recolored).toEqual({
		backgroundColor: "#ffffff",
		color: "#111111",
		padding: 8,
	});
	expect(resized).toEqual({
		backgroundColor: "#ffffff",
		color: "#111111",
		padding: 12,
	});
	expect(customized.color).toBe("#123456");
	expect(customized.padding).toBe(10);
	expect(palettes.dark.text).toBe("#ffffff");
	expect(densities.compact.padding).toBe(8);
});
