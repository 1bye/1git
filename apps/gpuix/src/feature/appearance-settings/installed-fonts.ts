const invalidFontCharacters = /\p{Cc}/u;

/** Reads installed families from CoreText through the native renderer. */
export class InstalledFonts {
	static list(renderer: object): readonly string[] {
		if (
			!("getFontFamilies" in renderer) ||
			typeof renderer.getFontFamilies !== "function"
		)
			throw new Error("The installed font list is unavailable.");

		const families: unknown = renderer.getFontFamilies();

		if (!Array.isArray(families))
			throw new Error("Could not read installed fonts.");

		return [
			...new Set(
				families.filter(
					(name): name is string =>
						typeof name === "string" &&
						name.length > 0 &&
						name.length <= 128 &&
						!invalidFontCharacters.test(name)
				)
			),
		].sort((a, b) => a.localeCompare(b));
	}
}
