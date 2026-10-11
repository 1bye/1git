/**
 * Covers: Stashes-only creation, action-row layout, anchored forms/focus, captured IDs, busy guards and failures.
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
import { RepositoryWorkspaceModel as Model } from "../../src/feature/repository-workspace/lib/repository-workspace-model";
import { RepositoryStashActions } from "../../src/feature/repository-workspace/components/repository-stash-actions";

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
	root.renderer.clockFastForward(200);
	root.renderer.flush();
	root.renderer.advanceTime(1);
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

it.each([
	{ width: 1100, height: 760 },
	{ width: 640, height: 480 },
])(
	"keeps stash actions on one row above the files pane at $width × $height",
	async ({ width, height }) => {
		root.unmount();
		root = createTestRoot({
			width,
			height,
			onKeyDown: windowOptions.onKeyDown,
		});
		root.renderer.clockPause();
		root.render(
			<App
				initialSession={session}
				readRepository={async () => ({
					ok: true,
					value: repositorySnapshot([changedFile("a.ts")]),
				})}
				readStashes={readStashes}
				readStashFiles={readStashFiles}
			/>
		);
		await settle();
		click("view-stashes");
		await settle();
		const before = root.renderer.getElementBounds(node("revision-divider").id);
		const button = root.renderer.getElementBounds(node("stash-create").id);
		const apply = root.renderer.getElementBounds(node("stash-apply").id);
		const more = root.renderer.getElementBounds(node("stash-more").id);

		if (!before || !button || !apply || !more)
			throw new Error("Missing stash pane layout");

		expect(apply.y).toBe(button.y);
		expect(more.y).toBe(button.y);
		expect(more.x + more.width).toBeLessThan(button.x);
		expect(button.y + button.height).toBeLessThanOrEqual(before.y);
		expect(button.y + button.height).toBeGreaterThanOrEqual(before.y - 12);
		expect(button.x).toBeGreaterThan(before.x + before.width / 2);
		expect(button.x + button.width).toBeLessThanOrEqual(
			before.x + before.width
		);
		expect(node("stash-create").style.backgroundColor).toBe("#406bde");

		if (process.env.GPUIX_STASH_LAYOUT_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_STASH_LAYOUT_SCREENSHOT}-${width}.png`
			);

		click("stash-create");
		await Bun.sleep(150);
		root.renderer.flush();
		expect(root.renderer.getElementBounds(node("revision-divider").id)).toEqual(
			before
		);
		const form = root.renderer.getElementBounds(node("popover-content").id);

		if (!form) throw new Error("Missing popover");

		expect(form.y + form.height).toBeLessThanOrEqual(button.y);
		click("stash-cancel");
		click("stash-more");
		await Bun.sleep(150);
		root.renderer.flush();
		expect(root.renderer.getElementBounds(node("revision-divider").id)).toEqual(
			before
		);
		expect(root.renderer.getElementBounds(node("stash-create").id)).toEqual(
			button
		);
		expect(root.renderer.getElementBounds(node("stash-apply").id)).toEqual(
			apply
		);
		click("stash-delete");
		await Bun.sleep(150);
		root.renderer.flush();
		expect(root.renderer.getElementBounds(node("revision-divider").id)).toEqual(
			before
		);
		expect(root.renderer.getElementBounds(node("stash-create").id)).toEqual(
			button
		);
		expect(root.renderer.getElementBounds(node("stash-apply").id)).toEqual(
			apply
		);
		const confirmation = root.renderer.getElementBounds(
			node("stash-confirm").id
		);

		if (!confirmation) throw new Error("Missing stash confirmation layout");

		expect(root.renderer.getFocusedElementId()).toBe(node("stash-cancel").id);
		expect(confirmation.x).toBeGreaterThanOrEqual(0);
		expect(confirmation.x + confirmation.width).toBeLessThanOrEqual(width);
		expect(confirmation.y + confirmation.height).toBeLessThanOrEqual(height);

		if (process.env.GPUIX_STASH_LAYOUT_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_STASH_LAYOUT_SCREENSHOT}-confirmation-${width}.png`
			);

		click("stash-cancel");
		await settle();
		expect(root.renderer.getFocusedElementId()).toBe(node("stash-more").id);
	}
);

it("creates only from Stashes with optional untracked files, locks the window and preserves the commit draft", async () => {
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
	expect(root.renderer.findByTestId("stash-create")).toBeUndefined();
	expect(node("commit-message").customProps?.value).toBe("Keep this draft");
	click("view-stashes");
	await settle();
	click("stash-create");
	click("stash-cancel");
	await settle();
	expect(root.renderer.findByTestId("popover-content")).toBeUndefined();
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
	root.renderer.clockFastForward(200);
	root.renderer.flush();
	root.renderer.advanceTime(1);
	await settle();
	expect(root.renderer.findByTestId("popover-content")).toBeUndefined();
	expect(node("view-stashes").customProps?.["aria-selected"]).toBe(true);
	click("view-changes");
	await settle();
	expect(node("commit-message").customProps?.value).toBe("Keep this draft");
	expect(root.renderer.findByTestId("stash-create")).toBeUndefined();
});

it("keeps New stash at the right above the files divider when there is no saved stash", async () => {
	root.render(
		<App
			initialSession={session}
			readRepository={async () => ({ ok: true, value: repositorySnapshot() })}
			readStashes={async () => ({ ok: true, value: [] })}
			readStashFiles={readStashFiles}
		/>
	);
	await settle();
	click("view-stashes");
	await settle();
	const divider = root.renderer.getElementBounds(node("revision-divider").id);
	const create = root.renderer.getElementBounds(node("stash-create").id);

	if (!divider || !create) throw new Error("Missing empty stash layout");

	expect(root.renderer.findByTestId("stash-apply")).toBeUndefined();
	expect(root.renderer.findByTestId("stash-more")).toBeUndefined();
	expect(create.x).toBeGreaterThan(divider.x + divider.width / 2);
	expect(create.y + create.height).toBeLessThanOrEqual(divider.y);
	expect(create.y + create.height).toBeGreaterThanOrEqual(divider.y - 12);
});

it("requires deletion confirmation and permits cancelling before explicitly deleting", async () => {
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
	click("stash-confirm");
	await settle();
	expect(write.mock.calls[0]?.[1]).toMatchObject({
		kind: "delete",
		oid: stashList()[0]?.oid,
	});
});

it("keeps the reviewed stash ID if the selection changes while confirming deletion", async () => {
	const snapshot = repositorySnapshot();
	const stashes = stashList();
	let state = Model.reduce(Model.create(), { type: "loaded", snapshot });

	state = Model.reduce(state, {
		type: "stashes-loaded",
		root: snapshot.repository.root,
		generation: state.stashes.generation,
		stashes,
	});

	const write = mock(async () => true);

	const render = () =>
		root.render(
			<RepositoryStashActions
				state={state}
				placement="selection"
				onWrite={write}
			/>
		);

	render();
	click("stash-more");
	click("stash-delete");
	state = Model.reduce(state, {
		type: "select",
		view: "stashes",
		id: stashes[1]?.oid ?? "",
	});
	render();
	click("stash-confirm");
	await settle();
	expect(write).toHaveBeenCalledWith(
		expect.objectContaining({ kind: "delete", oid: stashes[0]?.oid })
	);
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
	const apply = root.renderer.getElementBounds(node("stash-apply").id);
	const create = root.renderer.getElementBounds(node("stash-create").id);
	const divider = root.renderer.getElementBounds(node("revision-divider").id);

	if (!apply || !create || !divider)
		throw new Error("Missing failed stash layout");

	expect(apply.y).toBe(create.y);
	expect(apply.x + apply.width).toBeLessThan(create.x);
	expect(create.x + create.width).toBeLessThanOrEqual(
		divider.x + divider.width
	);
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
	click("view-stashes");
	await settle();
	click("stash-create");
	click("stash-confirm");
	await settle();
	expect(blocked).toBe(true);
	expect(refreshed.sort()).toEqual(["/test/linked", "/test/project"]);
	click("workspace-2");
	click("stash-create");
	expect(root.renderer.findByTestId("popover-content")).toBeDefined();
	expect(write).toHaveBeenCalledTimes(1);
	pending.resolve();
	await settle();
	expect(blocked).toBe(false);
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Refresh to confirm the repository"
	);
	click("stash-cancel");
	click("workspace-2");
	click("view-stashes");
	await settle();
	click("stash-create");
	expect(root.renderer.findByTestId("stash-confirm")).toBeUndefined();
	expect(write).toHaveBeenCalledTimes(1);
});
