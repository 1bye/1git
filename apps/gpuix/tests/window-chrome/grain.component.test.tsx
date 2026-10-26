/**
 * Covers: bounded grain memory, matching the original pixels on colored/neutral chrome, clean content, input passthrough and cached resizing.
 * Real: AppShell, repository palettes, Sharp decoding, native GPUIX image rendering and screenshot pixels.
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
import {
	chromeGrainImages,
	chromeGrainSource,
} from "../../src/fixture/chrome-grain";

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

it("bounds both decoded grain textures to 8 MiB together", async () => {
	let decodedBytes = 0;

	for (const source of Object.values(chromeGrainImages)) {
		const bytes = Buffer.from(source.slice(source.indexOf(",") + 1), "base64");
		const metadata = await sharp(bytes).metadata();

		decodedBytes +=
			(metadata.width ?? Infinity) * (metadata.height ?? Infinity) * 4;
	}

	expect(decodedBytes).toBeGreaterThan(0);
	expect(decodedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
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
	["dark", 981, 657, "#a478ef"],
	["light", 997, 733, undefined],
	["dark", 640, 920, undefined],
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

				// Recreate the previous full-size bitmap independently of the tiled implementation.
				const { data, info } = await sharp(Buffer.from(chromeGrainSource), {
					density: (4000 / 2048) * 72,
				})
					.ensureAlpha()
					.raw()
					.toBuffer({ resolveWithObject: true });

				if (appearance === "dark")
					for (let offset = 0; offset < data.length; offset += 4) {
						data[offset] = 255;
						data[offset + 1] = 255;
						data[offset + 2] = 255;
					}

				const original = await sharp(data, { raw: info })
					.toColourspace("b-w")
					.webp({ lossless: true, exact: true })
					.toBuffer();

				const referenceId = Number.MAX_SAFE_INTEGER;
				const imageId = referenceId - 1;

				current.renderer.applyBatch(
					JSON.stringify([
						["createElement", referenceId, "div"],
						["createElement", imageId, "img"],
						[
							"setCustomProp",
							imageId,
							"src",
							`data:image/webp;base64,${original.toString("base64")}`,
						],
						[
							"setStyle",
							referenceId,
							{
								position: "absolute",
								top: 0,
								left: 0,
								width: "100%",
								height: "100%",
								display: "flex",
								flexDirection: "column",
								justifyContent: "center",
								overflowX: "hidden",
								overflowY: "hidden",
								opacity: appearance === "dark" ? 0.12 : 0.09,
								pointerEvents: "none",
							},
						],
						[
							"setStyle",
							imageId,
							{ width: "100%", flexShrink: 0, pointerEvents: "none" },
						],
						["appendChild", referenceId, imageId],
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
		let maximumPixelDifference = 0;

		for (let offset = 0; offset < textured.data.length; offset++)
			maximumPixelDifference = Math.max(
				maximumPixelDifference,
				Math.abs((textured.data[offset] ?? 0) - (original.data[offset] ?? 0))
			);

		// Native layout rounds fractional tile boundaries independently. Integral
		// bounds retain the same pixels; every size must retain grain strength/coverage.
		if (width % 4 === 0) expect(maximumPixelDifference).toBeLessThanOrEqual(1);

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

		const sampleX = height > width ? 8 : 48;
		const sampleWidth = height > width ? 32 : width - 96;
		const sampleY = Math.max(8, (height - width) / 2 + 8);

		for (let y = sampleY * scale; y < (sampleY + 48) * scale; y++) {
			for (let x = sampleX * scale; x < (sampleX + sampleWidth) * scale; x++) {
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
		expect(Math.abs(total - originalTotal) / count).toBeLessThan(0.05);
		expect(Math.abs(changed - originalChanged) / count).toBeLessThan(0.02);

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
