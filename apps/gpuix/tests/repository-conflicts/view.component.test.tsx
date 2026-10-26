/**
 * Covers: conflict content, editor activation, explicit resolution and actionable failures.
 * Real: React and native GPUIX controls.
 * Doubles: content reader, editor launcher and Git mutation boundary.
 * Requires: patched GPUIX and macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { RepositoryDiff } from "../../src/feature/repository-workspace/components/repository-diff";
import { RepositoryConflictPreview } from "../../src/feature/repository-workspace/components/repository-conflict-preview";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";
import { App } from "../../src/app";
import type { RepositoryConflicts } from "../../src/feature/repository-workspace/lib/repository-conflicts";
import { windowOptions } from "../../src/window-options";

let root: TestRoot;

beforeEach(() => {
	root = createTestRoot({
		width: 1000,
		height: 700,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
});
afterEach(() => root.unmount());
const settle = async () => {
	for (let index = 0; index < 5; index++) {
		await Bun.sleep(0);
		root.renderer.flush();
		root.renderer.clockFastForward(100);
		root.renderer.dispatchNativeEvents();
		root.renderer.flush();
	}
};

const click = (testId: string) => {
	const node = root.renderer.findByTestId(testId);
	const bounds = node && root.renderer.getElementBounds(node.id);

	if (!bounds)
		throw new Error(
			`Missing ${testId}: ${root.renderer.getAllText().join(" | ")}`
		);

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	root.renderer.flush();
};

it("opens the editor without resolving and surfaces validation failures", async () => {
	const open = mock(async () => {});
	const resolve = mock(async () => "Conflict markers remain.");
	let text = "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other";

	root.render(
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width: "100%",
				height: "100%",
				backgroundColor: "#ffffff",
			}}
		>
			<RepositoryDiff
				root="/test"
				change={{ ...changedFile("file.txt"), recordType: "unmerged" }}
				refreshing={false}
				statusError={null}
				readDiff={async () => ({
					ok: true,
					value: [
						{
							target: "working",
							patch: "",
							stats: [],
							message: null,
							conflict: {
								text,
								hash: "reviewed",
								ours: {
									text: "ours",
									label: "Current · main",
									revision: "ours-blob",
								},
								theirs: {
									text: "theirs",
									label: "Incoming · feature",
									revision: "theirs-blob",
								},
							},
						},
					],
				})}
				openConflictEditor={open}
				onResolve={resolve}
			/>
		</div>
	);
	await settle();
	expect(
		root.renderer.findByTestId("conflict-content-content")?.customProps?.patch
	).toContain("<<<<<<< HEAD");
	expect(
		root.renderer.findByTestId("conflict-content-content")?.customProps?.mode
	).toBe("split");
	const sources = root.renderer.findByTestId("conflict-source-header");
	const result = root.renderer.findByTestId("conflict-result-header");
	const sourcesBox = sources && root.renderer.getElementBounds(sources.id);
	const resultBox = result && root.renderer.getElementBounds(result.id);

	expect(resultBox?.y).toBe(sourcesBox?.y);
	expect(resultBox?.x).toBeCloseTo(
		(sourcesBox?.x ?? 0) + (sourcesBox?.width ?? 0)
	);
	click("conflict-compare-theirs");
	await settle();
	expect(root.renderer.getAllText()).toContain("Incoming · feature");
	expect(
		root.renderer.findByTestId("conflict-content-content")?.customProps?.patch
	).toContain("+ours");
	expect(resolve).not.toHaveBeenCalled();
	click("conflict-open-editor");
	await settle();
	expect(open).toHaveBeenCalledWith("/test", "file.txt");
	expect(resolve).not.toHaveBeenCalled();
	click("conflict-resolve");
	await settle();
	expect(resolve).not.toHaveBeenCalled();
	text = "resolved content";
	click("conflict-refresh");
	await settle();
	click("conflict-resolve");
	await settle();
	expect(resolve).toHaveBeenCalledWith("reviewed");
	expect(root.renderer.findByTestId("conflict-error")).toBeDefined();
	resolve.mockClear();
	click("conflict-use-theirs");
	await settle();
	expect(resolve).not.toHaveBeenCalled();
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Current edits to this file will be lost."
	);
	click("conflict-confirm-side");
	await settle();
	expect(resolve).toHaveBeenCalledWith("reviewed", "theirs", "theirs-blob");
});

it.each([
	{ width: 1000, height: 700, appearance: "light" as const },
	{ width: 640, height: 420, appearance: "light" as const },
	{ width: 1000, height: 700, appearance: "dark" as const },
])(
	"keeps conflict groups and version controls usable at $width × $height in $appearance",
	async ({ width, height, appearance }) => {
		root.unmount();
		root = createTestRoot({
			width,
			height,
			onKeyDown: windowOptions.onKeyDown,
		});
		root.renderer.clockPause();
		const snapshot = {
			...repositorySnapshot([
				changedFile("docs/notes.md"),
				changedFile("src/settings.ts", {
					recordType: "unmerged",
					worktreeStatus: "unmerged",
				}),
			]),
			operationState: "merge" as const,
			operationToken: "merge-token",
		};

		root.render(
			<App
				initialSession={{
					version: 1,
					appearance,
					activeId: "workspace-1",
					tabs: [
						{
							id: "workspace-1",
							path: "/test/project",
							draft: "Retained draft",
						},
					],
				}}
				readRepository={async () => ({ ok: true, value: snapshot })}
				readDiff={async () => ({
					ok: true,
					value: [
						{
							target: "working",
							patch: "",
							stats: [],
							message: null,
							conflict: {
								text: 'export const settings = {\n<<<<<<< HEAD\n  theme: "light",\n=======\n  theme: "dark",\n>>>>>>> other\n};\n',
								hash: "reviewed",
								ours: {
									text: 'export const settings = {\n  theme: "light",\n};\n',
									label: "Current · main",
									revision: "ours-blob",
								},
								theirs: {
									text: 'export const settings = {\n  theme: "dark",\n};\n',
									label: "Incoming · a1b2c3d",
									revision: "theirs-blob",
								},
							},
						},
					],
				})}
			/>
		);
		await settle();
		click("entry-src/settings.ts");
		await settle();
		expect(root.renderer.getAllText()).toContain("Conflicts · 1");
		expect(root.renderer.getAllText()).toContain("Other changes · 1");
		expect(
			root.renderer.findByTestId("include-src/settings.ts")
		).toBeUndefined();
		expect(root.renderer.findByTestId("include-all")).toBeUndefined();
		expect(root.renderer.findByTestId("commit-message")).toBeUndefined();
		expect(root.renderer.findByTestId("changes-file-layout")).toBeUndefined();
		expect(
			root.renderer.getAllText().filter((value) => value === "Unresolved")
		).toHaveLength(1);

		for (const id of [
			"conflict-content",
			"conflict-source-header",
			"conflict-result-header",
			"conflict-resolve",
			"conflict-open-editor",
		]) {
			const node = root.renderer.findByTestId(id);
			const bounds = node && root.renderer.getElementBounds(node.id);

			expect(bounds, id).toBeDefined();
			expect(bounds?.height, id).toBeGreaterThan(16);
			expect(
				(bounds?.y ?? height) + (bounds?.height ?? 0),
				id
			).toBeLessThanOrEqual(height);
			expect(
				(bounds?.x ?? width) + (bounds?.width ?? 0),
				id
			).toBeLessThanOrEqual(width);
		}

		const screenshot = process.env.GPUIX_CONFLICT_PREVIEW_SCREENSHOT;

		if (screenshot)
			root.renderer.captureScreenshot(
				screenshot.replace(/\.png$/, `-${width}-${appearance}.png`)
			);
	}
);

it("expands aligned hunk context and scrolls both columns without changing the working result", async () => {
	const lines = Array.from({ length: 120 }, (_, index) => `line ${index}`);

	const text = [
		...lines.slice(0, 80),
		"<<<<<<< HEAD",
		lines[80],
		"=======",
		"incoming",
		">>>>>>> other",
		...lines.slice(81),
	].join("\n");

	const resolve = mock(async () => null);
	const refresh = mock(() => {});

	root.render(
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width: "100%",
				height: 300,
			}}
		>
			<RepositoryConflictPreview
				root="/test"
				path="file.txt"
				preview={{
					text,
					hash: "reviewed",
					ours: {
						text: lines.join("\n"),
						label: "Current · main",
						revision: "ours-blob",
					},
				}}
				disabled={false}
				onResolve={resolve}
				onRefresh={refresh}
			/>
		</div>
	);
	await settle();
	const viewport = root.renderer.findByTestId("conflict-content-content");
	const bounds = viewport && root.renderer.getElementBounds(viewport.id);

	if (!viewport || !bounds)
		throw new Error("Missing native comparison viewport.");

	expect(viewport.customProps?.patch).not.toContain(" line 60\n");
	root.renderer.nativeSimulateClick(bounds.x + 24, bounds.y + 13);
	await settle();
	expect(
		root.renderer.findByTestId("conflict-content-content")?.customProps?.patch
	).toContain(" line 60\n");
	root.renderer.nativeSimulateScrollWheel(
		bounds.x + 40,
		bounds.y + 40,
		0,
		-200
	);
	await settle();
	expect(root.renderer.getScrollOffset(viewport.id)?.[1]).toBeLessThan(-50);
	expect(root.renderer.findByTestId("conflict-content-content")?.id).toBe(
		viewport.id
	);
	expect(root.renderer.getAllText()).toContain("1 conflict block · unresolved");
	expect(refresh).not.toHaveBeenCalled();
	expect(resolve).not.toHaveBeenCalled();
});

it("can refresh an unsupported conflict preview after editing externally", async () => {
	const refresh = mock(() => {});

	const open = mock(async () => {
		throw new Error("Editor unavailable.");
	});

	root.render(
		<RepositoryConflictPreview
			root="/test"
			path="file.txt"
			message="Preview unavailable."
			disabled={false}
			openEditor={open}
			onRefresh={refresh}
		/>
	);
	await settle();
	click("conflict-open-editor");
	await settle();
	expect(root.renderer.getAllText()).toContain("Editor unavailable.");
	click("conflict-refresh");
	expect(refresh).toHaveBeenCalledTimes(1);
});

it("keeps whole-file confirmation pinned to the version shown when it opened", async () => {
	const resolve = mock(
		async () => "The indexed version changed. Refresh before choosing it."
	);

	const show = (hash: string, revision: string) =>
		root.render(
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					width: "100%",
					height: "100%",
				}}
			>
				<RepositoryConflictPreview
					root="/test"
					path="file.txt"
					disabled={false}
					preview={{
						hash,
						text: "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> upstream\n",
						ours: { label: "Current · main", text: "ours\n", revision },
					}}
					onResolve={resolve}
					onRefresh={() => {}}
				/>
			</div>
		);

	show("reviewed", "old-blob");
	await settle();
	click("conflict-use-ours");
	await settle();
	show("updated", "new-blob");
	await settle();
	expect(resolve).not.toHaveBeenCalled();
	click("conflict-confirm-side");
	await settle();
	expect(resolve).toHaveBeenCalledWith("reviewed", "ours", "old-blob");
	expect(root.renderer.getAllText().join(" ")).toContain(
		"The indexed version changed."
	);
});

it("locks closing and duplicate writes until resolution and refresh finish", async () => {
	let blocked = false;
	let resolved = false;

	Object.assign(root.renderer, {
		setCloseBlocked(value: boolean) {
			blocked = value;
		},
		takeCloseRequested() {
			return false;
		},
	});
	const pending =
		Promise.withResolvers<
			Awaited<ReturnType<typeof RepositoryConflicts.write>>
		>();

	const write = mock<typeof RepositoryConflicts.write>(() => pending.promise);

	root.render(
		<App
			initialSession={{
				version: 1,
				activeId: "workspace-1",
				tabs: [
					{ id: "workspace-1", path: "/test/project", draft: "Keep draft" },
				],
			}}
			readRepository={async () => ({
				ok: true,
				value: repositorySnapshot([
					changedFile("file.txt", {
						recordType: resolved ? "ordinary" : "unmerged",
					}),
				]),
			})}
			readDiff={async () => ({
				ok: true,
				value: [
					{
						target: "working",
						patch: "",
						stats: [],
						message: null,
						conflict: { text: "resolved content", hash: "reviewed" },
					},
				],
			})}
			resolveConflict={write}
		/>
	);

	for (let i = 0; i < 5; i++) await settle();

	click("entry-file.txt");
	await settle();
	click("conflict-resolve");
	await settle();
	expect(blocked).toBe(true);
	expect(write).toHaveBeenCalledTimes(1);
	expect(write.mock.calls[0]?.[1]).toMatchObject({
		path: "file.txt",
		expectedContentHash: "reviewed",
		expectedBranch: "main",
	});
	click("conflict-resolve");
	expect(write).toHaveBeenCalledTimes(1);
	resolved = true;
	pending.resolve({
		ok: true,
		value: repositorySnapshot([changedFile("file.txt")]),
	});

	for (let i = 0; i < 5; i++) await settle();

	expect(blocked).toBe(false);
	expect(root.renderer.findByTestId("conflict-resolve")).toBeUndefined();
	expect(root.renderer.findByTestId("commit-message")?.customProps?.value).toBe(
		"Keep draft"
	);
});
