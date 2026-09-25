import type { StyleDesc } from "@gpuix/react";

type StyleFactory = (...parameters: never[]) => StyleDesc;
type NamedStyles = Record<string, StyleDesc | StyleFactory>;

export type StyleInput = StyleDesc | false | null | undefined;

const create = <const Styles extends NamedStyles>(styles: Styles): Styles =>
	styles;

const mergeInteractionStyles = (
	base: StyleDesc["hover"],
	override: StyleDesc["hover"]
): StyleDesc["hover"] => {
	if (!base) {
		return override;
	}

	if (!override) {
		return base;
	}

	return { ...base, ...override };
};

const compose = (...styles: readonly StyleInput[]): StyleDesc => {
	let composed: StyleDesc | undefined;

	for (const style of styles) {
		if (!style) {
			continue;
		}
		if (!composed) {
			composed = style;
			continue;
		}

		const active = mergeInteractionStyles(composed.active, style.active);
		const hover = mergeInteractionStyles(composed.hover, style.hover);
		composed = {
			...composed,
			...style,
		};
		if (active) {
			composed.active = active;
		}
		if (hover) {
			composed.hover = hover;
		}
	}

	return composed ?? {};
};

export const StyleSheet = {
	compose,
	create,
} as const;
