import type { CommitInfo } from "@1git/git";

/** One half-row connection in stable native graph coordinates. */
export interface GraphEdge {
	readonly from: number;
	readonly to: number;
	readonly half: "top" | "bottom";
	readonly color: number;
}

/** A commit node and its connections to the adjacent rows, including unloaded parents. */
export interface GraphRow {
	readonly commit: CommitInfo;
	readonly lane: number;
	readonly color: number;
	readonly edges: readonly GraphEdge[];
}

/** Allocates persistent lanes over topologically ordered commits; extending a page keeps earlier rows identical. */
export class CommitGraph {
	static layout(commits: readonly CommitInfo[]): {
		rows: readonly GraphRow[];
		lanes: number;
	} {
		const lanes: ({ oid: string; color: number } | null)[] = [];
		const rows: GraphRow[] = [];
		let colors = 0;
		let width = 1;

		for (const commit of commits) {
			let lane = lanes.findIndex((item) => item?.oid === commit.oid);

			if (lane < 0) {
				lane = lanes.indexOf(null);

				if (lane < 0) lane = lanes.length;

				lanes[lane] = { oid: commit.oid, color: colors++ };
			}

			const node = lanes[lane];

			if (!node) continue;

			const edges: GraphEdge[] = [];
			const previous = rows.length ? rows[rows.length - 1] : undefined;

			for (const [index, item] of lanes.entries()) {
				if (!item) continue;

				// A new branch tip has no incoming edge from an unrelated row.
				if (
					index !== lane ||
					previous?.edges.some(
						(edge) => edge.half === "bottom" && edge.to === lane
					)
				)
					edges.push({
						from: index,
						to: index,
						half: "top",
						color: item.color,
					});

				if (index !== lane)
					edges.push({
						from: index,
						to: index,
						half: "bottom",
						color: item.color,
					});
			}

			lanes[lane] = null;

			for (const [index, oid] of [...new Set(commit.parentOids)].entries()) {
				let target = lanes.findIndex((item) => item?.oid === oid);

				if (target < 0) {
					target = index === 0 ? lane : lanes.indexOf(null);

					if (target < 0) target = lanes.length;

					lanes[target] = { oid, color: index === 0 ? node.color : colors++ };
				}

				edges.push({
					from: lane,
					to: target,
					half: "bottom",
					color: lanes[target]?.color ?? node.color,
				});
			}

			width = Math.max(width, lanes.length, lane + 1);
			rows.push({ commit, lane, color: node.color, edges });

			while (lanes.length && lanes.at(-1) === null) lanes.pop();
		}

		return { rows, lanes: width };
	}
}
