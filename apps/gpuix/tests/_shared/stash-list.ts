import type { StashInfo } from "@1git/git";

/** Fresh stash metadata with stable object IDs, independent of reflog positions. */
export const stashList = (count = 3): StashInfo[] =>
	Array.from({ length: count }, (_, index) => ({
		oid: (index + 1).toString(16).padStart(40, "0"),
		reference: `stash@{${index}}`,
		summary: `On feature/tabs: Saved work ${index + 1}`,
		createdAt: "2026-09-26T12:00:00Z",
	}));
