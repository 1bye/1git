/**
 * Covers: conflict content, editor activation, explicit resolution and actionable failures.
 * Real: React and native GPUIX controls.
 * Doubles: content reader, editor launcher and Git mutation boundary.
 * Requires: patched GPUIX and macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { RepositoryDiff } from "../../src/feature/repository-workspace/components/repository-diff";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";
import { App } from "../../src/app";
import type { RepositoryConflicts } from "../../src/feature/repository-workspace/lib/repository-conflicts";

let root: TestRoot;

beforeEach(() => {
	root = createTestRoot({ width: 1000, height: 700 });
});
afterEach(() => root.unmount());
const settle = async () => {
	await Bun.sleep(10);
	root.renderer.flush();
};

const click = (testId: string) => {
	const node = root.renderer.findByTestId(testId);
	const bounds = node && root.renderer.getElementBounds(node.id);

	if (!bounds) throw new Error(`Missing ${testId}`);

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	root.renderer.flush();
};

it("opens the editor without resolving and surfaces validation failures", async () => {
	const open = mock(async () => {});
	const resolve = mock(async () => "Conflict markers remain.");

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
								text: "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other",
								hash: "reviewed",
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
		root.renderer.findByTestId("conflict-content")?.customProps?.value
	).toContain("<<<<<<< HEAD");
	click("conflict-open-editor");
	await settle();
	expect(open).toHaveBeenCalledWith("/test", "file.txt");
	expect(resolve).not.toHaveBeenCalled();
	click("conflict-resolve");
	await settle();
	expect(resolve).toHaveBeenCalledWith("reviewed");
	expect(root.renderer.findByTestId("conflict-error")).toBeDefined();
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
