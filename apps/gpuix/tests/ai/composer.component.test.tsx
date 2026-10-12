/**
 * Covers: immediate inline generation, replacement confirmation, draft retention, stale selections and commit blocking.
 * Real: native composer, generation lifecycle, workspace reducer and disposable AI settings.
 * Doubles: selected Git reads, inference, last-commit metadata and credential vault.
 * Requires: patched GPUIX renderer and macOS graphics; no network or real credentials.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { AiProvider } from "../../src/feature/ai/ai-provider";
import { AiIntegration } from "../../src/feature/ai/lib/ai-integration";
import {
	AiSettingsStore,
	emptyAiPreferences,
} from "../../src/feature/ai/lib/ai-settings-store";
import { CommitContext } from "../../src/feature/ai/lib/commit-context";
import { RepositoryCommit } from "../../src/feature/repository-workspace/components/repository-commit";
import { RepositoryCommit as CommitReader } from "../../src/feature/repository-workspace/lib/repository-commit";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceState,
} from "../../src/feature/repository-workspace/lib/repository-workspace-model";
import { AppThemeContext, appThemes } from "../../src/styles/theme";
import { windowOptions } from "../../src/window-options";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";

let root: TestRoot;
let directory: string;
let service: AiIntegration;

const configured = {
	...emptyAiPreferences,
	id: "11111111-1111-4111-8111-111111111111",
	label: "Personal",
	provider: "opencode" as const,
	model: "big-pickle",
};

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "1git-ai-composer-"));
	service = new AiIntegration(new AiSettingsStore(join(directory, "ai.json")), {
		read: async () => null,
		write: async () => {},
		delete: async () => {},
	});
	service.store.save({ connections: [configured], defaultId: configured.id });
	spyOn(CommitContext, "read").mockResolvedValue("+selected");
	spyOn(CommitReader, "readLast").mockResolvedValue({
		ok: false,
		error: {
			code: "command-failed",
			operation: "commit",
			message: "No last commit in this fixture",
			retryable: false,
		},
	});
	root = createTestRoot({
		width: 980,
		height: 640,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
});
afterEach(() => {
	root.unmount();
	mock.restore();
	rmSync(directory, { recursive: true, force: true });
});

function node(id: string) {
	const element = root.renderer.findByTestId(id);

	if (!element) throw new Error(`Missing ${id}`);

	return element;
}
async function settle() {
	for (let pass = 0; pass < 5; pass++) {
		await Bun.sleep(0);
		root.renderer.flush();
	}

	root.renderer.clockFastForward(200);
	root.renderer.flush();
	await Bun.sleep(0);
	root.renderer.flush();
}
async function press(id: string) {
	const bounds = root.renderer.getElementBounds(node(id).id)!;

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	root.renderer.flush();
	await settle();
}
function composer(message = "", appearance: "light" | "dark" = "light") {
	let state: RepositoryWorkspaceState = {
		...RepositoryWorkspaceModel.reduce(RepositoryWorkspaceModel.create(), {
			type: "loaded",
			snapshot: repositorySnapshot([
				changedFile("selected.ts"),
				changedFile("unchecked.ts"),
			]),
		}),
		includedFileIds: ["selected.ts"],
		commitMessage: message,
	};

	const commit = mock();
	const settings = mock();

	const render = () =>
		root.render(
			<AiProvider service={service}>
				<AppThemeContext
					value={{ ...appThemes[appearance], commitTypeBadges: true }}
				>
					<div
						style={{
							width: 320,
							height: 640,
							display: "flex",
							flexDirection: "column",
							justifyContent: "flex-end",
							backgroundColor: appThemes[appearance].colors.editorSurface,
						}}
					>
						<RepositoryCommit
							state={state}
							onCommit={commit}
							onAiSettings={settings}
							onAction={(action) => {
								state = RepositoryWorkspaceModel.reduce(state, action);
								render();
							}}
						/>
					</div>
				</AppThemeContext>
			</AiProvider>
		);

	render();

	return {
		commit,
		settings,
		update(patch: Partial<RepositoryWorkspaceState>) {
			state = { ...state, ...patch };
			render();
		},
	};
}

it("starts on the first AI click and places the checked-selection result directly in the editor", async () => {
	const generated = spyOn(service, "generate").mockResolvedValue(
		"fix: checked changes"
	);

	const read = spyOn(CommitContext, "read");
	const fixture = composer();

	await settle();
	await press("ai-generate");

	expect(generated).toHaveBeenCalledTimes(1);
	expect(generated).toHaveBeenCalledWith(
		expect.objectContaining({ id: configured.id, model: configured.model }),
		"+selected",
		expect.any(AbortSignal),
		expect.any(Function)
	);
	expect(read.mock.calls[0]?.[0].includedFileIds).toEqual(["selected.ts"]);
	expect(read).toHaveBeenCalledTimes(2);
	expect(node("commit-message").customProps?.value).toBe(
		"fix: checked changes"
	);
	expect(root.renderer.findByTestId("ai-commit-replace-panel")).toBeUndefined();
	expect(root.renderer.findByTestId("ai-commit-proposal")).toBeUndefined();
	expect(fixture.commit).not.toHaveBeenCalled();
});

it.each(["light", "dark"] as const)(
	"shows progress inside Commit without changing composer height and blocks commit controls (%s)",
	async (appearance) => {
		const completion = Promise.withResolvers<string>();

		spyOn(service, "generate").mockImplementation(
			async (_preferences, _patch, _signal, onProgress) => {
				onProgress?.("Reviewing selected changes · step 2…");

				return await completion.promise;
			}
		);
		const fixture = composer("Original draft", appearance);

		await settle();
		const idleComposer = root.renderer.getElementBounds(
			node("commit-composer").id
		)!;

		const idleEditor = root.renderer.getElementBounds(
			node("commit-message").id
		)!;

		await press("ai-generate");
		await press("ai-commit-replace");

		expect(node("commit-message").customProps?.value).toBe("Original draft");
		expect(node("commit-message").customProps?.readOnly).toBe(true);
		expect(root.renderer.getAllText()).toContain("Reviewing…");
		expect(node("ai-commit-status").customProps?.role).toBe("status");
		expect(node("ai-commit-status").customProps?.["aria-label"]).toBe(
			"Reviewing selected changes · step 2…"
		);
		expect(node("ai-commit-spinner")).toBeDefined();
		await press("commit-submit");
		root.renderer.nativeSimulateKeyDown(node("commit-message").id, "cmd-enter");
		await settle();
		expect(fixture.commit).not.toHaveBeenCalled();
		const status = root.renderer.getElementBounds(node("ai-commit-status").id)!;
		const editor = root.renderer.getElementBounds(node("commit-message").id)!;
		const submit = root.renderer.getElementBounds(node("commit-submit").id)!;

		if (process.env.GPUIX_AI_COMPOSER_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_AI_COMPOSER_SCREENSHOT}-${appearance}.png`
			);

		expect(status.y).toBeGreaterThanOrEqual(submit.y);
		expect(status.y + status.height).toBeLessThanOrEqual(
			submit.y + submit.height
		);
		expect(status.x).toBeGreaterThanOrEqual(submit.x);
		expect(status.x + status.width).toBeLessThanOrEqual(
			submit.x + submit.width
		);
		expect(editor).toEqual(idleEditor);
		expect(
			root.renderer.getElementBounds(node("commit-composer").id)?.height
		).toBe(idleComposer.height);
		expect(submit.x + submit.width).toBeLessThanOrEqual(320);

		completion.resolve("fix: checked changes");
		await settle();
		expect(node("commit-message").customProps?.value).toBe(
			"fix: checked changes"
		);
		expect(root.renderer.getFocusedElementId()).toBe(node("commit-message").id);
		expect(node("commit-message").customProps?.readOnly).toBe(false);
		expect(root.renderer.findByTestId("ai-commit-status")).toBeUndefined();
		await press("commit-submit");
		expect(fixture.commit).toHaveBeenCalledTimes(1);
	}
);

it("requires replacement approval and keeps the draft on Cancel or Escape", async () => {
	const generated = spyOn(service, "generate").mockResolvedValue(
		"fix: replacement"
	);

	composer("Handwritten message");

	await settle();
	await press("ai-generate");
	expect(node("ai-commit-replace-panel")).toBeDefined();
	expect(generated).not.toHaveBeenCalled();
	await press("ai-commit-keep");
	expect(node("commit-message").customProps?.value).toBe("Handwritten message");
	await press("ai-generate");
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(root.renderer.findByTestId("ai-commit-replace-panel")).toBeUndefined();
	expect(generated).not.toHaveBeenCalled();
	await press("ai-generate");
	await press("ai-commit-replace");
	expect(node("commit-message").customProps?.value).toBe("fix: replacement");
});

it("preserves the existing message and displays failures inline", async () => {
	spyOn(service, "generate").mockRejectedValue(
		new Error("Provider unavailable. Try again.")
	);
	composer("Handwritten message");

	await settle();
	await press("ai-generate");
	await press("ai-commit-replace");

	expect(node("commit-message").customProps?.value).toBe("Handwritten message");
	expect(node("commit-message").customProps?.readOnly).toBe(false);
	expect(node("ai-commit-status").customProps?.role).toBe("alert");
	expect(root.renderer.getAllText()).toContain(
		"Provider unavailable. Try again."
	);
});

it.each(["", "Original message"])(
	"cancels immediately, keeps draft %s and ignores a late completion",
	async (original) => {
		const completion = Promise.withResolvers<string>();
		let signal: AbortSignal | undefined;

		spyOn(service, "generate").mockImplementation(
			async (_preferences, _patch, captured) => {
				signal = captured;

				return await completion.promise;
			}
		);
		composer(original);

		await settle();
		await press("ai-generate");

		if (original) await press("ai-commit-replace");

		await press("ai-commit-cancel");

		if (process.env.GPUIX_AI_COMPOSER_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_AI_COMPOSER_SCREENSHOT}-cancel.png`
			);

		expect(signal?.aborted).toBe(true);
		expect(node("commit-message").customProps?.readOnly).toBe(false);
		completion.resolve("Late replacement");
		await settle();
		expect(node("commit-message").customProps?.value).toBe(original);
		expect(root.renderer.findByTestId("ai-commit-status")).toBeUndefined();
	}
);

it("does not replace a draft when selected changes move on disk during generation", async () => {
	spyOn(service, "generate").mockResolvedValue("fix: old changes");
	spyOn(CommitContext, "read")
		.mockResolvedValueOnce("+old")
		.mockResolvedValueOnce("+new");
	composer("Original message");

	await settle();
	await press("ai-generate");
	await press("ai-commit-replace");

	expect(node("commit-message").customProps?.value).toBe("Original message");
	expect(node("ai-commit-status").customProps?.role).toBe("alert");
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Changes on disk have moved"
	);
});

it("preserves the draft when cancelled during the final selection check", async () => {
	const checked = Promise.withResolvers<string>();
	let signal: AbortSignal | undefined;

	spyOn(service, "generate").mockResolvedValue("fix: checked changes");
	spyOn(CommitContext, "read")
		.mockResolvedValueOnce("+selected")
		.mockImplementationOnce(async (_state, captured) => {
			signal = captured;

			return await checked.promise;
		});
	composer("Original message");

	await settle();
	await press("ai-generate");
	await press("ai-commit-replace");
	expect(root.renderer.getAllText()).toContain("Checking changes…");
	await press("ai-commit-cancel");
	checked.resolve("+selected");
	await settle();

	expect(signal?.aborted).toBe(true);
	expect(node("commit-message").customProps?.value).toBe("Original message");
});

it("ignores a cancelled run's late result while a new generation remains active", async () => {
	const first = Promise.withResolvers<string>();
	const second = Promise.withResolvers<string>();

	spyOn(service, "generate")
		.mockImplementationOnce(async () => await first.promise)
		.mockImplementationOnce(async () => await second.promise);
	composer();

	await settle();
	await press("ai-generate");
	await press("ai-commit-cancel");
	await press("ai-generate");
	first.resolve("Late old message");
	await settle();

	expect(node("commit-message").customProps?.value).toBe("");
	expect(node("commit-message").customProps?.readOnly).toBe(true);
	second.resolve("fix: current selection");
	await settle();
	expect(node("commit-message").customProps?.value).toBe(
		"fix: current selection"
	);
});

it("aborts pending generation when the composer unmounts", async () => {
	const completion = Promise.withResolvers<string>();
	let signal: AbortSignal | undefined;

	spyOn(service, "generate").mockImplementation(
		async (_preferences, _patch, captured) => {
			signal = captured;

			return await completion.promise;
		}
	);
	composer();

	await settle();
	await press("ai-generate");
	root.render(null);
	await settle();
	expect(signal?.aborted).toBe(true);
	completion.resolve("Late message");
	await settle();
	expect(root.renderer.findByTestId("commit-message")).toBeUndefined();
});

it.each(["draft", "files", "lines", "branch"])(
	"cancels stale generation after %s changes",
	async (change) => {
		const completion = Promise.withResolvers<string>();
		let signal: AbortSignal | undefined;

		spyOn(service, "generate").mockImplementation(
			async (_preferences, _patch, captured) => {
				signal = captured;

				return await completion.promise;
			}
		);
		const fixture = composer("Original message");

		await settle();
		await press("ai-generate");
		await press("ai-commit-replace");

		if (change === "draft") fixture.update({ commitMessage: "New draft" });

		if (change === "files")
			fixture.update({ includedFileIds: ["unchecked.ts"] });

		if (change === "lines")
			fixture.update({
				partialFiles: {
					"selected.ts": { expectedPatch: "+selected", includedLines: ["+:1"] },
				},
			});

		if (change === "branch") fixture.update({ repository: null });

		await settle();
		completion.resolve("Late replacement");
		await settle();

		expect(signal?.aborted).toBe(true);
		expect(node("commit-message").customProps?.value).toBe(
			change === "draft" ? "New draft" : "Original message"
		);
		expect(root.renderer.findByTestId("ai-commit-status")).toBeUndefined();
	}
);

it("offers AI setup without generating when no default account is selected", async () => {
	service.store.save({ connections: [configured], defaultId: null });
	const generated = spyOn(service, "generate");
	const fixture = composer();

	await settle();
	await press("ai-generate");

	expect(fixture.settings).toHaveBeenCalledTimes(1);
	expect(generated).not.toHaveBeenCalled();
});
