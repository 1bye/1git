/**
 * Covers: whole-list header actions, filters/inclusion independence, discard confirmation, busy/unsupported guards and errors.
 * Real: App, workspace mutations, native header and keyboard/pointer routing.
 * Doubles: repository reads/writes, accounts and AppKit menus/confirmation; no user files are discarded.
 * Requires: patched GPUIX renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import {
	RepositoryFileActions,
	type FileDiscardRequest,
} from "../../src/feature/repository-workspace/lib/repository-file-actions";
import { RepositoryChangesHeader } from "../../src/feature/repository-workspace/components/repository-changes-header";
import { RepositoryCommit } from "../../src/feature/repository-workspace/lib/repository-commit";
import {
	RepositoryWorkspaceModel as Model,
	type RepositoryWorkspaceState,
} from "../../src/feature/repository-workspace/lib/repository-workspace-model";
import { windowOptions } from "../../src/window-options";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";
import { commitInfo } from "../_shared/history-page";

let root: TestRoot;
let choice: string;
let confirmed: boolean;
let labels: string[];
let enabled: boolean[];
let accounts: Accounts;
let confirmation: ReturnType<typeof mock<(label: string) => boolean>>;

beforeEach(() => {
	root = createTestRoot({
		width: 980,
		height: 640,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	choice = "Discard all changes…";
	confirmed = false;
	labels = [];
	enabled = [];
	confirmation = mock(() => confirmed);
	accounts = new Accounts(
		new AccountStore("/unused/changes-header-accounts.json"),
		{
			async read() {
				return null;
			},
			async write() {
				throw new Error("Unexpected write");
			},
			async delete() {
				throw new Error("Unexpected deletion");
			},
		}
	);
	spyOn(accounts, "load").mockReturnValue([]);
	spyOn(RepositoryCommit, "readLast").mockResolvedValue({
		ok: true,
		value: { commit: commitInfo(), undoUnavailableReason: null },
	});
	Object.assign(root.renderer, {
		showContextMenuItems(items: string[], available: boolean[]) {
			labels = items;
			enabled = available;

			return items.indexOf(choice);
		},
		confirmFileDiscard: confirmation,
	});
});
afterEach(() => {
	root.unmount();
	mock.restore();
});

async function settle(): Promise<void> {
	for (let index = 0; index < 5; index++) {
		await Bun.sleep(0);
		root.renderer.flush();
	}

	root.renderer.clockFastForward(250);
	root.renderer.flush();
}
function node(id: string) {
	const result = root.renderer.findByTestId(id);

	if (!result) throw new Error(`Missing ${id}`);

	return result;
}
async function click(id: string, button = 0, modifiers = ""): Promise<void> {
	const box = root.renderer.getElementBounds(node(id).id);

	if (!box) throw new Error(`Missing bounds ${id}`);

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2,
		button,
		modifiers
	);
	await settle();
}

it("confirms all changed files, including unchecked/filtered files, then refreshes without losing the draft", async () => {
	const files = [
		changedFile("a.txt", { indexStatus: "modified" }),
		changedFile("b.txt"),
		changedFile("new.txt", {
			recordType: "untracked",
			worktreeStatus: "untracked",
		}),
	];

	const read = mock(async () => ({
		ok: true as const,
		value: repositorySnapshot(files),
	}));

	const discard = mock<typeof RepositoryFileActions.discard>(async () => {
		read.mockResolvedValue({ ok: true, value: repositorySnapshot() });

		return {
			ok: true,
			value: repositorySnapshot(),
			recoveryDirectory: "/test/recovery",
		};
	});

	root.render(
		<App
			accounts={accounts}
			initialSession={{
				version: 1,
				activeId: "workspace-1",
				tabs: [
					{ id: "workspace-1", path: "/test/project", draft: "Keep draft" },
				],
			}}
			readRepository={read}
			discardFile={discard}
			readDiff={async () => ({ ok: true, value: [] })}
		/>
	);
	await settle();
	await click("include-b.txt");
	await click("filter-changes");
	root.renderer.simulateKeystrokes("a . t x t");
	await settle();
	expect(root.renderer.findByTestId("entry-b.txt")).toBeUndefined();
	await click("repository-heading", 2);
	expect(labels).toContain("Discard all changes…");
	expect(enabled[labels.indexOf("Discard all changes…")]).toBe(true);
	expect(confirmation).toHaveBeenCalledWith("all 3 changed files");
	expect(discard).not.toHaveBeenCalled();
	confirmed = true;
	await click("repository-heading", 0, "ctrl");
	expect(discard).toHaveBeenCalledTimes(1);
	expect(discard).toHaveBeenCalledWith("/test/project", {
		kind: "discard",
		paths: ["a.txt", "b.txt", "new.txt"],
		expectedHead: "1234567890abcdef",
		expectedBranch: "main",
	});
	expect(node("commit-message").customProps?.value).toBe("Keep draft");
	expect(node("repository-heading").customProps?.["aria-label"]).toBe(
		"0 of 0 selected"
	);
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Recovery backup saved."
	);
});

it("opens with a click or keyboard and includes/excludes the entire list rather than just matching rows", async () => {
	root.render(
		<App
			accounts={accounts}
			initialSession={{
				version: 1,
				activeId: "workspace-1",
				tabs: [{ id: "workspace-1", path: "/test/project", draft: "" }],
			}}
			readRepository={async () => ({
				ok: true,
				value: repositorySnapshot([changedFile("a.txt"), changedFile("b.txt")]),
			})}
		/>
	);
	await settle();
	choice = "Exclude all files from commit";
	await click("repository-heading");
	expect(node("include-all").customProps?.["aria-checked"]).toBe(false);
	choice = "Include all files in commit";
	root.renderer.nativeSimulateKeyDown(
		node("repository-heading").id,
		"shift-f10"
	);
	await settle();
	expect(node("include-all").customProps?.["aria-checked"]).toBe(true);
	choice = "dismiss";
	await click("repository-heading", 2);
	expect(confirmation).not.toHaveBeenCalled();
});

it.each(["header", "file"] as const)(
	"shows a failed %s discard only once and retains the draft and checked files",
	async (source) => {
		const message = 'Non-regular file "a.txt" requires external Git handling.';

		const discard = mock<typeof RepositoryFileActions.discard>(async () => ({
			ok: false,
			error: {
				code: "invalid-input",
				message,
				operation: "discard-files",
				retryable: false,
			},
		}));

		root.render(
			<App
				accounts={accounts}
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
						changedFile("a.txt"),
						changedFile("b.txt"),
					]),
				})}
				discardFile={discard}
				readDiff={async () => ({ ok: true, value: [] })}
			/>
		);
		await settle();
		await click("include-a.txt");
		confirmed = true;
		choice = source === "header" ? "Discard all changes…" : "Discard Changes…";
		await click(source === "header" ? "repository-heading" : "entry-a.txt", 2);

		expect(discard).toHaveBeenCalledTimes(1);
		expect(
			root.renderer.getAllText().filter((text) => text === message)
		).toHaveLength(1);
		expect(node("operation-result").customProps?.role).toBe("alert");
		expect(root.renderer.findByTestId("changes-menu-error")).toBeUndefined();
		expect(node("commit-message").customProps?.value).toBe("Keep draft");
		expect(node("include-b.txt").customProps?.["aria-checked"]).toBe(false);

		const screenshot = process.env.GPUIX_DISCARD_ERROR_SCREENSHOT;

		if (screenshot && source === "header")
			root.renderer.captureScreenshot(screenshot);
	}
);

it("offers a saved recovery folder even when discard fails after backup creation", async () => {
	const directory = "/test/recovery";
	const message = `Discard failed. Recovery backup saved at ${directory}.`;

	const reveal = spyOn(
		RepositoryFileActions,
		"revealRecovery"
	).mockResolvedValue();

	root.render(
		<App
			accounts={accounts}
			initialSession={{
				version: 1,
				activeId: "workspace-1",
				tabs: [
					{ id: "workspace-1", path: "/test/project", draft: "Keep draft" },
				],
			}}
			readRepository={async () => ({
				ok: true,
				value: repositorySnapshot([changedFile("a.txt")]),
			})}
			discardFile={async () => ({
				ok: false,
				recoveryDirectory: directory,
				error: {
					code: "command-failed",
					message,
					operation: "discard-files",
					retryable: false,
				},
			})}
		/>
	);
	await settle();
	confirmed = true;
	await click("repository-heading", 2);
	expect(
		root.renderer.getAllText().filter((text) => text === message)
	).toHaveLength(1);
	await click("show-recovery-backup");
	expect(reveal).toHaveBeenCalledWith(directory);
	expect(node("commit-message").customProps?.value).toBe("Keep draft");
});

it("keeps partial selections intact when a discard is cancelled or fails", async () => {
	let state = Model.reduce(Model.create(), {
		type: "loaded",
		snapshot: repositorySnapshot([changedFile("a.txt"), changedFile("b.txt")]),
	});

	state = Model.reduce(state, {
		type: "include-lines",
		id: "a.txt",
		expectedPatch: "reviewed patch",
		includedLines: ["+:1"],
		total: 2,
	});
	const discard = mock(async () => "Backup failed. No files changed.");
	const action = mock(() => {});

	root.render(
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width: 310,
				height: 200,
			}}
		>
			<RepositoryChangesHeader
				state={state}
				onAction={action}
				onDiscard={discard}
			/>
		</div>
	);
	await settle();
	await click("repository-heading", 2);
	expect(discard).not.toHaveBeenCalled();
	confirmed = true;
	await click("repository-heading", 2);
	expect(discard).toHaveBeenCalledWith({
		kind: "discard",
		paths: ["a.txt", "b.txt"],
		expectedHead: "1234567890abcdef",
		expectedBranch: "main",
	});
	expect(action).not.toHaveBeenCalled();
	expect(node("changes-menu-error")).toBeDefined();
	expect(node("include-all").customProps?.["aria-checked"]).toBe("mixed");
});

it("passes every path in a large change list as one confirmed batch", async () => {
	const files = Array.from({ length: 1148 }, (_, index) =>
		changedFile(`apps/gpuix/build/Frameworks/file-${index}.pak`)
	);

	const state = Model.reduce(Model.create(), {
		type: "loaded",
		snapshot: repositorySnapshot(files),
	});

	const discard = mock(async (_request: FileDiscardRequest) => null);

	root.render(
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width: 310,
				height: 200,
			}}
		>
			<RepositoryChangesHeader
				state={state}
				onAction={() => {}}
				onDiscard={discard}
			/>
		</div>
	);
	await settle();
	confirmed = true;
	await click("repository-heading", 2);
	expect(confirmation).toHaveBeenCalledWith("all 1148 changed files");
	expect(discard).toHaveBeenCalledTimes(1);
	expect(discard.mock.calls[0]?.[0]).toMatchObject({
		paths: files.map((file) => file.path),
	});
});

it("disables discard for stale/busy/preview states and any unsupported path, without silently discarding a subset", async () => {
	const initial = Model.reduce(Model.create(), {
		type: "loaded",
		snapshot: repositorySnapshot([changedFile("a.txt")]),
	});

	const discard = mock(async () => null);

	const cases: RepositoryWorkspaceState[] = [
		{ ...initial, preview: true },
		{ ...initial, loading: true },
		{ ...initial, error: "Stale" },
		{ ...initial, commit: { ...initial.commit, needsReview: true } },
		Model.reduce(initial, { type: "operation-started" }),
		Model.reduce(Model.create(), {
			type: "loaded",
			snapshot: {
				...repositorySnapshot([changedFile("a.txt")]),
				operationState: "merge",
			},
		}),
		...[
			changedFile("renamed.txt", { originalPath: "before.txt" }),
			changedFile("module", { submodule: "S.M." }),
			changedFile("conflict.txt", { recordType: "unmerged" }),
			changedFile("type.txt", { indexStatus: "type-changed" }),
		].map((file) =>
			Model.reduce(Model.create(), {
				type: "loaded",
				snapshot: repositorySnapshot([changedFile("a.txt"), file]),
			})
		),
	];

	confirmed = true;

	for (const state of cases) {
		root.render(
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					width: 310,
					height: 200,
				}}
			>
				<RepositoryChangesHeader
					state={state}
					onAction={() => {}}
					onDiscard={discard}
				/>
			</div>
		);
		await settle();
		await click("repository-heading", 2);
		expect(enabled[labels.indexOf("Discard all changes…")]).toBe(false);
	}

	expect(confirmation).not.toHaveBeenCalled();
	expect(discard).not.toHaveBeenCalled();
});
