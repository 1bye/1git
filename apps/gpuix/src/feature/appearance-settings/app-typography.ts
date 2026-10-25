/** Persistent interface text size and installed font family names; empty names use native defaults. */
export interface AppTypography {
	readonly fontSize: number;
	readonly fontFamily: string;
	readonly codeFontFamily: string;
}

/** Point-size range supported by native text scaling. */
export const textSizeRange = { min: 10, max: 18 } as const;

export const defaultTypography: AppTypography = {
	fontSize: 12,
	fontFamily: "",
	codeFontFamily: "Menlo",
};
const invalidFontCharacters = /\p{Cc}/u;

/** Validates session values and user-entered font names before they reach native text shaping. */
export class TypographyPreferences {
	static parse(value: unknown): AppTypography {
		if (typeof value !== "object" || value === null) return defaultTypography;

		const font = (candidate: unknown, fallback: string): string =>
			typeof candidate === "string" &&
			candidate.trim().length <= 128 &&
			!invalidFontCharacters.test(candidate)
				? candidate.trim()
				: fallback;

		const fontSize =
			"fontSize" in value &&
			typeof value.fontSize === "number" &&
			Number.isInteger(value.fontSize) &&
			value.fontSize >= textSizeRange.min &&
			value.fontSize <= textSizeRange.max
				? value.fontSize
				: 12;

		return {
			fontSize,
			fontFamily: font(
				"fontFamily" in value ? value.fontFamily : undefined,
				""
			),
			codeFontFamily: font(
				"codeFontFamily" in value ? value.codeFontFamily : undefined,
				"Menlo"
			),
		};
	}
}
