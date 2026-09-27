import type { BranchCollection, BranchInfo } from "@1git/git";

const relativeTime = new Intl.RelativeTimeFormat(undefined, {
	numeric: "auto",
});

const ageUnits = [
	{ milliseconds: 31_536_000_000, unit: "year" },
	{ milliseconds: 2_592_000_000, unit: "month" },
	{ milliseconds: 86_400_000, unit: "day" },
	{ milliseconds: 3_600_000, unit: "hour" },
	{ milliseconds: 60_000, unit: "minute" },
] as const;

const commitTime = (value: string | null): number => {
	const timestamp = value ? Date.parse(value) : Number.NaN;

	return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
};

/** Read-only branch presentation matching the desktop workspace menu. */
export class WorkspaceMenuModel {
	private constructor() {}

	/** Keep remote choices only when no local branch already tracks that ref. */
	static untrackedRemoteBranches(
		collection: BranchCollection | undefined
	): BranchInfo[] {
		const branches = collection?.branches ?? [];

		const upstreams = new Set(
			branches
				.filter(
					(branch) => branch.type === "local" && branch.upstreamRemote !== "."
				)
				.map((branch) => branch.upstream)
		);

		return branches.filter(
			(branch) =>
				branch.type === "remote" &&
				!upstreams.has(branch.name) &&
				!upstreams.has(branch.fullName) &&
				!upstreams.has(branch.fullName.replace(/^refs\//, ""))
		);
	}

	static recentBranches(
		collection: BranchCollection | undefined
	): BranchInfo[] {
		return (collection?.branches ?? [])
			.filter((branch) => branch.type === "local")
			.toSorted(
				(first, second) =>
					commitTime(second.committedAt) - commitTime(first.committedAt)
			);
	}

	static trackingLabel(branch: BranchInfo | undefined): string {
		if (!branch?.upstream) return "No upstream";

		const parts = [branch.upstream];

		if (branch.ahead > 0) parts.push(`${branch.ahead} ahead`);

		if (branch.behind > 0) parts.push(`${branch.behind} behind`);

		return parts.join(" · ");
	}

	static commitAge(committedAt: string | null, nowMs = Date.now()): string {
		const timestamp = commitTime(committedAt);

		if (!Number.isFinite(timestamp)) return "";

		const difference = timestamp - nowMs;

		for (const { milliseconds, unit } of ageUnits) {
			if (Math.abs(difference) >= milliseconds)
				return relativeTime.format(Math.round(difference / milliseconds), unit);
		}

		return "just now";
	}
}
