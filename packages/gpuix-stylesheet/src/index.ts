import type { StyleDesc } from "@gpuix/react";

type StyleFactory = (...parameters: never[]) => StyleDesc;
type NamedStyles = Record<string, StyleDesc | StyleFactory>;

type TokenGroup = {
	readonly [name: string]: string | number | boolean | TokenGroup;
};
type TokenPresets = Record<string, TokenGroup>;
type TokenShape<Value> = Value extends string
	? string
	: Value extends number
		? number
		: Value extends boolean
			? boolean
			: { readonly [Key in keyof Value]: TokenShape<Value[Key]> };
// The non-distributive union check requires every preset's shape to fit every other preset.
type MatchingPresets<Presets extends TokenPresets> = {
	[Name in keyof Presets]: [TokenShape<Presets[keyof Presets]>] extends [
		TokenShape<Presets[Name]>,
	]
		? unknown
		: never;
};

/** The shared token shape of a preset collection, with literal values widened for customization. */
export type TokenSet<Presets extends TokenPresets> = TokenShape<
	Presets[keyof Presets]
>;

/** Defines named token presets without selecting, registering, or mutating them. */
export class Tokens {
	private constructor() {}

	/** Returns the definitions unchanged; TypeScript checks matching nested keys and value kinds. */
	static create<const Presets extends TokenPresets>(
		presets: Presets & MatchingPresets<NoInfer<Presets>>
	): Presets {
		return presets;
	}
}

/** A GPUIX style or conditional empty value accepted by `StyleSheet.compose`. */
export type StyleInput = StyleDesc | false | null | undefined;

/** Defines and composes typed GPUIX styles without retaining runtime state. */
export class StyleSheet {
	private constructor() {}

	/** Returns named style definitions unchanged while validating their types. */
	static create<const Styles extends NamedStyles>(styles: Styles): Styles {
		return styles;
	}

	/**
	 * Combines conditional styles with last-value precedence.
	 * Native `hover` and `active` states merge one property level deep.
	 */
	static compose(...styles: readonly StyleInput[]): StyleDesc {
		let composed: StyleDesc | undefined;
		let ownsComposedStyle = false;

		for (const style of styles) {
			if (!style) {
				continue;
			}
			if (!composed) {
				composed = style;
				continue;
			}
			if (!ownsComposedStyle) {
				composed = Object.assign({}, composed);
				ownsComposedStyle = true;
			}

			const active = StyleSheet.mergeInteractionStyles(
				composed.active,
				style.active
			);
			const hover = StyleSheet.mergeInteractionStyles(
				composed.hover,
				style.hover
			);

			Object.assign(composed, style);

			if (active) {
				composed.active = active;
			} else {
				delete composed.active;
			}
			if (hover) {
				composed.hover = hover;
			} else {
				delete composed.hover;
			}
		}

		return composed ?? {};
	}

	private static mergeInteractionStyles(
		base: StyleDesc["hover"],
		override: StyleDesc["hover"]
	): StyleDesc["hover"] {
		if (!base) {
			return override;
		}

		if (!override) {
			return base;
		}

		return Object.assign({}, base, override);
	}
}
