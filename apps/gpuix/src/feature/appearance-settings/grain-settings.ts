/** Static grain choices share one pair of small textures across every window. */
export const grainPatterns = [
	{ value: "fine", label: "Fine", tiles: 12 },
	{ value: "classic", label: "Classic", tiles: 8 },
	{ value: "coarse", label: "Coarse", tiles: 4 },
] as const;

/** Opacity choices leave text and opaque content surfaces untouched. */
export const grainStrengths = [
	{ value: "subtle", label: "Subtle", opacity: 0.5 },
	{ value: "balanced", label: "Balanced", opacity: 1 },
	{ value: "strong", label: "Strong", opacity: 1.5 },
] as const;

/** Window-wide noise style and intensity, independent of the visibility toggle. */
export interface GrainSettings {
	readonly pattern: (typeof grainPatterns)[number]["value"];
	readonly strength: (typeof grainStrengths)[number]["value"];
}

/** Missing or invalid settings retain the original grain scale and strength. */
export const defaultGrainSettings: GrainSettings = {
	pattern: "classic",
	strength: "balanced",
};

/** Validates saved choices and native picker values without accepting external image sources. */
export class GrainPreferences {
	static parse(value: unknown): GrainSettings {
		if (typeof value !== "object" || value === null)
			return defaultGrainSettings;

		return {
			pattern:
				grainPatterns.find(
					(item) => "pattern" in value && item.value === value.pattern
				)?.value ?? defaultGrainSettings.pattern,
			strength:
				grainStrengths.find(
					(item) => "strength" in value && item.value === value.strength
				)?.value ?? defaultGrainSettings.strength,
		};
	}
}
