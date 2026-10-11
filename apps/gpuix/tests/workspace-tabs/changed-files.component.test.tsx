/**
 * Covers: per-tab changed-file badges, zero/99+ handling, retained totals, hover/focus swaps and both appearances.
 * Real: tab strip, reducers, native layout, pointer/focus events and accessibility metadata.
 * Doubles: repository snapshots and tab action capture; no Git or filesystem reads.
 * Requires: GPUIX native test renderer with macOS or Windows graphics access.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import type { FileChange } from "@1git/git";
import { flushSync, handleGpuixEvent } from "@gpuix/react";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { AppShell } from "../../src/fixture/app-shell";
import { WorkspaceTabs } from "../../src/feature/workspace-tabs/workspace-tabs";
import {
	WorkspaceTabsModel,
	type WorkspaceTabsState,
	type WorkspaceTabsAction,
} from "../../src/feature/workspace-tabs/lib/workspace-tabs-model";
import { AppThemeContext, appThemes } from "../../src/styles/theme";
import type { AppAppearance } from "../../src/styles/tokens";
import { workspaceLayout } from "../../src/styles/workspace-layout";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";

let root: TestRoot;
let actions: WorkspaceTabsAction[];

beforeEach(() => {
	root = createTestRoot({ width: 980, height: 300 });
	root.renderer.clockPause();
	actions = [];
});
afterEach(() => root.unmount());

function files(count: number): FileChange[] {
	return Array.from({ length: count }, (_, index) =>
		changedFile(`file-${index}.ts`)
	);
}

function workspace(changes: readonly FileChange[]): WorkspaceTabsState {
	return WorkspaceTabsModel.reduce(WorkspaceTabsModel.create(0), {
		type: "open-worktree",
		snapshot: repositorySnapshot(changes),
	});
}

function render(
	state: WorkspaceTabsState,
	appearance: AppAppearance = "light"
): void {
	root.render(
		<AppThemeContext
			value={{ ...appThemes[appearance], commitTypeBadges: true }}
		>
			<AppShell
				toolbar={
					<WorkspaceTabs
						state={state}
						dispatch={(action) => actions.push(action)}
					/>
				}
				workspaceLabel="Badge test workspace"
			/>
		</AppThemeContext>
	);
}

function node(testId: string) {
	const found = root.renderer.findByTestId(testId);

	if (!found) throw new Error(`Missing ${testId}`);

	return found;
}

function bounds(testId: string) {
	const found = root.renderer.getElementBounds(node(testId).id);

	if (!found) throw new Error(`Missing bounds for ${testId}`);

	return found;
}

it("hides clean-tab badges and exposes exact singular/plural counts without changing tab names", () => {
	render(workspace([]));
	expect(
		root.renderer.findByTestId("changed-files-workspace-1")
	).toBeUndefined();
	expect(node("close-workspace-1").style.opacity).toBe(1);

	for (const count of [1, 12, 99, 100, 1234]) {
		render(workspace(files(count)));
		expect(node("changed-files-workspace-1").style.opacity).toBe(1);
		expect(node("close-workspace-1").style.opacity).toBe(0);
		expect(root.renderer.getAllText()).toContain(
			count > 99 ? "99+" : String(count)
		);
		expect(node("workspace-1").customProps?.["aria-label"]).toBe(
			"project / main"
		);
		expect(node("workspace-1").customProps?.["aria-description"]).toStartWith(
			`${count} changed ${count === 1 ? "file" : "files"}.`
		);
		expect(bounds("slot-workspace-1").width).toBe(workspaceLayout.tabWidth);
	}
});

it("counts unique affected paths, not selected files, ignored records or the current History view", () => {
	let state = workspace([
		changedFile("tracked.ts"),
		changedFile("recreated.ts", { indexStatus: "deleted" }),
		changedFile("recreated.ts", {
			recordType: "untracked",
			worktreeStatus: "untracked",
		}),
		changedFile("ignored.ts", {
			recordType: "ignored",
			worktreeStatus: "ignored",
		}),
	]);

	state = WorkspaceTabsModel.reduce(state, {
		type: "workspace",
		id: "workspace-1",
		action: { type: "include-all", included: false },
	});
	state = WorkspaceTabsModel.reduce(state, {
		type: "workspace",
		id: "workspace-1",
		action: { type: "view", view: "history" },
	});
	render(state);
	expect(root.renderer.getAllText()).toContain("2");
	expect(node("workspace-1").customProps?.["aria-description"]).toStartWith(
		"2 changed files."
	);
	state = WorkspaceTabsModel.reduce(state, {
		type: "workspace",
		id: "workspace-1",
		action: { type: "loading" },
	});
	render(state);
	expect(node("changed-files-workspace-1").style.opacity).toBe(1);
	state = WorkspaceTabsModel.reduce(state, {
		type: "workspace",
		id: "workspace-1",
		action: { type: "load-error", message: "Temporary read failure" },
	});
	render(state);
	expect(node("workspace-1").customProps?.["aria-description"]).toStartWith(
		"2 changed files."
	);
});

it("uses compact amber badges in both themes and keeps inactive counts quieter", () => {
	const snapshot = repositorySnapshot(files(12));

	const state = WorkspaceTabsModel.reduce(workspace(files(3)), {
		type: "open-worktree",
		snapshot: {
			...snapshot,
			repository: { ...snapshot.repository, root: "/test/other" },
		},
	});

	for (const appearance of ["light", "dark"] as const) {
		render(state, appearance);
		const badge = bounds("changed-files-workspace-2");
		const close = bounds("close-workspace-2");

		expect(badge.height).toBe(18);
		expect(badge.width).toBeGreaterThanOrEqual(18);
		expect(badge.width).toBeLessThanOrEqual(close.width);
		expect(badge.x + badge.width / 2).toBe(close.x + close.width / 2);
		expect(badge.y + badge.height / 2).toBe(close.y + close.height / 2);
		expect(node("changed-files-count-workspace-2").style.fontSize).toBe(9);
		expect(node("changed-files-workspace-2").style.backgroundColor).toBe(
			appearance === "dark" ? "#3e372c" : "#f6f1e8"
		);
		expect(node("changed-files-workspace-1").style.opacity).toBe(0.65);
		expect(node("changed-files-workspace-2").style.opacity).toBe(1);
		const screenshot = process.env.GPUIX_TAB_BADGES_SCREENSHOT;

		if (screenshot)
			root.renderer.captureScreenshot(`${screenshot}-${appearance}.png`);
	}
});

it("swaps badges for Close on tab hover without moving labels, and restores counts on leave", () => {
	render(workspace(files(12)));
	const label = bounds("label-workspace-1");
	const close = bounds("close-workspace-1");

	for (const box of [bounds("hover-workspace-1"), label, close]) {
		root.renderer.nativeSimulateMouseMove(box.x + 2, box.y + box.height / 2);
		expect(node("changed-files-workspace-1").style.opacity).toBe(0);
		expect(node("close-workspace-1").style.opacity).toBe(1);
		expect(bounds("label-workspace-1")).toEqual(label);
		expect(bounds("close-workspace-1")).toEqual(close);
	}

	root.renderer.nativeSimulateClick(
		close.x + close.width / 2,
		close.y + close.height / 2
	);
	expect(actions).toContainEqual({ type: "close", id: "workspace-1" });
	root.renderer.nativeSimulateMouseMove(900, 200);
	expect(node("changed-files-workspace-1").style.opacity).toBe(1);
	expect(node("close-workspace-1").style.opacity).toBe(0);
});

it("reveals Close when keyboard focus moves from the tab to its close button", () => {
	render(workspace(files(1)));
	const tab = node("workspace-1");
	const close = node("close-workspace-1");

	for (const [elementId, eventType] of [
		[tab.id, "focus"],
		[tab.id, "blur"],
		[close.id, "focus"],
	] as const) {
		flushSync(() => handleGpuixEvent({ elementId, eventType }, root.renderer));
	}

	expect(node("changed-files-workspace-1").style.opacity).toBe(0);
	expect(node("close-workspace-1").style.opacity).toBe(1);
	root.renderer.nativeSimulateKeyDown(close.id, "enter");
	expect(actions).toContainEqual({ type: "close", id: "workspace-1" });
	flushSync(() =>
		handleGpuixEvent({ elementId: close.id, eventType: "blur" }, root.renderer)
	);
	expect(node("changed-files-workspace-1").style.opacity).toBe(1);
});
