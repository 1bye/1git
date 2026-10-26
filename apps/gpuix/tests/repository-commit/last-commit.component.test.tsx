/**
 * Covers: stable composer geometry during last-commit reads and retained summaries on tab remount.
 * Real: commit composer, last-commit footer and native layout.
 * Doubles: deferred Git metadata reads and captured commit callbacks; no Git or preference I/O.
 * Requires: patched GPUIX renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { RepositoryCommit } from "../../src/feature/repository-workspace/components/repository-commit";
import type { RepositoryCommit as CommitReader } from "../../src/feature/repository-workspace/lib/repository-commit";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceState,
} from "../../src/feature/repository-workspace/lib/repository-workspace-model";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";
import { commitInfo } from "../_shared/history-page";
import { AppThemeContext, appThemes } from "../../src/styles/theme";

type Response = Awaited<ReturnType<typeof CommitReader.readLast>>;
let root: TestRoot;

beforeEach(() => {
	root = createTestRoot({ width: 400, height: 600 });
});
afterEach(() => root.unmount());

function workspace(): RepositoryWorkspaceState {
	return RepositoryWorkspaceModel.reduce(RepositoryWorkspaceModel.create(), {
		type: "loaded",
		snapshot: repositorySnapshot([changedFile("a.ts")]),
	});
}

function metadata(
	summary = "fix(core): keep the footer steady"
): Extract<Response, { ok: true }> {
	return {
		ok: true,
		value: {
			commit: { ...commitInfo(), summary },
			undoUnavailableReason: null,
		},
	};
}

function show(
	key: string,
	state: RepositoryWorkspaceState,
	readLast: typeof CommitReader.readLast
) {
	root.render(
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width: 310,
				height: "100%",
				backgroundColor: appThemes.light.colors.editorSurface,
			}}
		>
			<div style={{ flexGrow: 1 }} />
			<RepositoryCommit
				key={key}
				state={state}
				onAction={() => {}}
				readLast={readLast}
				onUndo={async () => null}
			/>
		</div>
	);
}

function node(id: string) {
	const found = root.renderer.findByTestId(id);

	if (!found) throw new Error(`Missing ${id}`);

	return found;
}

function geometry() {
	return ["commit-composer", "commit-submit", "last-commit-footer"].map((id) =>
		root.renderer.getElementBounds(node(id).id)
	);
}

async function settle() {
	await Bun.sleep(0);
	root.renderer.flush();
}

it("keeps the commit button and editor fixed when a delayed summary or error appears", async () => {
	const pending = Promise.withResolvers<Response>();

	const state = RepositoryWorkspaceModel.reduce(workspace(), {
		type: "include-all",
		included: true,
	});

	show("initial", state, async () => pending.promise);
	const loading = geometry();

	if (process.env.GPUIX_FOOTER_LOADING_SCREENSHOT)
		root.renderer.captureScreenshot(
			process.env.GPUIX_FOOTER_LOADING_SCREENSHOT
		);

	pending.resolve(metadata());
	await settle();
	expect(root.renderer.getAllText().join(" ")).toContain(
		"keep the footer steady"
	);
	expect(geometry()).toEqual(loading);
	expect(root.renderer.getPaintedText()).toContain("Commit 1 file");

	if (process.env.GPUIX_FOOTER_LOADED_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_FOOTER_LOADED_SCREENSHOT);

	const failure = Promise.withResolvers<Response>();

	show("retry", state, async () => failure.promise);
	failure.reject(new Error("Cannot read the commit"));
	await settle();
	expect(root.renderer.getAllText()).toContain("Cannot read the commit");
	expect(geometry()).toEqual(loading);
});

it("shows a cached summary immediately after remount while rechecking recovery actions", async () => {
	const state = workspace();
	const pending = Promise.withResolvers<Response>();
	const readLast = mock<typeof CommitReader.readLast>(async () => metadata());

	show("first-visit", state, readLast);
	await settle();
	const loaded = geometry();

	readLast.mockImplementation(async () => pending.promise);
	show("return-visit", state, readLast);
	expect(root.renderer.getAllText().join(" ")).toContain(
		"keep the footer steady"
	);
	expect(geometry()).toEqual(loaded);
	expect(node("commit-undo").style.opacity).toBe(0.45);
	expect(node("commit-amend").style.opacity).toBe(0.45);
	const published = metadata();

	pending.resolve({
		...published,
		value: { ...published.value, undoUnavailableReason: "Already published" },
	});
	await settle();
	expect(node("commit-undo").style.opacity).toBe(0.45);
	expect(node("commit-amend").style.opacity).toBe(0.45);
	expect(readLast).toHaveBeenCalledTimes(2);

	const changed = workspace();

	if (!changed.repository) throw new Error("Missing repository");

	show(
		"new-head",
		{ ...changed, repository: { ...changed.repository, head: "new-head" } },
		async () => new Promise<Response>(() => {})
	);
	expect(root.renderer.getAllText().join(" ")).not.toContain(
		"keep the footer steady"
	);
	show(
		"other-repository",
		{
			...changed,
			repository: { ...changed.repository, root: "/test/other-project" },
		},
		async () => new Promise<Response>(() => {})
	);
	expect(root.renderer.getAllText().join(" ")).not.toContain(
		"keep the footer steady"
	);
});

it("keeps composer gradient colors valid for interpolated theme surfaces", () => {
	root.render(
		<AppThemeContext
			value={{
				...appThemes.dark,
				commitTypeBadges: true,
				colors: {
					...appThemes.dark.colors,
					editorSurface: "rgba(32, 34, 39, 1)",
				},
			}}
		>
			<RepositoryCommit
				state={workspace()}
				onAction={() => {}}
				readLast={async () => metadata()}
			/>
		</AppThemeContext>
	);
	const gradient = node("commit-actions-fade").style.background;

	if (
		!gradient ||
		typeof gradient !== "object" ||
		!("stops" in gradient) ||
		!Array.isArray(gradient.stops)
	)
		throw new Error("Missing composer gradient stops");

	for (const stop of gradient.stops) {
		if (
			!stop ||
			typeof stop !== "object" ||
			!("color" in stop) ||
			typeof stop.color !== "string"
		)
			throw new Error("Missing gradient color");

		expect(Bun.color(stop.color, "{rgba}")).not.toBeNull();
	}
});
