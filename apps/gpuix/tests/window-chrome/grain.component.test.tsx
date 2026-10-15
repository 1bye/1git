/**
 * Covers: visible, restrained grain on colored chrome at different window sizes; clean content and input passthrough.
 * Real: AppShell, repository palettes, GPUIX SVG rasterization and screenshot pixels.
 * Doubles: flat backdrops and empty toolbar/rail; no real blur, accounts, preferences or Git I/O.
 * Requires: patched native addon and macOS graphics access.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { AppShell } from "../../src/fixture/app-shell";
import { AppThemeContext, appThemes } from "../../src/styles/theme";
import { RepositoryTheme } from "../../src/styles/repository-theme";

let directory: string;
let root: TestRoot | undefined;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "1git-grain-"));
});

afterEach(async () => {
	root?.unmount();
	root = undefined;
	await rm(directory, { recursive: true, force: true });
});

it.each([
	["light", 980, 640],
	["dark", 980, 640],
	["light", 1440, 900],
	["dark", 1440, 900],
] as const)(
	"paints visible grain only on chrome (%s, %d × %d)",
	async (appearance, width, height) => {
		root = createTestRoot({ width, height });
		const current = root;
		const palette = RepositoryTheme.create(appThemes[appearance], "#a478ef");

		const render = async (grain: boolean) => {
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
							repositoryColor: grain ? palette.repositoryColor : undefined,
							commitTypeBadges: true,
						}}
					>
						<AppShell
							workspaceLabel="Grain test"
							toolbar={<div style={{ height: 64, flexShrink: 0 }} />}
							rail={<div style={{ width: 48, flexShrink: 0 }} />}
						>
							<div style={{ flexGrow: 1 }} />
						</AppShell>
					</AppThemeContext>
				</div>
			);
			const path = join(directory, `${grain ? "grain" : "plain"}.png`);

			current.renderer.captureScreenshot(path);

			if (grain && process.env.GPUIX_GRAIN_SCREENSHOT)
				current.renderer.captureScreenshot(
					`${process.env.GPUIX_GRAIN_SCREENSHOT}-${appearance}-${width}.png`
				);

			return await sharp(path)
				.ensureAlpha()
				.raw()
				.toBuffer({ resolveWithObject: true });
		};

		const plain = await render(false);
		const textured = await render(true);
		const scale = plain.info.width / width;

		const delta = (x: number, y: number): number => {
			const offset = (y * plain.info.width + x) * 4;

			return Math.max(
				...[0, 1, 2].map((channel) =>
					Math.abs(
						(plain.data[offset + channel] ?? 0) -
							(textured.data[offset + channel] ?? 0)
					)
				)
			);
		};

		let changed = 0;
		let total = 0;
		let maximum = 0;
		let count = 0;

		for (let y = 8 * scale; y < 56 * scale; y++) {
			for (let x = 48 * scale; x < (width - 48) * scale; x++) {
				const difference = delta(x, y);

				if (difference >= 2) changed++;

				total += difference;
				maximum = Math.max(maximum, difference);
				count++;
			}
		}

		process.stdout.write(
			`Grain ${appearance} ${width}: visible=${(changed / count).toFixed(3)} mean=${(total / count).toFixed(2)} max=${maximum}\n`
		);
		expect(changed / count).toBeGreaterThan(0.12);
		expect(total / count).toBeGreaterThan(1.5);
		expect(total / count).toBeLessThan(8);
		expect(maximum).toBeGreaterThan(3);
		expect(maximum).toBeLessThan(30);

		let contentDifference = 0;

		for (let y = 100 * scale; y < 160 * scale; y++)
			for (let x = 100 * scale; x < 200 * scale; x++)
				contentDifference = Math.max(contentDifference, delta(x, y));

		expect(contentDifference).toBe(0);

		expect(
			current.renderer.findByTestId("repository-chrome-grain")?.style
				.pointerEvents
		).toBe("none");
	}
);
