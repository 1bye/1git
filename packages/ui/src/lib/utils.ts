import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Tailwind merge extended with the project's custom font sizes so they are not
 * misclassified as text colors.
 * @remarks Without this, `text-xss` collides with `text-{color}` in the same
 * `font-size`/text group and whichever appears last wins — silently dropping the
 * other. Registering `text-xss` as a font size keeps size and color independent.
 */
const twMerge = extendTailwindMerge({
	extend: {
		classGroups: {
			"font-size": ["text-xss"],
		},
	},
});

/** Merge class values with clsx and Tailwind-aware de-duplication. */
export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}
