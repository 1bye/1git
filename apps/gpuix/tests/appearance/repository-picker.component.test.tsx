/**
 * Covers: transient native wheel drags, background selection isolation, cancellation, keyboard/numeric color entry and floating editor layout.
 * Real: appearance editor, native diff/image rendering, input, hit testing and palettes.
 * Doubles: in-memory appearance callbacks; no Git or preference writes.
 * Requires: patched native addon and macOS graphics access.
 */
import { afterEach, expect, it } from "bun:test";
import { useState } from "react";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { RepositoryAppearanceEditor } from "../../src/feature/repository-appearance/repository-appearance-editor";
import { AppThemeContext, appThemes } from "../../src/styles/theme";
import { RepositoryTheme } from "../../src/styles/repository-theme";
import type { RepositoryPattern } from "../../src/feature/repository-appearance/repository-patterns";

const roots = new Set<TestRoot>();

const backgroundLines = Array.from(
	{ length: 40 },
	(_, index) =>
		`+const background${index} = "${"selectable text ".repeat(24)}";`
);

const backgroundPatch = `diff --git a/background.ts b/background.ts\n--- a/background.ts\n+++ b/background.ts\n@@ -0,0 +1,40 @@\n${backgroundLines.join("\n")}\n`;

afterEach(() => {
	for (const root of roots) root.unmount();

	roots.clear();
});

function Probe({
	changed,
	appearance = "dark",
}: {
	changed: (color: string | undefined) => void;
	appearance?: "light" | "dark";
}) {
	const [color, setColor] = useState<string | undefined>("#ff0000");
	const [draft, setDraft] = useState<string>();
	const [section, setSection] = useState<"color" | "pattern">("color");

	const [pattern, setPattern] = useState<RepositoryPattern | undefined>(
		"camping"
	);

	return (
		<AppThemeContext
			value={{ ...appThemes[appearance], commitTypeBadges: true }}
		>
			<div
				testId="repository-color-preview"
				style={{
					display: "flex",
					flexDirection: "column",
					width: "100%",
					height: "100%",
					backgroundColor: RepositoryTheme.create(
						appThemes[appearance],
						draft ?? color,
						pattern
					).colors.editorSurface,
				}}
			>
				<diff
					patch={backgroundPatch}
					showFileHeader={false}
					scroll
					theme={{ metrics: { diffLineHeight: 24, diffTextSize: 14 } }}
					style={{ width: "100%", height: "100%", userSelect: "text" }}
				/>
				<RepositoryAppearanceEditor
					name="anyway-design"
					section={section}
					onSectionChange={setSection}
					onPreview={setDraft}
					onDone={() => {}}
					onCancel={() => {}}
					onBack={() => {}}
					color={color}
					pattern={pattern}
					onPatternChange={setPattern}
					onChange={(next) => {
						setColor(next);
						changed(next);
					}}
				/>
			</div>
		</AppThemeContext>
	);
}

async function settle(root: TestRoot) {
	await Bun.sleep(0);
	root.renderer.flush();
}

function node(root: TestRoot, id: string) {
	const element = root.renderer.findByTestId(id);

	if (!element) throw new Error(`Missing ${id}`);

	return element;
}

function bounds(root: TestRoot, id: string) {
	const box = root.renderer.getElementBounds(node(root, id).id);

	if (!box) throw new Error(`Missing bounds for ${id}`);

	return box;
}

async function edit(root: TestRoot, id: string, value: string) {
	root.renderer.scrollIntoView(node(root, id).id);
	root.renderer.flush();
	const box = bounds(root, id);

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2
	);
	root.renderer.simulateKeystrokes("cmd-a");
	root.renderer.simulateKeystrokes([...value].join(" "));
	root.renderer.simulateKeystrokes("enter");
	await settle(root);
}

it("previews a drag locally and commits once even when released outside the wheel", async () => {
	const root = createTestRoot({ width: 1180, height: 850 });

	roots.add(root);
	const changes: (string | undefined)[] = [];

	root.render(<Probe changed={(next) => changes.push(next)} />);
	await settle(root);
	const box = bounds(root, "repository-color-wheel");
	const initial = node(root, "repository-color-preview").style.backgroundColor;

	root.renderer.nativeSimulateMouseDown(
		box.x + box.width / 2,
		box.y + box.height / 2
	);
	await settle(root);
	expect(changes).toEqual([]);
	expect(node(root, "repository-color-preview").style.backgroundColor).not.toBe(
		initial
	);

	root.renderer.nativeSimulateMouseMove(box.x - 30, box.y + box.height / 2, 0);
	root.renderer.nativeSimulateMouseUp(box.x - 30, box.y + box.height / 2);
	await settle(root);
	expect(changes).toEqual(["#00ffff"]);
	expect(root.renderer.findByTestId("repository-color-drag")).toBeUndefined();
});

