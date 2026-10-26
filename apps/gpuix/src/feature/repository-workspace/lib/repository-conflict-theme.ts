import { createThemedStyles } from "../../../styles/theme";

/** Distinct source washes and an amber pause state in both application appearances. */
export const repositoryConflictTheme = createThemedStyles(({ appearance }) =>
	appearance === "dark"
		? {
				current: { ink: "#a8c7ff", wash: "#1d2a40" },
				incoming: { ink: "#ceb2f5", wash: "#2d233c" },
				warning: { ink: "#edc581", wash: "#332b1d" },
			}
		: {
				current: { ink: "#315fbd", wash: "#eef4ff" },
				incoming: { ink: "#7952af", wash: "#f5effc" },
				warning: { ink: "#916116", wash: "#fff6df" },
			}
);
