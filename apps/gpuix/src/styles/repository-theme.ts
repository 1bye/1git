import type { AppTheme } from "./theme";
import { RepositoryColors } from "../feature/repository-appearance/repository-colors";
import {
	RepositoryPatterns,
	type RepositoryPattern,
	type RepositoryPatternAdjustments,
} from "../feature/repository-appearance/repository-patterns";

/** Derives a restrained repo palette once per choice; semantic Git and syntax colors are untouched. */
export class RepositoryTheme {
	static mix(base: string, tint: string, amount: number): string {
		return `#${[1, 3, 5]
			.map((offset) => {
				const first = Number.parseInt(base.slice(offset, offset + 2), 16);
				const second = Number.parseInt(tint.slice(offset, offset + 2), 16);

				return Math.round(first + (second - first) * amount)
					.toString(16)
					.padStart(2, "0");
			})
			.join("")}`;
	}

	static contrast(first: string, second: string): number {
		const luminance = (color: string): number =>
			[1, 3, 5].reduce((sum, offset, index) => {
				const channel =
					Number.parseInt(color.slice(offset, offset + 2), 16) / 255;

				const linear =
					channel <= 0.04045
						? channel / 12.92
						: ((channel + 0.055) / 1.055) ** 2.4;

				return sum + linear * ([0.2126, 0.7152, 0.0722][index] ?? 0);
			}, 0);

		const a = luminance(first);
		const b = luminance(second);

		return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
	}

	static create(
		base: AppTheme,
		candidate?: string,
		patternChoice?: RepositoryPattern,
		patternSeed?: number,
		patternAdjustments?: RepositoryPatternAdjustments
	): AppTheme {
		const color = RepositoryColors.color(candidate);
		const pattern = RepositoryPatterns.pattern(patternChoice);

		if (!color)
			return pattern
				? {
						...base,
						repositoryPattern: pattern,
						repositoryPatternSeed: patternSeed,
						repositoryPatternAdjustments: patternAdjustments,
					}
				: base;

		const dark = base.appearance === "dark";

		const surface = RepositoryTheme.mix(
			base.colors.editorSurface,
			color,
			0.035
		);

		const accent = RepositoryTheme.mix(surface, color, dark ? 0.18 : 0.12);
		const accentHover = RepositoryTheme.mix(surface, color, dark ? 0.25 : 0.2);

		const accentPressed = RepositoryTheme.mix(
			surface,
			color,
			dark ? 0.13 : 0.26
		);

		const target = dark ? "#ffffff" : "#111111";
		let foreground = RepositoryTheme.mix(color, target, dark ? 0.42 : 0.25);

		// Custom colors must remain legible even at the extremes (white, black or neon).
		for (
			let step = 0;
			step < 20 &&
			[surface, accent, accentHover, accentPressed].some(
				(background) => RepositoryTheme.contrast(foreground, background) < 4.5
			);
			step++
		)
			foreground = RepositoryTheme.mix(foreground, target, 0.18);

		const colors = {
			...base.colors,
			brand: foreground,
			brandForeground: foreground,
			chrome: `${color}${dark ? "24" : "1c"}`,
			editorSurface: surface,
			editorSunken: RepositoryTheme.mix(base.colors.editorSunken, color, 0.045),
			editorSunken2: RepositoryTheme.mix(
				base.colors.editorSunken2,
				color,
				dark ? 0.16 : 0.1
			),
		};

		return {
			...base,
			repositoryColor: color,
			repositoryPattern: pattern,
			repositoryPatternSeed: pattern ? patternSeed : undefined,
			repositoryPatternAdjustments: pattern ? patternAdjustments : undefined,
			colors,
			tokens: {
				...base.tokens,
				colors: {
					...base.tokens.colors,
					background: surface,
					accent,
					accentHover,
					accentPressed,
					accentBorder: RepositoryTheme.mix(surface, color, 0.5),
					onAccent: foreground,
					focusRing: foreground,
					surface: RepositoryTheme.mix(surface, color, 0.07),
					surfaceHover: RepositoryTheme.mix(surface, color, 0.13),
					surfacePressed: RepositoryTheme.mix(surface, color, 0.19),
					selected: colors.editorSunken2,
					highlighted: colors.editorSunken,
					overlay: surface,
				},
			},
		};
	}
}
