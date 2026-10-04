/**
 * Covers: consistent empty repository artwork and sidebar lines without masking loading, errors or search results.
 * Real: workspace model, navigation, empty preview and native layout/accessibility.
 * Doubles: repository snapshots and revision data; no filesystem or provider requests.
 * Requires: patched GPUIX native test renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";

import { RepositoryDiffEmpty } from "../../src/feature/repository-workspace/components/repository-diff-empty";
import { RepositoryNavigation } from "../../src/feature/repository-workspace/components/repository-navigation";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceState,
} from "../../src/feature/repository-workspace/lib/repository-workspace-model";
import type { RepositoryView } from "../../src/feature/repository-workspace/types";
import { AppShell } from "../../src/fixture/app-shell";
import { repositorySnapshot } from "../_shared/repository-snapshot";

let root: TestRoot;

beforeEach(() => {
	root = createTestRoot({ width: 980, height: 640 });
	root.renderer.clockPause();
});
afterEach(() => root.unmount());

function emptyWorkspace(view: RepositoryView): RepositoryWorkspaceState {
	const snapshot = repositorySnapshot();

	const state = RepositoryWorkspaceModel.reduce(
		RepositoryWorkspaceModel.create(),
		{
			type: "loaded",
			snapshot: {
				...snapshot,
				head: { ...snapshot.head, oid: null, unborn: true },
			},
		}
	);

	return RepositoryWorkspaceModel.reduce(
		RepositoryWorkspaceModel.reduce(state, {
			type: "stashes-loaded",
			root: snapshot.repository.root,
			generation: state.stashes.generation,
			stashes: [],
		}),
		{ type: "view", view }
	);
}

function render(state: RepositoryWorkspaceState): void {
	root.render(
		<AppShell
			toolbar={<div style={{ height: 42, flexShrink: 0 }} />}
			workspaceLabel={state.view}
			navigation={
				<RepositoryNavigation
					workspaceId="empty"
					state={state}
					onAction={() => {}}
					onRefresh={() => {}}
				/>
			}
		>
			<RepositoryDiffEmpty
				workspace={state}
				view={state.view}
				revision={
					state.view === "changes"
						? undefined
						: RepositoryWorkspaceModel.revision(state, state.view)
				}
			/>
		</AppShell>
	);
}

const scenarios = [
	["changes", "Working tree clean", 1],
	["history", "No commits yet", 2],
	["stashes", "No stashed changes", 2],
] as const;

it.each(scenarios)(
	"uses shared artwork and sidebar lines in empty %s",
	(view, heading, placeholderCount) => {
		render(emptyWorkspace(view));

		const art = root.renderer.findByTestId("comparison-art-empty");

		const placeholders = root.renderer
			.findByType("div")
			.filter((node) => node.testId === "empty-list-placeholder");

		expect(art).toBeDefined();
		expect(art?.style.width).toBe(160);
		expect(art?.style.height).toBe(112);
		expect(root.renderer.getAllText()).toContain(heading);
		expect(placeholders).toHaveLength(placeholderCount);

		for (const placeholder of placeholders) {
			expect(placeholder.style.paddingLeft).toBe(8);
			expect(placeholder.children).toHaveLength(4);
		}

		expect(
			root.renderer.findByTestId("repository-list")?.customProps?.[
				"aria-description"
			]
		).toBe(heading);

		if (process.env.GPUIX_EMPTY_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_EMPTY_SCREENSHOT}.${view}.png`
			);
	}
);

it.each(scenarios)("does not decorate pending or failed %s reads", (view) => {
	const state = emptyWorkspace(view);

	for (const workspace of [
		{ ...state, loading: true },
		{ ...state, error: "Refresh failed" },
	]) {
		render(workspace);

		expect(root.renderer.findByTestId("comparison-art-empty")).toBeUndefined();
		expect(
			root.renderer.findByTestId(
				workspace.loading ? "state-art-loading" : "state-art-error"
			)
		).toBeDefined();
		expect(
			root.renderer.findByTestId("empty-list-placeholder")
		).toBeUndefined();
	}
});

it.each([
	["changes", "file", "Select a file to inspect"],
	["history", "history", "Select a commit to inspect"],
	["stashes", "stash", "Select a stash to inspect"],
] as const)("illustrates the %s selection prompt", (view, artwork, heading) => {
	const state = emptyWorkspace(view);

	if (!state.repository) throw new Error("Missing repository fixture");

	render({
		...state,
		repository: { ...state.repository, head: "committed" },
		entries: {
			...state.entries,
			[view]: [{ id: "item", title: "Choose me", files: [] }],
		},
	});

	expect(root.renderer.findByTestId(`state-art-${artwork}`)).toBeDefined();
	expect(root.renderer.getAllText()).toContain(heading);
	expect(root.renderer.findByTestId("comparison-art-empty")).toBeUndefined();

	if (process.env.GPUIX_SELECTION_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_SELECTION_SCREENSHOT}.${view}.png`
		);
});

it("shows loading artwork while the first history page is still pending", () => {
	const state = emptyWorkspace("history");

	render({ ...state, history: { ...state.history, nextOffset: 0 } });

	expect(root.renderer.getAllText()).toContain("Reading repository…");
	expect(root.renderer.findByTestId("state-art-loading")).toBeDefined();
	expect(root.renderer.findByTestId("comparison-art-empty")).toBeUndefined();
});

it("keeps unloaded stashes and failed revision reads distinct from an empty list", () => {
	const state = emptyWorkspace("stashes");

	for (const stashes of [
		{ ...state.stashes, loaded: false },
		{ ...state.stashes, error: "Stashes unavailable" },
	]) {
		render({ ...state, stashes });

		expect(root.renderer.findByTestId("comparison-art-empty")).toBeUndefined();
		expect(
			root.renderer.findByTestId("empty-list-placeholder")
		).toBeUndefined();
	}

	const history = emptyWorkspace("history");

	render({
		...history,
		history: { ...history.history, error: "History unavailable" },
	});

	expect(root.renderer.findByTestId("comparison-art-empty")).toBeUndefined();
	expect(root.renderer.findByTestId("empty-list-placeholder")).toBeUndefined();
});

it("shows no matching commits instead of an empty repository decoration", () => {
	const state = emptyWorkspace("history");

	render({ ...state, history: { ...state.history, query: "missing" } });

	expect(root.renderer.getAllText()).toContain("No matching commits");
	expect(root.renderer.findByTestId("state-art-search")).toBeDefined();
	expect(root.renderer.findByTestId("comparison-art-empty")).toBeUndefined();
	expect(root.renderer.findByTestId("empty-list-placeholder")).toBeUndefined();
});

it("does not call an unselected stash list empty or hide file selection instructions", () => {
	const state = emptyWorkspace("stashes");

	render({
		...state,
		entries: {
			...state.entries,
			stashes: [{ id: "saved", title: "Saved work", files: [] }],
		},
	});

	expect(root.renderer.getAllText()).toContain("Select a stash to inspect");
	expect(root.renderer.getAllText()).toContain(
		"Select a stash to see its files."
	);
	expect(root.renderer.getAllText()).not.toContain("No stashed changes");
	expect(root.renderer.findByTestId("comparison-art-empty")).toBeUndefined();
	expect(root.renderer.findByTestId("empty-list-placeholder")).toBeUndefined();
});
