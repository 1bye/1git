import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AppTheme } from "./theme";

const themeTransitionDurationMs = 200;
const themeFrameIntervalMs = 16;

/** Blends the app's CSS color tokens, including transparent native window tints. */
export class ThemeTransition {
	static color(from: string, to: string, progress: number): string {
		if (progress <= 0 || from === to) return from;

		if (progress >= 1) return to;

		const first = Bun.color(from, "{rgba}");
		const last = Bun.color(to, "{rgba}");

		if (!first || !last) return to;

		const alpha = first.a + (last.a - first.a) * progress;

		// Premultiplied alpha prevents a dark flash when a repo tint fades to clear.
		const channel = (key: "r" | "g" | "b"): number =>
			alpha === 0
				? 0
				: Math.round(
						(first[key] * first.a * (1 - progress) +
							last[key] * last.a * progress) /
							alpha
					);

		return `rgba(${channel("r")}, ${channel("g")}, ${channel("b")}, ${alpha})`;
	}

	static palette<Key extends string>(
		from: Readonly<Record<Key, string>>,
		to: Readonly<Record<Key, string>>,
		progress: number
	): Record<Key, string> {
		const colors: Record<Key, string> = { ...to };

		for (const key in to)
			colors[key] = ThemeTransition.color(from[key], to[key], progress);

		return colors;
	}
}

/** Animates only a shell's palette; interrupted switches continue from the visible colors. */
export function useThemeTransition<Theme extends AppTheme>(
	target: Theme,
	enabled: boolean
): Theme {
	const [palette, setPalette] = useState<AppTheme>(target);
	const current = useRef(palette);

	useLayoutEffect(() => {
		const from = current.current;

		if (
			!enabled ||
			(from.colors === target.colors && from.tokens === target.tokens)
		) {
			current.current = target;
			setPalette(target);

			return;
		}

		const started = performance.now();

		const timer = setInterval(() => {
			const progress = Math.min(
				1,
				(performance.now() - started) / themeTransitionDurationMs
			);

			const eased = 1 - (1 - progress) ** 3;

			const next =
				progress === 1
					? target
					: {
							...target,
							colors: ThemeTransition.palette(
								from.colors,
								target.colors,
								eased
							),
							tokens: {
								...target.tokens,
								colors: ThemeTransition.palette(
									from.tokens.colors,
									target.tokens.colors,
									eased
								),
							},
						};

			current.current = next;
			setPalette(next);

			if (progress === 1) clearInterval(timer);
		}, themeFrameIntervalMs);

		return () => clearInterval(timer);
	}, [target, enabled]);

	return useMemo(
		() =>
			enabled
				? { ...target, colors: palette.colors, tokens: palette.tokens }
				: target,
		[target, palette, enabled]
	);
}
