/**
 * Covers: immediate close protection, background/concurrent writes, failure, and sync cancellation/refresh.
 * Real: mutation hook, workspace reducers, notice and native UI events/layout.
 * Doubles: Git boundaries and native close-veto bridge; no user repositories.
 * Requires: patched GPUIX renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { useReducer } from "react";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { Button } from "@1git/gpuix-ui/button";
import { useRepositoryMutations } from "../../src/feature/repository-workspace/hooks/use-repository-mutations";
import { RepositoryCloseNotice } from "../../src/feature/repository-workspace/components/repository-close-notice";
import { WorkspaceTabsModel } from "../../src/feature/workspace-tabs/lib/workspace-tabs-model";
import type { RepositoryCommit } from "../../src/feature/repository-workspace/lib/repository-commit";
import type { RepositoryBranches } from "../../src/feature/workspace-tabs/lib/repository-branches";
import type { RepositoryReader } from "../../src/feature/repository-workspace/lib/repository-reader";
import type { RepositorySync } from "../../src/feature/repository-workspace/lib/repository-sync";
import {
	repositorySnapshot,
	changedFile,
} from "../_shared/repository-snapshot";

let root: TestRoot;
let blocked: boolean;
let requested: boolean;

beforeEach(() => {
	root = createTestRoot({ width: 1000, height: 700 });
	root.renderer.clockPause();
	blocked = false;
	requested = false;
	Object.assign(root.renderer, {
		setCloseBlocked(value: boolean) {
			blocked = value;
		},
		takeCloseRequested() {
			const value = requested;

			requested = false;

			return value;
		},
	});
});
afterEach(() => root.unmount());

function Harness({
	write,
	fetch,
	read,
	branch,
	beforeRelease,
}: {
	write?: typeof RepositoryCommit.write;
	fetch?: typeof RepositorySync.fetch;
	read?: typeof RepositoryReader.read;
	branch?: typeof RepositoryBranches.write;
	beforeRelease?: () => void;
}) {
	const [state, dispatch] = useReducer(
		WorkspaceTabsModel.reduce,
		undefined,
		() => {
			let initial = WorkspaceTabsModel.reduce(WorkspaceTabsModel.create(2), {
				type: "auto-include-changes",
				enabled: true,
			});

			for (const id of ["workspace-1", "workspace-2"]) {
				const snapshot = repositorySnapshot([changedFile("a.ts")]);

				initial = WorkspaceTabsModel.reduce(initial, {
					type: "workspace",
					id,
					action: {
						type: "loaded",
						snapshot: {
							...snapshot,
							repository: {
								...snapshot.repository,
								root: `/test/${id}`,
								commonDirectory: `/test/${id}/.git`,
							},
						},
					},
				});
				initial = WorkspaceTabsModel.reduce(initial, {
					type: "workspace",
					id,
					action: { type: "edit-commit-message", value: "Keep draft" },
				});
			}

			return initial;
		}
	);

	const mutations = useRepositoryMutations(
		state,
		dispatch,
		write,
		branch,
		read,
		fetch,
		undefined,
		beforeRelease
	);

	return (
		<div style={{ backgroundColor: "#ffffff", height: "100%" }}>
			<Button
				testId="commit-one"
				onPress={() => {
					void mutations.commit("workspace-1");
				}}
			>
				Commit one
			</Button>
			<Button
				testId="commit-two"
				onPress={() => {
					void mutations.commit("workspace-2");
				}}
			>
				Commit two
			</Button>
			<Button
				testId="fetch"
				onPress={() => {
					void mutations.fetch("workspace-1");
				}}
			>
				Fetch
			</Button>
			<Button
				testId="branch"
				onPress={() => {
					void mutations.changeBranch("workspace-1", {
						kind: "switch",
						name: "next",
					});
				}}
			>
				Switch
			</Button>
			{mutations.closeProtection.requested ? (
				<RepositoryCloseNotice
					state={state}
					onDismiss={mutations.closeProtection.dismiss}
					onStop={mutations.cancelSync}
				/>
			) : null}
		</div>
	);
}

const click = (id: string): void => {
	const node = root.renderer.findByTestId(id);
	const bounds = node && root.renderer.getElementBounds(node.id);

	if (!bounds) throw new Error(`Missing ${id}`);

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	root.renderer.flush();
};

const settle = async () => {
	await Bun.sleep(0);
	root.renderer.flush();
};

const attemptClose = async () => {
	expect(blocked).toBe(true);
	requested = true;
	await Bun.sleep(120);
	root.renderer.flush();
};

it("blocks before writes start, shows background operations and waits for every commit even after failure", async () => {
	const first =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryCommit.write>>>();

	const second =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryCommit.write>>>();

	root.render(
		<Harness
			write={(path) => {
				expect(blocked).toBe(true);

				return path.endsWith("1") ? first.promise : second.promise;
			}}
		/>
	);
	click("commit-one");
	click("commit-two");
	await attemptClose();
	expect(root.renderer.findByTestId("close-protection-notice")).toBeDefined();
	expect(root.renderer.findByTestId("close-stop-workspace-1")).toBeUndefined();
	first.reject(new Error("hook failed"));
	await settle();
	expect(blocked).toBe(true);
	second.reject(new Error("signing failed"));
	await settle();
	expect(blocked).toBe(false);
	expect(root.renderer.getAllText().join(" ")).toContain("Review the results");
});

it("stops sync explicitly but keeps protection until the post-cancel refresh settles", async () => {
	const transfer =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositorySync.fetch>>>();

	const refresh =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryReader.read>>>();

	let signal: AbortSignal | undefined;

	root.render(
		<Harness
			fetch={(_path, abort) => {
				signal = abort;

				return transfer.promise;
			}}
			read={() => refresh.promise}
		/>
	);
	click("fetch");
	await attemptClose();
	click("close-stop-workspace-1");
	expect(signal?.aborted).toBe(true);
	transfer.reject(new Error("aborted"));
	await settle();
	expect(blocked).toBe(true);
	refresh.resolve({ ok: true, value: repositorySnapshot() });
	await settle();
	expect(blocked).toBe(false);
});

it("releases protection after an immediately failing commit", async () => {
	let flushed = false;

	root.render(
		<Harness
			beforeRelease={() => {
				expect(blocked).toBe(true);
				flushed = true;
			}}
			write={async () => {
				expect(blocked).toBe(true);

				throw new Error("immediate failure");
			}}
		/>
	);
	click("commit-one");
	await settle();
	expect(blocked).toBe(false);
	expect(flushed).toBe(true);
});

it("keeps branch changes protected through their refresh and offers no unsafe cancellation", async () => {
	const change =
		Promise.withResolvers<
			Awaited<ReturnType<typeof RepositoryBranches.write>>
		>();

	const refresh =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryReader.read>>>();

	root.render(
		<Harness branch={() => change.promise} read={() => refresh.promise} />
	);
	click("branch");
	await attemptClose();
	expect(root.renderer.getAllText().join(" ")).toContain("Changing branch");
	expect(root.renderer.findByTestId("close-stop-workspace-1")).toBeUndefined();
	change.reject(new Error("checkout failed"));
	await settle();
	expect(blocked).toBe(true);
	refresh.resolve({ ok: true, value: repositorySnapshot() });
	await settle();
	expect(blocked).toBe(false);
});
