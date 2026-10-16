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

/** Device-local wallpaper choices shared by worktrees through Git's common directory. */
export type RepositoryPatternChoices = Readonly<
	Record<string, RepositoryPattern>
>;

/** Appearance controls shared by the repository page and quick settings menu. */
export interface RepositoryAppearanceOptions {
	readonly color?: string;
	readonly pattern?: RepositoryPattern;
	readonly onChange: (color: string | undefined) => void;
	readonly onPatternChange: (pattern: RepositoryPattern | undefined) => void;
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
	static pattern(value: unknown): RepositoryPattern | undefined {
		return repositoryPatternPresets.find((preset) => preset.id === value)?.id;
	}

	static parse(value: unknown): RepositoryPatternChoices {
		if (typeof value !== "object" || value === null || Array.isArray(value))
			return {};

		const choices: Record<string, RepositoryPattern> = {};

		for (const [directory, candidate] of Object.entries(value)) {
			const pattern = RepositoryPatterns.pattern(candidate);

			if (isAbsolute(directory) && !directory.includes("\0") && pattern)
				choices[directory] = pattern;
		}

		return choices;
	}

	static set(
		choices: RepositoryPatternChoices,
		directory: string,
		pattern: RepositoryPattern | undefined
	): RepositoryPatternChoices {
		if (!isAbsolute(directory) || directory.includes("\0"))
			throw new Error("Repository pattern requires a valid common directory.");

		if (pattern !== undefined && !RepositoryPatterns.pattern(pattern))
			throw new Error("Choose a built-in repository pattern.");

		const next = { ...choices };

		if (pattern) next[directory] = pattern;
		else delete next[directory];

		return next;
	}
}
