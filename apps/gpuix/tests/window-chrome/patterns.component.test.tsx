/**
 * Covers: native illustrated chrome, fixed shared tiles at two window sizes, clean content and input passthrough.
 * Real: AppShell, themes, GPUIX rendering/input and screenshot pixels.
 * Doubles: flat backdrop, toolbar and rail; no real vibrancy, preferences, accounts or Git I/O.
 * Requires: patched native addon and macOS graphics access.
 */
import { afterEach, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { Button } from "@1git/gpuix-ui/button";
import { AppShell } from "../../src/fixture/app-shell";
import { AppThemeContext, appThemes } from "../../src/styles/theme";
import { RepositoryTheme } from "../../src/styles/repository-theme";
import {
	repositoryPatternPresets,
	type RepositoryPattern,
} from "../../src/feature/repository-appearance/repository-patterns";
import {
	repositoryPatternSources,
	repositoryPatternTileSize,
} from "../../src/feature/repository-appearance/pattern-artwork";

let root: TestRoot | undefined;
let directory: string | undefined;

afterEach(async () => {
	root?.unmount();
	root = undefined;

	if (directory) await rm(directory, { recursive: true, force: true });

	directory = undefined;
});

it.each([
	["light", 980, 640],
	["dark", 1440, 900],
] as const)(
	"draws illustrated chrome without changing content or blocking controls (%s, %d × %d)",
	async (appearance, width, height) => {
		directory = await mkdtemp(join(tmpdir(), "1git-patterns-"));
		const current = createTestRoot({ width, height });

		root = current;
		let pressed = 0;
		const palette = RepositoryTheme.create(appThemes[appearance], "#e879a0");

		const render = async (pattern?: RepositoryPattern) => {
			current.render(
				<div
					style={{
						width: "100%",
						height: "100%",
						backgroundColor: appearance === "dark" ? "#304255" : "#c8dcf0",
					}}
				>
					<AppThemeContext
						value={{
							...palette,
							repositoryPattern: pattern,
							commitTypeBadges: true,
						}}
					>
						<AppShell
							workspaceLabel="Pattern test"
							toolbar={
								<div style={{ height: 64, flexShrink: 0 }}>
									<Button
										testId="pattern-control"
										onPress={() => {
											pressed++;
										}}
									>
										Toolbar action
									</Button>
								</div>
							}
							rail={<div style={{ width: 48, flexShrink: 0 }} />}
						>
							<div style={{ flexGrow: 1 }} />
						</AppShell>
					</AppThemeContext>
				</div>
			);
			const path = join(directory ?? "", `${pattern ?? "plain"}.png`);

			current.renderer.captureScreenshot(path);

			return await sharp(path)
				.ensureAlpha()
				.raw()
				.toBuffer({ resolveWithObject: true });
		};

		const plain = await render();

		expect(
			current.renderer.findByTestId("repository-pattern-layer")
		).toBeUndefined();

		for (const preset of repositoryPatternPresets) {
			const patterned = await render(preset.id);
			const first = current.renderer.findByTestId("repository-pattern-tile-0");
			const second = current.renderer.findByTestId("repository-pattern-tile-1");

			expect(first?.customProps?.source).toBe(
				repositoryPatternSources[preset.id]
			);
			expect(second?.customProps?.source).toBe(first?.customProps?.source);
			expect(first?.style.width).toBe(repositoryPatternTileSize);
			expect(first?.style.height).toBe(repositoryPatternTileSize);
			expect(first?.style.pointerEvents).toBe("none");
			expect(
				current.renderer.findByTestId("repository-pattern-layer")?.style
					.pointerEvents
			).toBe("none");

			const scale = plain.info.width / width;

			const difference = (x: number, y: number): number => {
				const offset = (y * plain.info.width + x) * 4;

				return Math.max(
					...[0, 1, 2].map((channel) =>
						Math.abs(
							(plain.data[offset + channel] ?? 0) -
								(patterned.data[offset + channel] ?? 0)
						)
					)
				);
			};

			let changed = 0;

			for (let y = 68 * scale; y < (height - 40) * scale; y++)
				for (let x = 0; x < 46 * scale; x++)
					if (difference(x, y) >= 2) changed++;

			expect(changed).toBeGreaterThan(100);

			for (let y = 12 * scale; y < 30 * scale; y++)
				for (let x = 200 * scale; x < 225 * scale; x++)
					expect(difference(x, y)).toBe(0);

			for (let y = 100 * scale; y < 130 * scale; y++)
				for (let x = 100 * scale; x < 130 * scale; x++)
					expect(difference(x, y)).toBe(0);
		}

		const control = current.renderer.findByTestId("pattern-control");
		const bounds = control && current.renderer.getElementBounds(control.id);

		if (!bounds) throw new Error("Missing toolbar control bounds");

		current.renderer.nativeSimulateClick(
			bounds.x + bounds.width / 2,
			bounds.y + bounds.height / 2
		);
		current.renderer.flush();
		expect(pressed).toBe(1);
	}
);
