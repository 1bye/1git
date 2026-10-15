import { isAbsolute } from "node:path";

/** Local color choices keyed by Git's common directory, shared by every worktree. */
export type RepositoryColorChoices = Readonly<Record<string, string>>;

/** Curated accents; a custom six-digit hex color can be used instead. */
export const repositoryColorPresets = [
	{ name: "Blue", color: "#528bff" },
	{ name: "Violet", color: "#a478ef" },
	{ name: "Rose", color: "#e879a0" },
	{ name: "Orange", color: "#e99855" },
	{ name: "Amber", color: "#d9b34a" },
	{ name: "Green", color: "#62ae86" },
	{ name: "Teal", color: "#46b8b3" },
	{ name: "Slate", color: "#8294b3" },
] as const;

/** Validates optional preferences without touching Git configuration or tracked files. */
export class RepositoryColors {
	static color(value: unknown): string | undefined {
		return typeof value === "string" && /^#[a-f0-9]{6}$/iu.test(value)
			? value.toLowerCase()
			: undefined;
	}

	static parse(value: unknown): RepositoryColorChoices {
		if (typeof value !== "object" || value === null || Array.isArray(value))
			return {};

		const choices: Record<string, string> = {};

		for (const [directory, candidate] of Object.entries(value)) {
			const color = RepositoryColors.color(candidate);

			if (isAbsolute(directory) && !directory.includes("\0") && color)
				choices[directory] = color;
		}

		return choices;
	}

	static set(
		choices: RepositoryColorChoices,
		directory: string,
		color: string | undefined
	): RepositoryColorChoices {
		if (!isAbsolute(directory) || directory.includes("\0"))
			throw new Error("Repository color requires a valid common directory.");

		const normalized =
			color === undefined ? undefined : RepositoryColors.color(color);

		if (color !== undefined && normalized === undefined)
			throw new Error("Use a six-digit hex color, such as #a478ef.");

		const next = { ...choices };

		if (normalized) next[directory] = normalized;
		else delete next[directory];

		return next;
	}
}
