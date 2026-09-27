/**
 * Covers: operation strip, disabled continuation, captured abort confirmation, pending locks and refresh failures.
 * Real: App, reducers, mutation lifecycle and native GPUIX controls.
 * Doubles: Git read/write boundary and native close notifications.
 * Requires: patched GPUIX/macOS graphics; no actual Git writes.
 */
import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import type { RepositorySnapshot } from "@1git/git";
import { App } from "../../src/app";
import { windowOptions } from "../../src/window-options";
import { RepositoryOperation } from "../../src/feature/repository-workspace/lib/repository-operation";
import {
	repositorySnapshot,
	changedFile,
} from "../_shared/repository-snapshot";

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
	tabs: [{ id: "workspace-1", path: "/test/project", draft: "Keep draft" }],
};

const snapshot = (conflicts = false): RepositorySnapshot => ({
	...repositorySnapshot(
		conflicts
			? [
					changedFile("a.txt", {
						recordType: "unmerged",
						worktreeStatus: "unmerged",
					}),
				]
			: []
	),
	operationState: "merge",
	operationToken: "reviewed-operation",
});

const settle = async () => {
	for (let i = 0; i < 5; i++) {
		await Bun.sleep(10);
		root.renderer.flush();
	}
};

const click = (id: string) => {
	const node = root.renderer.findByTestId(id);
	const bounds = node && root.renderer.getElementBounds(node.id);

	if (!bounds) throw new Error(`Missing ${id}`);

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

it("requires abort confirmation and never continues with unresolved conflicts", async () => {
	const write = mock<typeof RepositoryOperation.write>(async () => ({
		ok: true,
		value: repositorySnapshot(),
	}));

	root.render(
		<App
			initialSession={session}
			readRepository={async () => ({ ok: true, value: snapshot(true) })}
			writeOperation={write}
		/>
	);
	await settle();
	click("operation-continue");
	expect(write).not.toHaveBeenCalled();
	click("operation-abort");
	await Bun.sleep(150);
	root.renderer.flush();
	expect(write).not.toHaveBeenCalled();
	click("operation-abort-cancel");
	await settle();
	expect(write).not.toHaveBeenCalled();
	click("operation-abort");
	await Bun.sleep(150);
	root.renderer.flush();
	click("operation-abort-confirm");
	await settle();
	expect(write).toHaveBeenCalledTimes(1);
	expect(write.mock.calls[0]?.[1]).toMatchObject({
		kind: "abort",
		expectedOperation: "merge",
		expectedToken: "reviewed-operation",
		expectedHead: "1234567890abcdef",
		expectedBranch: "main",
	});
});

it("protects the window through continuation and refresh, retaining drafts", async () => {
	let finished = false;

	const pending =
		Promise.withResolvers<
			Awaited<ReturnType<typeof RepositoryOperation.write>>
		>();

	const refresh = Promise.withResolvers<{
		ok: true;
		value: RepositorySnapshot;
	}>();

	const write = mock<typeof RepositoryOperation.write>(() => pending.promise);

	root.render(
		<App
			initialSession={session}
			readRepository={async () =>
				finished ? await refresh.promise : { ok: true, value: snapshot() }
			}
			writeOperation={write}
		/>
	);
	await settle();
	click("operation-continue");
	await settle();
	expect(blocked).toBe(true);
	click("operation-continue");
	expect(write).toHaveBeenCalledTimes(1);
	finished = true;
	pending.resolve({ ok: true, value: repositorySnapshot() });
	await settle();
	expect(blocked).toBe(true);
	refresh.resolve({ ok: true, value: repositorySnapshot() });
	await settle();
	expect(blocked).toBe(false);
	expect(root.renderer.findByTestId("operation-continue")).toBeUndefined();
	expect(root.renderer.findByTestId("operation-result")).toBeDefined();
	expect(root.renderer.findByTestId("commit-message")?.customProps?.value).toBe(
		"Keep draft"
	);
});

it("reports failure and blocks retry when post-operation status cannot be read", async () => {
	let finished = false;

	const failure = {
		ok: false as const,
		error: {
			code: "command-failed" as const,
			operation: "continue-merge" as const,
			message: "Hook failed",
			retryable: false,
		},
	};

	const write = mock<typeof RepositoryOperation.write>(async () => {
		finished = true;

		return failure;
	});

	root.render(
		<App
			initialSession={session}
			readRepository={async () =>
				finished ? failure : { ok: true, value: snapshot() }
			}
			writeOperation={write}
		/>
	);
	await settle();
	click("operation-continue");
	await settle();
	expect(blocked).toBe(false);
	expect(root.renderer.findByTestId("operation-result")).toBeDefined();
	expect(root.renderer.findByTestId("repository-notice")).toBeDefined();
	click("operation-continue");
	expect(write).toHaveBeenCalledTimes(1);
});
