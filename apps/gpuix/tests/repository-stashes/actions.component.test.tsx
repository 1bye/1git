/**
 * Covers: explicit create/apply/delete UI, cancelled confirmation, captured IDs, busy guards and failures.
 * Real: App, mutation/repository hooks, reducers and native controls/layout.
 * Doubles: repository readers/writers, close bridge; no actual Git or user data.
 * Requires: patched GPUIX/macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import type { RepositoryStashes } from "../../src/feature/repository-workspace/lib/repository-stashes";
import {
	repositorySnapshot,
	changedFile,
} from "../_shared/repository-snapshot";
import { stashList } from "../_shared/stash-list";
import { windowOptions } from "../../src/window-options";

let root: TestRoot;
let blocked: boolean;

beforeEach(() => {
	root = createTestRoot({
		width: 1100,
		height: 760,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	blocked = false;
	Object.assign(root.renderer, {
		setCloseBlocked(value: boolean) {
			blocked = value;
		},
		takeCloseRequested() {
			return false;
		},
	});
});
afterEach(() => root.unmount());

const session = {
	version: 1 as const,
	activeId: "workspace-1",
	tabs: [
		{ id: "workspace-1", path: "/test/project", draft: "Keep this draft" },
	],
};

const node = (id: string) => {
	const value = root.renderer.findByTestId(id);

	if (!value) throw new Error(`Missing ${id}`);

	return value;
};

const click = (id: string) => {
	const bounds = root.renderer.getElementBounds(node(id).id);

	if (!bounds) throw new Error(`Missing bounds ${id}`);

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	root.renderer.flush();
};

const settle = async () => {
	for (let index = 0; index < 5; index++) {
		await Bun.sleep(0);
		root.renderer.flush();
	}
};

const readStashes = async () => ({ ok: true as const, value: stashList() });
const readStashFiles = async () => ({ ok: true as const, value: [] });

it("creates explicitly with optional untracked files, locks the window and preserves the commit draft", async () => {
	const pending =
		Promise.withResolvers<
			Awaited<ReturnType<typeof RepositoryStashes.write>>
		>();

	const write = mock<typeof RepositoryStashes.write>(() => {
		expect(blocked).toBe(true);

		return pending.promise;
	});

	root.render(
		<App
			initialSession={session}
			readRepository={async () => ({
				ok: true,
				value: repositorySnapshot([changedFile("a.ts")]),
			})}
			readStashes={readStashes}
			readStashFiles={readStashFiles}
			writeStash={write}
		/>
	);
	await settle();
	click("stash-create");
	click("stash-cancel");
	expect(write).not.toHaveBeenCalled();
	click("stash-create");
	root.renderer.focusElement(node("stash-message").id);
	root.renderer.simulateKeystrokes("w i p");
	root.renderer.flush();
	click("stash-untracked");
	click("stash-confirm");
	click("stash-confirm");
	expect(write).toHaveBeenCalledTimes(1);
	expect(write.mock.calls[0]?.[1]).toMatchObject({
		kind: "create",
		message: "wip",
		includeUntracked: true,
	});
	expect(blocked).toBe(true);
	click("close-workspace-1");
	expect(root.renderer.findByTestId("workspace-1")).toBeDefined();
	pending.resolve({ ok: true, value: undefined });
	await settle();
	expect(blocked).toBe(false);
	expect(node("view-stashes").customProps?.["aria-selected"]).toBe(true);
	click("view-changes");
	expect(node("commit-message").customProps?.value).toBe("Keep this draft");
});

it("requires deletion confirmation and keeps the reviewed stash ID when selection changes", async () => {
	const write = mock<typeof RepositoryStashes.write>(async () => ({
		ok: true,
		value: undefined,
	}));

	root.render(
		<App
			initialSession={session}
			readRepository={async () => ({ ok: true, value: repositorySnapshot() })}
			readStashes={readStashes}
			readStashFiles={readStashFiles}
			writeStash={write}
		/>
	);
	await settle();
	click("view-stashes");
	await settle();
	click("stash-more");
	click("stash-delete");
	expect(write).not.toHaveBeenCalled();
	click("stash-cancel");
	expect(write).not.toHaveBeenCalled();
	click("stash-more");
	click("stash-delete");
	click(`entry-${stashList()[1]?.oid}`);
	click("stash-confirm");
	await settle();
	expect(write.mock.calls[0]?.[1]).toMatchObject({
		kind: "delete",
		oid: stashList()[0]?.oid,
	});
});

it("applies by immutable ID, surfaces failures and permits a fresh explicit retry", async () => {
	let fail = true;

	const write = mock<typeof RepositoryStashes.write>(async () => {
		if (fail) throw new Error("Simulated failure");

		return { ok: true, value: undefined };
	});

	root.render(
		<App
			initialSession={session}
			readRepository={async () => ({ ok: true, value: repositorySnapshot() })}
			readStashes={readStashes}
			readStashFiles={readStashFiles}
			writeStash={write}
		/>
	);
	await settle();
	click("view-stashes");
	await settle();
	click("stash-apply");
	await settle();
	expect(write.mock.calls[0]?.[1]).toMatchObject({
		kind: "apply",
		oid: stashList()[0]?.oid,
	});
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Could not confirm the stash action"
	);
	expect(blocked).toBe(false);
	fail = false;
	click("stash-apply");
	await settle();
	expect(node("view-changes").customProps?.["aria-selected"]).toBe(true);
});

it("locks sibling worktrees through refresh and blocks writes after a failed refresh", async () => {
	const pending = Promise.withResolvers<void>();
	let written = false;
	const refreshed: string[] = [];

	const write = mock<typeof RepositoryStashes.write>(async () => {
		written = true;

		return { ok: true, value: undefined };
	});

	root.render(
		<App
			initialSession={{
				...session,
				tabs: [
					...session.tabs,
					{ id: "workspace-2", path: "/test/linked", draft: "Other draft" },
				],
			}}
			readRepository={async (path) => {
				if (written) {
					refreshed.push(path);
					await pending.promise;

					throw new Error("Refresh unavailable");
				}

				const snapshot = repositorySnapshot([changedFile("a.ts")]);

				return {
					ok: true,
					value: {
						...snapshot,
						repository: { ...snapshot.repository, root: path },
					},
				};
			}}
			readStashes={readStashes}
			readStashFiles={readStashFiles}
			writeStash={write}
		/>
	);
	await settle();
	click("stash-create");
	click("stash-confirm");
	await settle();
	expect(blocked).toBe(true);
	expect(refreshed.sort()).toEqual(["/test/linked", "/test/project"]);
	click("workspace-2");
	click("stash-create");
	expect(root.renderer.findByTestId("stash-confirm")).toBeUndefined();
	expect(write).toHaveBeenCalledTimes(1);
	pending.resolve();
	await settle();
	expect(blocked).toBe(false);
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Refresh to confirm the repository"
	);
	click("stash-create");
	expect(root.renderer.findByTestId("stash-confirm")).toBeUndefined();
	expect(write).toHaveBeenCalledTimes(1);
});
