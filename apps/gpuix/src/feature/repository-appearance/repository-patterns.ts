import { isAbsolute } from "node:path";

/** Built-in illustrated wallpapers; undefined keeps the existing unpatterned appearance. */
export type RepositoryPattern =
	| "rose"
	| "seaside"
	| "forest"
	| "cosmic"
	| "meadow"
	| "camping"
	| "rainfall"
	| "workshop";

/** Composition and percentage controls for a repository's illustrated chrome. */
export interface RepositoryPatternAdjustments {
	readonly layout: "scattered" | "clusters" | "hero";
	readonly density: number;
	readonly size: number;
	readonly strength: number;
	readonly variation: number;
}

/** Defaults retain the existing seeded layout and restrained opacity. */
export const defaultPatternAdjustments: RepositoryPatternAdjustments = {
	layout: "scattered",
	density: 50,
	size: 50,
	strength: 50,
	variation: 50,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** A built-in pack with a stable layout shared by a repository's worktrees. */
export interface RepositoryPatternSelection {
	readonly id: RepositoryPattern;
	readonly seed: number;
	readonly adjustments?: RepositoryPatternAdjustments;
}

/** Device-local choices; legacy pack IDs remain readable without rewriting saved preferences. */
export type RepositoryPatternChoices = Readonly<
	Record<string, RepositoryPattern | RepositoryPatternSelection>
>;

/** A repository's saved appearance or an uncommitted editor draft. */
export interface RepositoryAppearanceValue {
	readonly color?: string;
	readonly pattern?: RepositoryPattern;
	readonly patternSeed?: number;
	readonly patternAdjustments?: RepositoryPatternAdjustments;
}

/** The two sections of the floating repository appearance editor. */
export type RepositoryAppearanceSection = "color" | "pattern";

/** Appearance controls shared by the repository editor and quick settings menu. */
export interface RepositoryAppearanceOptions extends RepositoryAppearanceValue {
	readonly onChange: (color: string | undefined) => void;
	readonly onPatternChange: (
		pattern: RepositoryPattern | undefined,
		seed?: number,
		adjustments?: RepositoryPatternAdjustments
	) => void;
}

/** Illustrated presets with thumbnail colors only; choosing a pattern never changes the repository color. */
export const repositoryPatternPresets = [
	{ id: "rose", name: "Rose", color: "#e879a0" },
	{ id: "seaside", name: "Seaside", color: "#528bff" },
	{ id: "forest", name: "Forest", color: "#62ae86" },
	{ id: "cosmic", name: "Cosmic", color: "#a478ef" },
	{ id: "meadow", name: "Meadow", color: "#d2a340" },
	{ id: "camping", name: "Camping", color: "#c88a59" },
	{ id: "rainfall", name: "Rainfall", color: "#6b9eb8" },
	{ id: "workshop", name: "Workshop", color: "#7c8bc4" },
] as const;

/** Validates persisted wallpaper IDs; no arbitrary paths, SVG or remote images enter the renderer. */
export class RepositoryPatterns {
	static adjustments(value: unknown): RepositoryPatternAdjustments {
		if (!isRecord(value)) return defaultPatternAdjustments;

		const percent = (candidate: unknown): number =>
			typeof candidate === "number" && Number.isFinite(candidate)
				? Math.round(Math.max(0, Math.min(100, candidate)))
				: 50;

		return {
			layout:
				value.layout === "clusters" || value.layout === "hero"
					? value.layout
					: "scattered",
			density: percent(value.density),
			size: percent(value.size),
			strength: percent(value.strength),
			variation: percent(value.variation),
		};
	}

	static isDefault(adjustments: RepositoryPatternAdjustments): boolean {
		return (
			adjustments.layout === "scattered" &&
			adjustments.density === 50 &&
			adjustments.size === 50 &&
			adjustments.strength === 50 &&
			adjustments.variation === 50
		);
	}
	static pattern(value: unknown): RepositoryPattern | undefined {
		return repositoryPatternPresets.find((preset) => preset.id === value)?.id;
	}

	static seed(value: unknown): number | undefined {
		return typeof value === "number" &&
			Number.isInteger(value) &&
			value >= 0 &&
			value <= 0xffffffff
			? value
			: undefined;
	}

	/** Gives older choices and newly selected packs a stable layout for this common directory. */
	static defaultSeed(directory: string): number {
		let seed = 2166136261;

		for (const character of directory)
			seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;

		return seed;
	}

	static shuffleSeed(current: number): number {
		const next = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;

		return next === current ? (current + 1) >>> 0 : next;
	}

	static selection(
		value: unknown,
		directory: string
	): RepositoryPatternSelection | undefined {
		const legacy = RepositoryPatterns.pattern(value);

		if (legacy)
			return { id: legacy, seed: RepositoryPatterns.defaultSeed(directory) };

		if (typeof value !== "object" || value === null || Array.isArray(value))
			return undefined;

		const id = "id" in value ? RepositoryPatterns.pattern(value.id) : undefined;

		const seed =
			"seed" in value ? RepositoryPatterns.seed(value.seed) : undefined;

		if (!id || seed === undefined) return undefined;

		const adjustments = RepositoryPatterns.adjustments(
			"adjustments" in value ? value.adjustments : undefined
		);

		return {
			id,
			seed,
			...(RepositoryPatterns.isDefault(adjustments) ? {} : { adjustments }),
		};
	}

	static parse(value: unknown): RepositoryPatternChoices {
		if (typeof value !== "object" || value === null || Array.isArray(value))
			return {};

		const choices: Record<
			string,
			RepositoryPattern | RepositoryPatternSelection
		> = {};

		for (const [directory, candidate] of Object.entries(value)) {
			const pattern = RepositoryPatterns.selection(candidate, directory);

			if (isAbsolute(directory) && !directory.includes("\0") && pattern)
				choices[directory] =
					typeof candidate === "string" ? pattern.id : pattern;
		}

		return choices;
	}

	static set(
		choices: RepositoryPatternChoices,
		directory: string,
		pattern: RepositoryPattern | undefined,
		seed?: number,
		adjustments?: RepositoryPatternAdjustments
	): RepositoryPatternChoices {
		if (!isAbsolute(directory) || directory.includes("\0"))
			throw new Error("Repository pattern requires a valid common directory.");

		if (pattern !== undefined && !RepositoryPatterns.pattern(pattern))
			throw new Error("Choose a built-in repository pattern.");

		if (seed !== undefined && RepositoryPatterns.seed(seed) === undefined)
			throw new Error("Repository pattern requires an unsigned 32-bit seed.");

		const next = { ...choices };

		const previous = RepositoryPatterns.selection(
			choices[directory],
			directory
		);

		const settings = RepositoryPatterns.adjustments(
			adjustments ?? previous?.adjustments
		);

		if (pattern)
			next[directory] = {
				id: pattern,
				seed:
					seed ?? previous?.seed ?? RepositoryPatterns.defaultSeed(directory),
				...(RepositoryPatterns.isDefault(settings)
					? {}
					: { adjustments: settings }),
			};
		else delete next[directory];

		return next;
	}
}
