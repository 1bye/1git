/**
 * Covers: Git-path grouping, compact folders, visibility, commit inclusion and displayed-order ranges.
 * Real: file-tree and workspace models.
 * Doubles: Git presentation records; no filesystem reads.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { RepositoryFileTree as Tree } from "../../src/feature/repository-workspace/lib/repository-file-tree";
import {
	RepositoryWorkspaceModel as Workspace,
	type RepositoryWorkspaceState,
} from "../../src/feature/repository-workspace/lib/repository-workspace-model";
import type { WorkspaceEntry } from "../../src/feature/repository-workspace/types";

const entry = (
	path: string,
	status: WorkspaceEntry["status"] = "M"
): WorkspaceEntry => ({ id: path, title: path, status });

it("compacts folder chains, sorts folders before files, and retains original records", () => {
	const entries = [
		entry("README.md"),
		entry("src/app.tsx"),
		entry("src/ui/field.tsx"),
		entry("packages/ui/src/new.tsx", "A"),
	];

	const nodes = Tree.build(entries);
	const rows = Tree.rows(nodes, new Set());

	expect(
		rows.map((row) => (row.kind === "folder" ? row.name : row.id))
	).toEqual([
		"packages/ui/src",
		"packages/ui/src/new.tsx",
		"src",
		"ui",
		"src/ui/field.tsx",
		"src/app.tsx",
		"README.md",
	]);
	expect(rows.find((row) => row.id === "src/ui/field.tsx")).toMatchObject({
		kind: "file",
		entry: entries[2],
		depth: 2,
		parentId: "folder:src/ui/",
	});
	expect(nodes[0]).toMatchObject({
		kind: "folder",
		paths: ["packages", "packages/ui", "packages/ui/src"],
		fileIds: ["packages/ui/src/new.tsx"],
	});
	expect(entries.map((item) => item.id)).toEqual([
		"README.md",
		"src/app.tsx",
		"src/ui/field.tsx",
		"packages/ui/src/new.tsx",
	]);
});

it("supports deleted paths, case distinctions, backslashes and file-to-folder changes", () => {
	const entries = [
		entry("src", "D"),
		entry("src/new.ts", "A"),
		entry("Src/old.ts", "D"),
		entry("literal\\name.ts"),
		entry("src/file10.ts"),
		entry("src/file2.ts"),
	];

	const rows = Tree.rows(Tree.build(entries), new Set());
	const ids = rows.filter((row) => row.kind === "file").map((row) => row.id);

	expect(new Set(ids)).toEqual(new Set(entries.map((item) => item.id)));
	expect(ids.indexOf("src/file2.ts")).toBeLessThan(
		ids.indexOf("src/file10.ts")
	);
	expect(
		rows.filter((row) => row.kind === "folder").map((row) => row.path)
	).toEqual(expect.arrayContaining(["src", "Src"]));
	expect(rows.find((row) => row.id === "literal\\name.ts")?.depth).toBe(0);
});

it("reveals filtered paths without changing saved expansion or folder inclusion scope", () => {
	const entries = [
		entry("src/ui/a.ts"),
		entry("src/ui/b.ts"),
		entry("src/app.ts"),
	];

	const nodes = Tree.build(entries);
	const collapsed = new Set(["src"]);

	expect(Tree.rows(nodes, collapsed).map((row) => row.id)).toEqual([
		"folder:src/",
	]);
	const filtered = Tree.rows(nodes, collapsed, new Set(["src/ui/b.ts"]));

	expect(filtered.map((row) => row.id)).toEqual([
		"folder:src/",
		"folder:src/ui/",
		"src/ui/b.ts",
	]);
	expect(filtered[1]).toMatchObject({
		fileIds: ["src/ui/a.ts", "src/ui/b.ts"],
	});
	expect([...collapsed]).toEqual(["src"]);
	expect(Tree.rows(nodes, collapsed).length).toBe(1);
});

it("derives mixed folder inclusion from excluded files and partial hunks", () => {
	const ids = ["a", "b"];

	expect(Tree.inclusion(ids, new Set(), new Set())).toBe(false);
	expect(Tree.inclusion(ids, new Set(ids), new Set())).toBe(true);
	expect(Tree.inclusion(ids, new Set(["a"]), new Set())).toBe("indeterminate");
	expect(Tree.inclusion(ids, new Set(ids), new Set(["b"]))).toBe(
		"indeterminate"
	);
});

it("selects ranges in displayed tree order and excludes hidden files", () => {
	const entries = [
		entry("a.ts"),
		entry("src/z.ts"),
		entry("src/a.ts"),
		entry("src/hidden.ts"),
	];

	let state: RepositoryWorkspaceState = {
		...Workspace.create(),
		entries: { changes: entries, history: [], stashes: [] },
		includedFileIds: entries.map((item) => item.id),
	};

	const visibleIds = ["src/a.ts", "src/z.ts", "a.ts"];

	state = Workspace.reduce(state, {
		type: "select",
		view: "changes",
		id: "src/a.ts",
		visibleIds,
	});
	state = Workspace.reduce(state, {
		type: "select",
		view: "changes",
		id: "src/z.ts",
		mode: "range",
		visibleIds,
	});

	expect(state.views.changes.selectedIds).toEqual(["src/a.ts", "src/z.ts"]);
	expect(state.includedFileIds).toEqual(entries.map((item) => item.id));
});
