/**
 * Covers: linear history, merges, octopus parents, disconnected tips and page-stable lane geometry.
 * Real: commit graph layout.
 * Doubles: commit metadata fixtures.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { CommitGraph } from "../../src/feature/repository-graph/commit-graph";
import { commitInfo } from "../_shared/history-page";

const commit = (index: number, ...parents: number[]) => ({
	...commitInfo(index),
	parentOids: parents.map((parent) => commitInfo(parent).oid),
});

it("continues a linear lane and stops at the root", () => {
	const graph = CommitGraph.layout([commit(3, 2), commit(2, 1), commit(1)]);

	expect(graph.lanes).toBe(1);
	expect(graph.rows.map((row) => row.lane)).toEqual([0, 0, 0]);
	expect(graph.rows.map((row) => row.color)).toEqual([0, 0, 0]);
	expect(graph.rows[0]?.edges.some((edge) => edge.half === "top")).toBe(false);
	expect(graph.rows[1]?.edges).toHaveLength(2);
	expect(graph.rows[2]?.edges.map((edge) => edge.half)).toEqual(["top"]);
});

it("joins all merge parents and preserves connections across page boundaries", () => {
	const commits = [
		commit(6, 5, 4, 3),
		commit(5, 2),
		commit(4, 2),
		commit(3, 2),
		commit(2, 1),
		commit(1),
	];

	const first = CommitGraph.layout(commits.slice(0, 2));
	const full = CommitGraph.layout(commits);

	expect(full.lanes).toBe(3);
	expect(full.rows.slice(0, 2)).toEqual([...first.rows]);
	expect(
		full.rows[0]?.edges
			.filter((edge) => edge.half === "bottom")
			.map((edge) => edge.to)
	).toEqual([0, 1, 2]);
	expect(full.rows[2]?.edges).toContainEqual({
		from: 1,
		to: 0,
		half: "bottom",
		color: 0,
	});
	expect(full.rows[3]?.edges).toContainEqual({
		from: 2,
		to: 0,
		half: "bottom",
		color: 0,
	});

	for (let index = 1; index < full.rows.length; index++) {
		const incoming = full.rows[index]?.edges
			.filter((edge) => edge.half === "top")
			.map((edge) => edge.from)
			.sort();

		const outgoing = [
			...new Set(
				full.rows[index - 1]?.edges
					.filter((edge) => edge.half === "bottom")
					.map((edge) => edge.to)
			),
		].sort();

		expect(incoming).toEqual(outgoing);
	}
});

it("starts unrelated tips without inventing an incoming connection", () => {
	const graph = CommitGraph.layout([
		commit(4, 2),
		commit(3, 1),
		commit(2),
		commit(1),
	]);

	expect(graph.rows[1]?.lane).toBe(1);
	expect(graph.rows[1]?.edges).not.toContainEqual({
		from: 1,
		to: 1,
		half: "top",
		color: 1,
	});
	expect(graph.rows[1]?.edges).toContainEqual({
		from: 0,
		to: 0,
		half: "top",
		color: 0,
	});
	expect(graph.rows[3]?.color).toBe(1);
});

it("reuses vacant lanes after disconnected roots", () => {
	const graph = CommitGraph.layout([commit(3), commit(2), commit(1)]);

	expect(graph.lanes).toBe(1);
	expect(graph.rows.every((row) => !row.edges.length)).toBe(true);
});