it.each(["repository-color-wheel", "repository-color-brightness-slider"])(
	"dragging %s does not select the diff underneath or outside the editor",
	async (id) => {
		const root = createTestRoot({ width: 1180, height: 850 });

		roots.add(root);
		const changes: (string | undefined)[] = [];

		root.render(<Probe changed={(next) => changes.push(next)} />);
		await settle(root);
		const box = bounds(root, id);
		const y = box.y + box.height / 2;

		expect(root.renderer.dragSelect(100, y, 400, y + 24)).toBeTruthy();
		root.renderer.clearSelection();
		root.renderer.nativeSimulateMouseDown(box.x + box.width / 2, y);
		await settle(root);
		root.renderer.nativeSimulateMouseMove(box.x + box.width / 4, y + 4, 0);
		await settle(root);
		expect(root.renderer.getSelectedText()).toBeNull();
		root.renderer.nativeSimulateMouseMove(400, y + 24, 0);
		await settle(root);
		expect(root.renderer.getSelectedText()).toBeNull();
		root.renderer.nativeSimulateMouseUp(400, y + 24);
		await settle(root);
		expect(changes).toHaveLength(1);
		expect(root.renderer.getSelectedText()).toBeNull();
	}
);

it("cancels a draft on Escape or focus loss without changing saved color", async () => {
	const root = createTestRoot({ width: 1180, height: 850 });

	roots.add(root);
	const changes: (string | undefined)[] = [];

	root.render(<Probe changed={(next) => changes.push(next)} />);
	await settle(root);
	const initial = node(root, "repository-color-preview").style.backgroundColor;
	const box = bounds(root, "repository-color-wheel");

	for (const cancel of [
		() =>
			root.renderer.nativeSimulateKeyDown(
				node(root, "repository-color-wheel").id,
				"escape"
			),
		() =>
			root.renderer.nativeSimulateKeyDown(
				node(root, "repository-color-custom").id,
				"left"
			),
	]) {
		root.renderer.nativeSimulateMouseDown(
			box.x + box.width / 2,
			box.y + box.height / 2
		);
		await settle(root);
		expect(root.renderer.findByTestId("repository-color-drag")).toBeDefined();
		cancel();
		await Bun.sleep(50);
		await settle(root);
		expect(changes).toEqual([]);
		expect(node(root, "repository-color-preview").style.backgroundColor).toBe(
			initial
		);
		expect(root.renderer.findByTestId("repository-color-drag")).toBeUndefined();
	}
});

it("supports keyboard brightness including black, precise channels and hex Enter", async () => {
	const root = createTestRoot({ width: 1180, height: 850 });

	roots.add(root);
	const changes: (string | undefined)[] = [];

	root.render(<Probe changed={(next) => changes.push(next)} />);
	await settle(root);

	root.renderer.nativeSimulateKeyDown(
		node(root, "repository-color-wheel").id,
		"shift-right"
	);
	await settle(root);
	expect(node(root, "repository-color-hue").customProps?.value).toBe("10");
	root.renderer.nativeSimulateKeyDown(
		node(root, "repository-color-wheel").id,
		"shift-down"
	);
	await settle(root);
	expect(node(root, "repository-color-saturation").customProps?.value).toBe(
		"90"
	);
	root.renderer.nativeSimulateKeyDown(
		node(root, "repository-color-wheel").id,
		"shift-left"
	);
	root.renderer.nativeSimulateKeyDown(
		node(root, "repository-color-wheel").id,
		"shift-up"
	);
	await settle(root);
	expect(changes.at(-1)).toBe("#ff0000");
	root.renderer.nativeSimulateKeyDown(
		node(root, "repository-color-brightness-slider").id,
		"home"
	);
	await settle(root);
	expect(changes.at(-1)).toBe("#000000");
	root.renderer.nativeSimulateKeyDown(
		node(root, "repository-color-brightness-slider").id,
		"end"
	);
	await settle(root);
	expect(changes.at(-1)).toBe("#ff0000");
	await edit(root, "repository-color-hue", "120");
	expect(changes.at(-1)).toBe("#00ff00");
	await edit(root, "repository-color-saturation", "0");
	expect(changes.at(-1)).toBe("#ffffff");
	await edit(root, "repository-color-saturation", "100");
	expect(changes.at(-1)).toBe("#00ff00");
	await edit(root, "repository-color-custom", "#123456");
	expect(changes.at(-1)).toBe("#123456");
});

it.each(["light", "dark"] as const)(
	"fits the floating editor in %s at minimum and large window sizes",
	async (appearance) => {
		for (const [width, height] of [
			[980, 640],
			[1180, 850],
		] as const) {
			const root = createTestRoot({ width, height });

			roots.add(root);
			root.render(<Probe appearance={appearance} changed={() => {}} />);
			await settle(root);

			for (const section of ["color", "pattern"] as const) {
				root.renderer.nativeSimulateKeyDown(
					node(root, `repository-appearance-tab-${section}`).id,
					"enter"
				);
				await settle(root);
				const editor = bounds(root, "repository-appearance-editor");
				const done = bounds(root, "repository-appearance-done");

				expect(editor.x).toBeGreaterThanOrEqual(0);
				expect(editor.y).toBeGreaterThanOrEqual(0);
				expect(editor.x + editor.width).toBeLessThanOrEqual(width);
				expect(editor.y + editor.height).toBeLessThanOrEqual(height);
				expect(done.y + done.height).toBeLessThanOrEqual(height);
			}
		}
	}
);
