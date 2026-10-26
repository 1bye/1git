/**
 * Covers: copying full error/hook output, keyboard access, narrow layouts and clipboard feedback.
 * Real: commit process panel, native rendering/input and scrolling.
 * Doubles: captured clipboard writes and commit state; no Git or OS clipboard changes.
 * Requires: patched native addon and macOS graphics access.
 */
import { afterEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { RepositoryCommitProcess } from "../../src/feature/repository-workspace/components/repository-commit-process";
import type { RepositoryWorkspaceState } from "../../src/feature/repository-workspace/lib/repository-workspace-model";
import { NativeClipboard } from "../../src/platform/clipboard";
import { AppThemeContext, appThemes } from "../../src/styles/theme";

const roots: TestRoot[] = [];

afterEach(() => {
	for (const root of roots) root.unmount();

	roots.length = 0;
	mock.restore();
});

function fixture(appearance: "light" | "dark" = "dark") {
	const root = createTestRoot({ width: 310, height: 220 });

	roots.push(root);
	root.renderer.clockPause();
	const node = (id: string) => {
		const element = root.renderer.findByTestId(id);

		if (!element) throw new Error(`Missing ${id}`);

		return element;
	};

	const show = (
		commit: RepositoryWorkspaceState["commit"],
		onCancel = () => {}
	) =>
		root.render(
			<AppThemeContext
				value={{ ...appThemes[appearance], commitTypeBadges: true }}
			>
				<div
					style={{
						width: "100%",
						height: "100%",
						backgroundColor: appThemes[appearance].colors.editorSurface,
						userSelect: "none",
					}}
				>
					<RepositoryCommitProcess commit={commit} onCancel={onCancel} />
				</div>
			</AppThemeContext>
		);

	const pressCopy = () => {
		root.renderer.focusElement(node("commit-output-copy").id);
		root.renderer.simulateKeystrokes("enter");
	};

	const settle = async () => {
		await Bun.sleep(0);
		root.renderer.flush();
	};

	return { root, node, show, pressCopy, settle };
}

it.each([
	["light", false],
	["dark", false],
	["light", true],
	["dark", true],
] as const)(
	"copies full output in %s mode while pending is %s",
	async (appearance, pending) => {
		const { root, node, show, pressCopy, settle } = fixture(appearance);
		const clipboard = spyOn(NativeClipboard, "write").mockResolvedValue();

		const output =
			"$ bun check\n" +
			"Hook output outside the viewport.\n".repeat(100) +
			"Final diagnostic.";

		const error = pending
			? null
			: 'Git operation "commit" failed.\nHook rejected the commit.';

		const cancel = mock(() => {});

		show(
			{
				pending,
				error,
				output,
				notice: null,
				needsReview: false,
				progress: "committing",
			},
			cancel
		);
		const screenshot = process.env.GPUIX_COMMIT_OUTPUT_SCREENSHOT;

		if (screenshot)
			root.renderer.captureScreenshot(
				`${screenshot}-${appearance}-${pending}-before.png`
			);

		root.renderer.scrollTo(node("commit-notice-scroll").id, 0, -100000);
		pressCopy();
		await settle();
		expect(clipboard).toHaveBeenCalledWith(
			error ? `${error}\n\n${output}` : output
		);
		expect(node("commit-output-copy").customProps?.["aria-description"]).toBe(
			"Copied to clipboard"
		);
		const button = root.renderer.getElementBounds(
			node("commit-output-copy").id
		)!;

		const log = root.renderer.getElementBounds(
			node("commit-notice-scroll").id
		)!;

		expect(button.x).toBeGreaterThanOrEqual(0);
		expect(button.x + button.width).toBeLessThanOrEqual(310);
		expect(button.y + button.height).toBeLessThanOrEqual(log.y);
		expect(log.height).toBeLessThanOrEqual(64);
		root.renderer.nativeSimulateMouseDown(log.x + 2, log.y + log.height - 8);
		root.renderer.nativeSimulateMouseMove(
			log.x + 100,
			log.y + log.height - 8,
			0
		);
		root.renderer.nativeSimulateMouseUp(log.x + 100, log.y + log.height - 8);
		expect(root.renderer.getSelectedText()?.length).toBeGreaterThan(0);

		if (pending) {
			root.renderer.focusElement(node("commit-cancel").id);
			root.renderer.simulateKeystrokes("enter");
			expect(cancel).toHaveBeenCalledTimes(1);
		}

		if (screenshot)
			root.renderer.captureScreenshot(
				`${screenshot}-${appearance}-${pending}.png`
			);
	}
);

it("handles an in-flight copy, changed output and clipboard errors without replacing the Git error", async () => {
	const { root, node, show, pressCopy, settle } = fixture();
	const deferred = Promise.withResolvers<void>();

	const clipboard = spyOn(NativeClipboard, "write").mockReturnValue(
		deferred.promise
	);

	const commit = {
		pending: false,
		error: "Hook rejected.",
		notice: null,
		needsReview: false,
	};

	show(commit);
	pressCopy();
	pressCopy();
	expect(clipboard).toHaveBeenCalledTimes(1);
	deferred.resolve();
	await settle();
	expect(node("commit-output-copy").customProps?.["aria-description"]).toBe(
		"Copied to clipboard"
	);
	show({ ...commit, output: "New diagnostic." });
	expect(node("commit-output-copy").customProps?.["aria-description"]).not.toBe(
		"Copied to clipboard"
	);
	clipboard.mockRejectedValueOnce(new Error("Clipboard unavailable"));
	pressCopy();
	await settle();
	expect(root.renderer.getAllText()).toContain(
		"Could not copy output. Try again."
	);
	expect(root.renderer.getAllText()).toContain(commit.error);
	clipboard.mockResolvedValue();
	pressCopy();
	await settle();
	expect(clipboard).toHaveBeenLastCalledWith(
		"Hook rejected.\n\nNew diagnostic."
	);
	expect(node("commit-output-copy").customProps?.["aria-description"]).toBe(
		"Copied to clipboard"
	);
	expect(root.renderer.getAllText()).not.toContain(
		"Could not copy output. Try again."
	);
	show({
		...commit,
		error: null,
		needsReview: true,
		notice: "Review the commit outcome.",
	});
	pressCopy();
	await settle();
	expect(clipboard).toHaveBeenLastCalledWith("Review the commit outcome.");
	show({ ...commit, error: null });
	expect(root.renderer.findByTestId("commit-output-copy")).toBeUndefined();
});
