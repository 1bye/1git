/**
 * Covers: theme blending, interrupted switches, disabling motion and retained mounted content.
 * Real: AppShell, theme hook, React and native rendering.
 * Doubles: explicit in-memory themes; no user settings or Git reads/writes.
 * Requires: patched native addon and macOS graphics access.
 */
import { afterEach, expect, it } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { AppShell } from "../../src/fixture/app-shell";
import {
	AppThemeContext,
	appThemes,
	useAppTheme,
} from "../../src/styles/theme";
import type { AppAppearance } from "../../src/styles/tokens";

let root: TestRoot | undefined;

afterEach(() => {
	root?.unmount();
	root = undefined;
});

function Probe() {
	const { tokens } = useAppTheme();

	return (
		<text testId="palette-text" style={{ color: tokens.colors.text }}>
			Retained content
		</text>
	);
}

function show(appearance: AppAppearance, smoothTransitions = true): TestRoot {
	root ??= createTestRoot({ width: 800, height: 600 });
	root.render(
		<AppThemeContext
			value={{
				...appThemes[appearance],
				commitTypeBadges: true,
				smoothTransitions,
			}}
		>
			<AppShell toolbar={null} workspaceLabel="Transition test">
				<Probe />
			</AppShell>
		</AppThemeContext>
	);

	return root;
}

function surface(testRoot: TestRoot): string | undefined {
	const color =
		testRoot.renderer.findByTestId("workspace")?.style.backgroundColor;

	return typeof color === "string" ? color : undefined;
}

it("shows intermediate background and text colors without remounting content", async () => {
	const testRoot = show("light");
	const text = testRoot.renderer.findByTestId("palette-text");

	show("dark");
	expect(surface(testRoot)).toBe(appThemes.light.colors.editorSurface);
	await Bun.sleep(65);
	testRoot.renderer.flush();
	const intermediate = surface(testRoot);

	expect(intermediate).not.toBe(appThemes.light.colors.editorSurface);
	expect(intermediate).not.toBe(appThemes.dark.colors.editorSurface);
	expect(testRoot.renderer.findByTestId("palette-text")?.style.color).not.toBe(
		appThemes.dark.tokens.colors.text
	);
	await Bun.sleep(220);
	testRoot.renderer.flush();
	expect(surface(testRoot)).toBe(appThemes.dark.colors.editorSurface);
	expect(testRoot.renderer.findByTestId("palette-text")?.style.color).toBe(
		appThemes.dark.tokens.colors.text
	);
	expect(testRoot.renderer.findByTestId("palette-text")?.id).toBe(text?.id);
});

it("continues a reversed transition from its visible colors and snaps when disabled", async () => {
	const testRoot = show("light");

	show("dark");
	await Bun.sleep(65);
	testRoot.renderer.flush();
	const intermediate = surface(testRoot);

	show("light");
	expect(surface(testRoot)).toBe(intermediate);
	await Bun.sleep(40);
	testRoot.renderer.flush();
	expect(surface(testRoot)).not.toBe(intermediate);
	show("dark", false);
	expect(surface(testRoot)).toBe(appThemes.dark.colors.editorSurface);
	await Bun.sleep(220);
	testRoot.renderer.flush();
	expect(surface(testRoot)).toBe(appThemes.dark.colors.editorSurface);
});
