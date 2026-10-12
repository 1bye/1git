import type { AppAppearance } from "../../../styles/tokens";
import type { CommitType } from "../lib/commit-subject";

const tones = {
	light: {
		green: { color: "#38664a", backgroundColor: "#edf4ef" },
		red: { color: "#955053", backgroundColor: "#f8eeee" },
		purple: { color: "#705a8b", backgroundColor: "#f3eff7" },
		amber: { color: "#80633d", backgroundColor: "#f6f1e8" },
		blue: { color: "#496b92", backgroundColor: "#edf2f8" },
		neutral: { color: "#606775", backgroundColor: "#f0f1f3" },
	},
	dark: {
		green: { color: "#9cc5ab", backgroundColor: "#2b3b32" },
		red: { color: "#d8a3a7", backgroundColor: "#443034" },
		purple: { color: "#beadd8", backgroundColor: "#37303f" },
		amber: { color: "#d2ba95", backgroundColor: "#3e372c" },
		blue: { color: "#a5bfdb", backgroundColor: "#2b3542" },
		neutral: { color: "#b3b8c2", backgroundColor: "#30333a" },
	},
} as const;

const typeTone: Record<CommitType, keyof typeof tones.light> = {
	feat: "green",
	fix: "red",
	refactor: "purple",
	perf: "amber",
	docs: "blue",
	test: "blue",
	build: "neutral",
	ci: "neutral",
	chore: "neutral",
	style: "neutral",
	revert: "red",
};

/** Shared, subdued colors for commit badges and native editor prefixes. */
export function commitTypeColor(appearance: AppAppearance, type: CommitType) {
	return tones[appearance][typeTone[type]];
}
