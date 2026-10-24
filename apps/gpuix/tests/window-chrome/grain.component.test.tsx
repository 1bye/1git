/**
 * Covers: visible, restrained grain on colored and neutral chrome; clean content, input passthrough and cached rendering during resize.
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
import { chromeGrainSource } from "../../src/fixture/chrome-grain";

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
	["light", 980, 640, "#a478ef"],
	["dark", 980, 640, "#a478ef"],
	["light", 1440, 900, "#a478ef"],
	["dark", 1440, 900, "#a478ef"],
	["light", 980, 640, undefined],
	["dark", 980, 640, undefined],
	["light", 1440, 900, undefined],
	["dark", 1440, 900, undefined],
] as const)(
	"paints visible grain only on chrome (%s, %d × %d, color=%s)",
	async (appearance, width, height, color) => {
		root = createTestRoot({ width, height });
		const current = root;
		const palette = RepositoryTheme.create(appThemes[appearance], color);

		const render = async (grain: "image" | "plain" | "original") => {
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
			const layer = current.renderer.findByTestId("repository-chrome-grain");

			if (!layer) throw new Error("Missing chrome grain");

			// Hide only the grain for a baseline with the same palette and layout.
			if (grain !== "image")
				current.renderer.applyBatch(
					JSON.stringify([
						["setStyle", layer.id, { ...layer.style, opacity: 0 }],
					])
				);

			if (grain === "original") {
				if (layer.parentId === null) throw new Error("Missing grain parent");

				// Insert the old mask at the same paint order, above the chrome tint.
				const referenceId = Number.MAX_SAFE_INTEGER;

				current.renderer.applyBatch(
					JSON.stringify([
						["createElement", referenceId, "svg"],
						["setCustomProp", referenceId, "source", chromeGrainSource],
						[
							"setStyle",
							referenceId,
							{
								position: "absolute",
								top: 0,
								left: 0,
								width: "100%",
								height: "100%",
								opacity: appearance === "dark" ? 0.12 : 0.09,
								color: appearance === "dark" ? "#ffffff" : "#000000",
							},
						],
						["insertBefore", layer.parentId, referenceId, layer.id],
					])
				);
			}

			const path = join(directory, `${grain}.png`);

			current.renderer.captureScreenshot(path);

			if (grain !== "plain" && process.env.GPUIX_GRAIN_SCREENSHOT)
				current.renderer.captureScreenshot(
					`${process.env.GPUIX_GRAIN_SCREENSHOT}-${grain}-${appearance}-${width}-${color ?? "neutral"}.png`
				);

			return await sharp(path)
				.ensureAlpha()
				.raw()
				.toBuffer({ resolveWithObject: true });
		};

		const textured = await render("image");
		const plain = await render("plain");
		const original = await render("original");
		const scale = plain.info.width / width;

		const delta = (x: number, y: number, image = textured): number => {
			const offset = (y * plain.info.width + x) * 4;

			return Math.max(
				...[0, 1, 2].map((channel) =>
					Math.abs(
						(plain.data[offset + channel] ?? 0) -
							(image.data[offset + channel] ?? 0)
					)
				)
			);
		};

		let changed = 0;
		let total = 0;
		let maximum = 0;
		let count = 0;
		let originalTotal = 0;
		let originalChanged = 0;

		for (let y = 8 * scale; y < 56 * scale; y++) {
			for (let x = 48 * scale; x < (width - 48) * scale; x++) {
				const difference = delta(x, y);

				if (difference >= 2) changed++;

				total += difference;
				maximum = Math.max(maximum, difference);
				const originalDifference = delta(x, y, original);

				originalTotal += originalDifference;

				if (originalDifference >= 2) originalChanged++;

				count++;
			}
		}

		process.stdout.write(
			`Grain ${appearance} ${width} ${color ?? "neutral"}: visible=${(changed / count).toFixed(3)} mean=${(total / count).toFixed(2)} max=${maximum}\n`
		);
		expect(changed / count).toBeGreaterThan(0.12);
		expect(total / count).toBeGreaterThan(1.5);
		expect(total / count).toBeLessThan(8);
		expect(maximum).toBeGreaterThan(3);
		expect(maximum).toBeLessThan(30);
		process.stdout.write(
			`Original grain: visible=${(originalChanged / count).toFixed(3)} mean=${(originalTotal / count).toFixed(2)}\n`
		);
		expect(Math.abs(total - originalTotal) / count).toBeLessThan(0.5);
		expect(Math.abs(changed - originalChanged) / count).toBeLessThan(0.1);

		let contentDifference = 0;

		for (let y = 100 * scale; y < 160 * scale; y++)
			for (let x = 100 * scale; x < 200 * scale; x++)
				contentDifference = Math.max(contentDifference, delta(x, y));

		expect(contentDifference).toBe(0);

		expect(
			current.renderer.findByTestId("repository-chrome-grain")?.style
				.pointerEvents
		).toBe("none");
	},
	20000
);

it("keeps grain rendering within a frame while resizing to uncached widths", () => {
	root = createTestRoot({ width: 1440, height: 900 });
	const current = root;

	const render = (width: number): void => {
		current.render(
			<div style={{ width, height: 640 }}>
				<AppThemeContext value={{ ...appThemes.dark, commitTypeBadges: true }}>
					<AppShell
						workspaceLabel="Resize test"
						toolbar={<div style={{ height: 64, flexShrink: 0 }} />}
					>
						<div style={{ flexGrow: 1 }} />
					</AppShell>
				</AppThemeContext>
			</div>
		);
	};

	// Warm startup assets, then use widths that have never entered the SVG cache.
	render(980);
	const durationsMs: number[] = [];

	for (let frame = 0; frame < 8; frame++) {
		const started = performance.now();

		render(1000 + frame * 13);
		durationsMs.push(performance.now() - started);
	}

	durationsMs.sort((left, right) => left - right);
	const medianMs = durationsMs[Math.floor(durationsMs.length / 2)];

	process.stdout.write(`Grain resize median: ${medianMs?.toFixed(2)} ms\n`);
	expect(medianMs).toBeLessThan(1000 / 60);
});
