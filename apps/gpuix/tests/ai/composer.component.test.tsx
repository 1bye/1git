/**
 * Covers: composer overlays and caret clearance, inline generation, automatic refresh, replacement confirmation, draft retention and commit blocking.
 * Real: native composer, generation lifecycle, workspace reducer and disposable AI settings.
 * Doubles: selected Git reads, inference, last-commit metadata and credential vault.
 * Requires: patched GPUIX renderer and macOS graphics; no network or real credentials.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
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
import { commitTypeColor } from "../../src/feature/repository-workspace/components/commit-type-colors";
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
	let currentAppearance = appearance;

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
					value={{ ...appThemes[currentAppearance], commitTypeBadges: true }}
				>
					<div
						style={{
							width: 320,
							height: 640,
							display: "flex",
							flexDirection: "column",
							justifyContent: "flex-end",
							backgroundColor:
								appThemes[currentAppearance].colors.editorSurface,
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
		setAppearance(next: "light" | "dark") {
			currentAppearance = next;
			render();
		},
		refresh(snapshot: ReturnType<typeof repositorySnapshot>) {
			state = RepositoryWorkspaceModel.reduce(state, {
				type: "loaded",
				snapshot,
				automatic: true,
			});
			render();
		},
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

it.each(["claude-code", "codex"] as const)(
	"generates with %s using its default model and rechecks the selection",
	async (provider) => {
		service.store.save({
			connections: [{ ...configured, provider, model: "" }],
			defaultId: configured.id,
		});
		const generate = spyOn(service.cli, "generate").mockResolvedValue(
			"fix: checked changes"
		);

		const read = spyOn(CommitContext, "read");
		const fixture = composer();

		await settle();
		await press("ai-generate");
		expect(generate).toHaveBeenCalledWith(
			expect.objectContaining({ provider, model: "" }),
			"+selected",
			expect.any(AbortSignal)
		);
		expect(read).toHaveBeenCalledTimes(2);
		expect(node("commit-message").customProps?.value).toBe(
			"fix: checked changes"
		);
		expect(fixture.commit).not.toHaveBeenCalled();
	}
);

it.each(["light", "dark"] as const)(
	"paints the commit type and muted scope parentheses while keeping Unicode editing native (%s)",
	async (appearance) => {
		const message =
			"feat(hello)!: preserve é and café\n\nfix: body stays neutral";

		const fixture = composer(message, appearance);

		await settle();
		const editor = node("commit-message");

		const surface = root.renderer.getElementBounds(
			node("commit-editor-surface").id
		)!;

		const path = join(directory, "prefix.png");
		const color = commitTypeColor(appearance, "feat").color;

		const muted = appThemes[appearance].colors.editorMuted;

		expect(editor.customProps?.textColorRanges).toEqual([
			{ start: 0, end: 4, color },
			{ start: 4, end: 5, color: muted },
			{ start: 10, end: 11, color: muted },
		]);
		expect(editor.customProps?.value).toBe(message);
		root.renderer.nativeSimulateKeystrokes(editor.id, "cmd-up");
		root.renderer.captureScreenshot(path);
		const { data, info } = await sharp(path)
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });

		const scale = info.height / 640;

		const channels = [1, 3, 5].map((offset) =>
			Number.parseInt(color.slice(offset, offset + 2), 16)
		);

		const mutedChannels = [1, 3, 5].map((offset) =>
			Number.parseInt(muted.slice(offset, offset + 2), 16)
		);

		let prefixInk = 0;
		let otherInk = 0;
		let parenthesesInk = 0;

		for (
			let y = Math.ceil((surface.y + 8) * scale);
			y < (surface.y + 88) * scale;
			y++
		) {
			for (
				let x = Math.ceil((surface.x + 8) * scale);
				x < (surface.x + 300) * scale;
				x++
			) {
				const offset = (y * info.width + x) * 4;

				if (
					channels.every(
						(value, channel) => Math.abs(data[offset + channel]! - value) <= 2
					)
				) {
					if (y < (surface.y + 24) * scale && x < (surface.x + 40) * scale)
						prefixInk++;
					else otherInk++;
				}

				if (
					y < (surface.y + 24) * scale &&
					mutedChannels.every(
						(value, channel) => Math.abs(data[offset + channel]! - value) <= 2
					)
				)
					parenthesesInk++;
			}
		}

		expect(prefixInk).toBeGreaterThan(4);
		expect(otherInk).toBe(0);
		expect(parenthesesInk).toBeGreaterThan(4);
		root.renderer.nativeSimulateKeystrokes(editor.id, "cmd-down x");
		await settle();
		expect(node("commit-message").customProps?.value).toBe(`${message}x`);
		fixture.setAppearance(appearance === "light" ? "dark" : "light");
		await settle();
		root.renderer.nativeSimulateKeystrokes(editor.id, "cmd-z");
		await settle();
		expect(node("commit-message").customProps?.value).toBe(message);
		fixture.update({ commitMessage: "feat: keep (summary)\n\n(body)" });
		await settle();
		expect(node("commit-message").customProps?.textColorRanges).toHaveLength(1);
		fixture.update({ commitMessage: "custom: retain a plain prefix" });
		await settle();
		expect(node("commit-message").customProps?.textColorRanges).toBeFalsy();
	}
);

it.each(["light", "dark"] as const)(
	"shows an empty-body guide after a blank line without inserting, selecting or committing it (%s)",
	async (appearance) => {
		const summary = "perf(界🙂): keep native editing";
		const fixture = composer(summary, appearance);

		await settle();
		const editor = node("commit-message");

		root.renderer.nativeSimulateKeystrokes(editor.id, "cmd-down enter");
		await settle();
		expect(root.renderer.getPaintedText()).not.toContain(
			"Description (optional)"
		);
		root.renderer.nativeSimulateKeystrokes(editor.id, "enter");
		await settle();
		expect(root.renderer.getPaintedText()).toContain("Description (optional)");
		expect(node("commit-message").customProps?.value).toBe(`${summary}\n\n`);
		const surface = root.renderer.getElementBounds(
			node("commit-editor-surface").id
		)!;

		const screenshot = process.env.GPUIX_COMMIT_DECORATIONS_SCREENSHOT;

		if (screenshot)
			root.renderer.captureScreenshot(`${screenshot}-${appearance}.png`);

		root.renderer.nativeSimulateClick(
			surface.x + 90,
			surface.y + 8 + 2 * 16 + 8
		);
		root.renderer.simulateKeystrokes("b o d y");
		await settle();
		expect(node("commit-message").customProps?.value).toBe(
			`${summary}\n\nbody`
		);
		expect(root.renderer.getPaintedText()).not.toContain(
			"Description (optional)"
		);
		root.renderer.nativeSimulateKeystrokes(editor.id, "cmd-a r");
		await settle();
		expect(node("commit-message").customProps?.value).toBe("r");
		root.renderer.nativeSimulateKeystrokes(editor.id, "cmd-z");
		await settle();
		expect(node("commit-message").customProps?.value).toBe(
			`${summary}\n\nbody`
		);
		fixture.update({ commitMessage: `${summary}\n\n` });
		await settle();
		const a11y = Object.values(root.renderer.getA11yTree().nodes ?? {}).find(
			(entry) => entry.aria?.label === "Commit message"
		);

		expect(a11y?.aria?.value).toBe(`${summary}\n\n`);
		await press("commit-submit");
		expect(fixture.commit).toHaveBeenCalledTimes(1);
		expect(node("commit-message").customProps?.value).toBe(`${summary}\n\n`);

		for (const message of [
			"",
			"\n\n",
			`${summary}\nbody`,
			`${summary}\n\nbody`,
		]) {
			fixture.update({ commitMessage: message });
			await settle();
			expect(root.renderer.getPaintedText()).not.toContain(
				"Description (optional)"
			);
		}

		fixture.update({ commitMessage: `${summary}\r\n\r\n` });
		await settle();
		expect(root.renderer.getPaintedText()).toContain("Description (optional)");
		expect(node("commit-message").customProps?.value).toBe(
			`${summary}\r\n\r\n`
		);
	}
);

it.each(["light", "dark"] as const)(
	"paints text into the lower editor area instead of reserving an empty action strip (%s)",
	async (appearance) => {
		composer(
			Array.from({ length: 12 }, () => "Visible text").join("\n"),
			appearance
		);
		await settle();
		root.renderer.nativeSimulateKeystrokes(node("commit-message").id, "cmd-up");

		const surface = root.renderer.getElementBounds(
			node("commit-editor-surface").id
		)!;

		const path = join(directory, "full-viewport.png");

		root.renderer.captureScreenshot(path);
		const { data, info } = await sharp(path)
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });

		const scale = info.height / 640;
		let ink = 0;

		// Sixth row: below the old five-row clip, above the opaque end of the fade.
		for (
			let y = Math.ceil((surface.y + 88) * scale);
			y < (surface.y + 104) * scale;
			y++
		) {
			const background =
				(y * info.width + Math.floor((surface.x + 2) * scale)) * 4;

			for (
				let x = Math.ceil((surface.x + 8) * scale);
				x < (surface.x + 80) * scale;
				x++
			) {
				const offset = (y * info.width + x) * 4;

				const difference =
					Math.abs(data[offset]! - data[background]!) +
					Math.abs(data[offset + 1]! - data[background + 1]!) +
					Math.abs(data[offset + 2]! - data[background + 2]!);

				if (difference > 60) ink++;
			}
		}

		expect(ink).toBeGreaterThan(20);

		if (process.env.GPUIX_COMPOSER_OVERLAY_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_COMPOSER_OVERLAY_SCREENSHOT}-full-${appearance}.png`
			);
	}
);

it.each(["light", "dark"] as const)(
	"overlays actions with 10px insets and keeps the final line editable above them (%s)",
	async (appearance) => {
		const message = Array.from({ length: 20 }, (_, index) =>
			index === 19
				? "Last line"
				: `Detail ${index + 1}: ${"Long details wrap within the editor. ".repeat(3)}`
		).join("\n");

		composer(message, appearance);
		await settle();
		const surface = root.renderer.getElementBounds(
			node("commit-editor-surface").id
		)!;

		const actions = root.renderer.getElementBounds(node("commit-actions").id)!;
		const editor = node("commit-message");

		expect(actions.x + actions.width).toBe(surface.x + surface.width - 10);
		expect(actions.y + actions.height).toBe(surface.y + surface.height - 10);
		expect(editor.parentId).toBe(node("commit-editor-surface").id);
		expect(node("commit-actions-fade").style).toMatchObject({
			pointerEvents: "none",
			background: { type: "linear-gradient", angle: 180 },
		});
		await press("commit-submit");
		// The soft fade must not turn the empty editor area into a dead strip.
		root.renderer.nativeSimulateClick(
			surface.x + 20,
			surface.y + surface.height - 20
		);
		root.renderer.flush();
		expect(root.renderer.getFocusedElementId()).toBe(editor.id);
		// Caret clearance follows the overlay, without shrinking the painted viewport.
		const lastLineY = actions.y - 16;

		expect(lastLineY + 8).toBeLessThan(actions.y);
		root.renderer.nativeSimulateClick(surface.x + 200, lastLineY);
		root.renderer.flush();
		expect(root.renderer.getFocusedElementId()).toBe(editor.id);
		root.renderer.simulateKeystrokes("x enter z");
		await settle();
		expect(node("commit-message").customProps?.value).toBe(`${message}x\nz`);
		const screenshot = process.env.GPUIX_COMPOSER_OVERLAY_SCREENSHOT;

		if (screenshot)
			root.renderer.captureScreenshot(`${screenshot}-${appearance}.png`);

		root.renderer.nativeSimulateKeystrokes(editor.id, "cmd-up");
		root.renderer.nativeSimulateScrollWheel(
			surface.x + 20,
			lastLineY,
			0,
			-10000
		);
		root.renderer.nativeSimulateClick(surface.x + 200, lastLineY);
		root.renderer.simulateKeystrokes("q");
		await settle();
		expect(node("commit-message").customProps?.value).toBe(`${message}x\nzq`);
	}
);

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

it.each([
	["reading", false],
	["generating", false],
	["checking", false],
	["generating", true],
] as const)(
	"survives an unchanged automatic refresh of 133 files while %s (partial: %s)",
	async (phase, partial) => {
		const completion = Promise.withResolvers<string>();
		let signal: AbortSignal | undefined;

		const wait = async (_input: unknown, captured: AbortSignal) => {
			signal = captured;

			return await completion.promise;
		};

		const read = spyOn(CommitContext, "read");

		const generate = spyOn(service, "generate").mockResolvedValue(
			"fix: selected changes"
		);

		if (phase === "reading") read.mockImplementationOnce(wait);

		if (phase === "checking")
			read.mockResolvedValueOnce("+selected").mockImplementationOnce(wait);

		if (phase === "generating")
			generate.mockImplementationOnce(
				async (_preferences, _patch, captured) => {
					signal = captured;

					return await completion.promise;
				}
			);

		const snapshot = repositorySnapshot(
			Array.from({ length: 133 }, (_, index) => changedFile(`file-${index}.ts`))
		);

		const fixture = composer();

		const loaded = RepositoryWorkspaceModel.reduce(
			RepositoryWorkspaceModel.create(),
			{
				type: "loaded",
				snapshot,
			}
		);

		fixture.update(
			partial
				? RepositoryWorkspaceModel.reduce(loaded, {
						type: "include-lines",
						id: "file-0.ts",
						expectedPatch: "+selected",
						includedLines: ["+:1"],
						total: 2,
					})
				: RepositoryWorkspaceModel.reduce(loaded, {
						type: "include-all",
						included: true,
					})
		);
		await settle();
		await press("ai-generate");
		fixture.refresh(snapshot);
		await settle();

		expect(signal?.aborted).toBe(false);
		expect(node("commit-message").customProps?.readOnly).toBe(true);
		completion.resolve(
			phase === "generating" ? "fix: selected changes" : "+selected"
		);
		await settle();

		expect(node("commit-message").customProps?.value).toBe(
			"fix: selected changes"
		);
		expect(root.renderer.findByTestId("ai-commit-status")).toBeUndefined();
	}
);

it("keeps a provider failure visible after an unchanged automatic refresh", async () => {
	spyOn(service, "generate").mockRejectedValue(
		new Error("Provider unavailable. Try again.")
	);
	const fixture = composer();

	await settle();
	await press("ai-generate");
	fixture.refresh(
		repositorySnapshot([
			changedFile("selected.ts"),
			changedFile("unchecked.ts"),
		])
	);
	await settle();

	expect(root.renderer.getAllText()).toContain(
		"Provider unavailable. Try again."
	);
	expect(node("ai-commit-status").customProps?.role).toBe("alert");
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
