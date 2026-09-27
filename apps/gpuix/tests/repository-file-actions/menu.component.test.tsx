/**
 * Covers: file menu pointer/keyboard entry, copy action and explicit discard confirmation.
 * Real: native GPUIX input routing and file list.
 * Doubles: AppKit menu/confirmation bridge, operating-system actions and Git writes.
 * Requires: patched GPUIX/macOS graphics.
 */
import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { RepositoryList } from "../../src/feature/repository-workspace/components/repository-list";
import { windowOptions } from "../../src/window-options";
import { changedFile } from "../_shared/repository-snapshot";
import { repositorySnapshot } from "../_shared/repository-snapshot";
import { App } from "../../src/app";
import { RepositoryFileActions } from "../../src/feature/repository-workspace/lib/repository-file-actions";
import type { FileMenuActions } from "../../src/feature/repository-workspace/components/repository-file-menu";

let root: TestRoot;
let choice: number;
let confirmed: boolean;
let enabledItems: boolean[];

beforeEach(() => {
	root = createTestRoot({
		width: 800,
		height: 600,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	choice = 2;
	confirmed = false;
	enabledItems = [];
	Object.assign(root.renderer, {
		showContextMenu(_labels: string[], enabled: boolean[]) {
			enabledItems = enabled;

			return choice;
		},
		confirmFileDiscard() {
			return confirmed;
		},
	});
});
afterEach(() => root.unmount());
const settle = async () => {
	await Bun.sleep(150);
	root.renderer.flush();
	root.renderer.clockFastForward(200);
	root.renderer.flush();
	root.renderer.advanceTime(1);
	root.renderer.flush();
};

const click = async (id: string, button = 0, modifiers = "") => {
	const element = root.renderer.findByTestId(id);
	const box = element && root.renderer.getElementBounds(element.id);

	if (!box) throw new Error(`Missing ${id}`);

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2,
		button,
		modifiers
	);
	await settle();
};

const render = (actions: FileMenuActions) =>
	root.render(
		<div style={{ backgroundColor: "#ffffff", width: "100%", height: "100%" }}>
			<div style={{ width: 310, height: 400 }}>
				<RepositoryList
					entries={[
						{
							id: "a.txt",
							title: "a.txt",
							status: "M",
							change: changedFile("a.txt"),
						},
					]}
					label="Changes"
					emptyMessage="Empty"
					state={{ selectedId: "a.txt", scrollY: 0 }}
					onSelect={() => {}}
					onScroll={() => {}}
					fileActions={actions}
				/>
			</div>
		</div>
	);

it("opens by right click and copies the relative path without Git writes", async () => {
	const open = mock(async () => {});
	const discard = mock(async () => null);

	render({
		root: "/test",
		head: "head",
		branch: "main",
		disabled: false,
		canDiscard: true,
		open,
		discard,
	});
	await settle();
	await click("entry-a.txt", 2);
	expect(root.renderer.findByTestId("file-menu-a.txt")).toBeUndefined();
	expect(open).toHaveBeenCalledWith("/test", "a.txt", "copy");
	expect(discard).not.toHaveBeenCalled();
});

it("keeps multi-selection separate from inclusion and targets the right-clicked group", async () => {
	const discard = mock<typeof RepositoryFileActions.discard>(async () => {
		throw new Error("Test only");
	});

	root.render(
		<App
			initialSession={{
				version: 1,
				activeId: "workspace-1",
				tabs: [{ id: "workspace-1", path: "/test", draft: "" }],
			}}
			readRepository={async () => ({
				ok: true,
				value: repositorySnapshot([
					changedFile("a.txt"),
					changedFile("b.txt"),
					changedFile("c.txt"),
				]),
			})}
			discardFile={discard}
		/>
	);
	await settle();
	await click("entry-a.txt");
	await click("entry-c.txt", 0, "shift");
	choice = 3;
	confirmed = true;
	await click("entry-b.txt", 2);
	expect(discard.mock.calls[0]?.[1].paths).toEqual(["a.txt", "b.txt", "c.txt"]);
	await click("entry-b.txt", 0, "cmd");
	await click("entry-a.txt", 2);
	expect(discard.mock.calls[1]?.[1].paths).toEqual(["a.txt", "c.txt"]);
	await click("entry-b.txt", 2);
	expect(discard.mock.calls[2]?.[1].paths).toEqual(["b.txt"]);
});

it("requires a separate confirmation and captures the reviewed branch", async () => {
	choice = 3;
	const discard = mock(async () => null);

	render({
		root: "/test",
		head: "head",
		branch: "main",
		disabled: false,
		canDiscard: true,
		discard,
	});
	await settle();
	await click("entry-a.txt", 2);
	expect(discard).not.toHaveBeenCalled();
	confirmed = true;
	await click("entry-a.txt", 2);
	expect(discard).toHaveBeenCalledWith({
		kind: "discard",
		paths: ["a.txt"],
		expectedHead: "head",
		expectedBranch: "main",
	});
});

it("supports Control-click and does nothing when the native menu is dismissed", async () => {
	const open = mock(async () => {});
	const discard = mock(async () => null);

	render({
		root: "/test",
		head: "head",
		branch: "main",
		disabled: false,
		canDiscard: true,
		open,
		discard,
	});
	await settle();
	const row = root.renderer.findByTestId("entry-a.txt");
	const bounds = row && root.renderer.getElementBounds(row.id);

	if (!bounds) throw new Error("Missing row");

	root.renderer.nativeSimulateClick(bounds.x + 8, bounds.y + 8, 0, "ctrl");
	await settle();
	expect(open).toHaveBeenCalledTimes(1);
	choice = -1;
	await click("entry-a.txt", 2);
	expect(open).toHaveBeenCalledTimes(1);
	expect(discard).not.toHaveBeenCalled();
});

it("opens from the keyboard and keeps discard disabled during Git operations", async () => {
	choice = 3;
	confirmed = true;
	const discard = mock(async () => null);

	render({
		root: "/test",
		head: "head",
		branch: "main",
		disabled: false,
		canDiscard: false,
		discard,
	});
	await settle();
	const row = root.renderer.findByTestId("entry-a.txt");

	if (!row) throw new Error("Missing row");

	root.renderer.focusElement(row.id);
	root.renderer.nativeSimulateKeyDown(row.id, "shift-f10");
	await settle();
	expect(enabledItems).toEqual([true, true, true, false, false, false]);
	expect(discard).not.toHaveBeenCalled();
});

it("protects close until discard refresh completes and retains the draft", async () => {
	choice = 3;
	confirmed = true;
	let blocked = false;
	let finished = false;

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
			Awaited<ReturnType<typeof RepositoryFileActions.discard>>
		>();

	const refresh = Promise.withResolvers<{
		ok: true;
		value: ReturnType<typeof repositorySnapshot>;
	}>();

	const discard = mock<typeof RepositoryFileActions.discard>(
		() => pending.promise
	);

	root.render(
		<App
			initialSession={{
				version: 1,
				activeId: "workspace-1",
				tabs: [{ id: "workspace-1", path: "/test", draft: "Keep draft" }],
			}}
			readRepository={async () =>
				finished
					? await refresh.promise
					: { ok: true, value: repositorySnapshot([changedFile("a.txt")]) }
			}
			discardFile={discard}
		/>
	);
	await settle();
	// Locate the real Changes row; its id is owned by the workspace model.
	const row = root.renderer.findByTestId("entry-a.txt");

	if (!row) throw new Error("Missing file action trigger");

	const bounds = root.renderer.getElementBounds(row.id);

	if (!bounds) throw new Error("Missing file action bounds");

	root.renderer.nativeSimulateClick(bounds.x + 5, bounds.y + 5, 2);
	await settle();
	expect(blocked).toBe(true);
	expect(discard).toHaveBeenCalledTimes(1);
	finished = true;
	pending.resolve({
		ok: true,
		value: repositorySnapshot(),
		recoveryDirectory: "/test/backup",
	});
	await settle();
	expect(blocked).toBe(true);
	refresh.resolve({ ok: true, value: repositorySnapshot() });
	await settle();
	expect(blocked).toBe(false);
	expect(root.renderer.findByTestId("operation-result")).toBeDefined();
	expect(root.renderer.findByTestId("commit-message")?.customProps?.value).toBe(
		"Keep draft"
	);
});
