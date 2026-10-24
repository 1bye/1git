/**
 * Covers: validated seeds, legacy choices, session round trips and deterministic, varied rail artwork with matching previews.
 * Real: pattern, palette and session models; Sharp SVG rasterization.
 * Doubles: none.
 * Requires: none; no preferences, native windows or Git I/O.
 */
import { expect, it } from "bun:test";
import sharp from "sharp";
import {
	RepositoryPatterns,
	repositoryPatternPresets,
} from "../../src/feature/repository-appearance/repository-patterns";
import {
	RepositoryPatternArtwork,
	repositoryPatternTileSize,
	repositoryPatternTileHeight,
	repositoryPatternCornerOffset,
} from "../../src/feature/repository-appearance/pattern-artwork";
import { WorkspaceSession } from "../../src/feature/workspace-tabs/lib/workspace-session";
import { WorkspaceTabsModel } from "../../src/feature/workspace-tabs/lib/workspace-tabs-model";
import { appThemes } from "../../src/styles/theme";
import { RepositoryTheme } from "../../src/styles/repository-theme";

const tileMotifPattern =
	/<g transform="translate\((-?[\d.]+) [^"]+">(.*?)<\/g>/gu;

it("accepts built-in patterns only and resets just the selected common directory", () => {
	const choices = RepositoryPatterns.parse({
		"/repo/.git": "rose",
		"/other/.git": "cosmic",
		relative: "forest",
		"/nul\0": "seaside",
		"/arbitrary": "file:///secret.svg",
		"/injected": "<svg/>",
	});

	expect(choices).toEqual({ "/repo/.git": "rose", "/other/.git": "cosmic" });
	expect(RepositoryPatterns.set(choices, "/repo/.git", undefined)).toEqual({
		"/other/.git": "cosmic",
	});
	expect(choices["/repo/.git"]).toBe("rose");
	expect(() => RepositoryPatterns.set(choices, "relative", "forest")).toThrow();
	expect(RepositoryPatterns.pattern("unknown")).toBeUndefined();

	for (const value of [undefined, null, [], false, "rose"])
		expect(RepositoryPatterns.parse(value)).toEqual({});
});

it.each(
	repositoryPatternPresets.map((preset) => [preset.name, preset.id] as const)
)(
	"persists %s with colors without changing legacy sessions",
	(_name, pattern) => {
		const choices = RepositoryPatterns.set({}, "/repo/.git", pattern);
		const colors = { "/repo/.git": "#e879a0" };
		const empty = WorkspaceTabsModel.create(0);

		const captured = WorkspaceSession.capture(
			empty,
			undefined,
			"dark",
			true,
			"complete",
			colors,
			undefined,
			choices
		);

		const restored = WorkspaceSession.parse(JSON.stringify(captured));

		expect(restored.repositoryPatterns).toEqual(choices);
		expect(restored.repositoryColors).toEqual(colors);
		expect(restored.tabs).toEqual([]);
		expect(
			WorkspaceSession.parse(
				JSON.stringify({ version: 1, tabs: [], activeId: null })
			).repositoryPatterns
		).toBeUndefined();
		expect(
			WorkspaceSession.parse(
				JSON.stringify({
					...captured,
					repositoryPatterns: { "/repo/.git": "unknown" },
				})
			).repositoryPatterns
		).toBeUndefined();
	}
);

it.each(["light", "dark"] as const)(
	"keeps semantic colors and the default palette unchanged (%s)",
	(appearance) => {
		const base = appThemes[appearance];

		expect(RepositoryTheme.create(base)).toBe(base);
		const patterned = RepositoryTheme.create(base, undefined, "rose");

		expect(patterned.repositoryPattern).toBe("rose");
		expect(patterned.colors).toBe(base.colors);
		expect(patterned.tokens).toBe(base.tokens);

		for (const preset of repositoryPatternPresets) {
			const colored = RepositoryTheme.create(base, preset.color);
			const themed = RepositoryTheme.create(base, preset.color, preset.id);

			expect(themed.colors).toEqual(colored.colors);
			expect(themed.tokens).toEqual(colored.tokens);
			expect(themed.repositoryPattern).toBe(preset.id);
		}
	}
);

it("reuses small monochrome tiles across colors rather than generating window-sized images", async () => {
	expect(
		new Set(
			repositoryPatternPresets.map(
				(preset) => RepositoryPatternArtwork.create(preset.id).source
			)
		).size
	).toBe(repositoryPatternPresets.length);

	for (const preset of repositoryPatternPresets) {
		const { source } = RepositoryPatternArtwork.create(preset.id);

		const image = await sharp(Buffer.from(source))
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });

		expect(source.length).toBeLessThan(24000);
		expect(source).not.toMatch(
			/<filter|<image|https?:\/\/(?!www\.w3\.org)|#[a-f0-9]{6}/u
		);
		expect(image.info.width).toBe(repositoryPatternTileSize);
		expect(image.info.height).toBe(repositoryPatternTileHeight);
		expect(
			image.data.some((value, index) => index % 4 === 3 && value > 0)
		).toBe(true);
	}
});

it("shows every pack's symbols on the rail and the first three in its preview", () => {
	for (const preset of repositoryPatternPresets) {
		for (const seed of [0, 1, 42, 0xffffffff]) {
			const artwork = RepositoryPatternArtwork.create(preset.id, seed);

			const preview = [...artwork.previewSource.matchAll(tileMotifPattern)].map(
				(match) => match[2]
			);

			for (const source of [artwork.source, artwork.cornerSource]) {
				const railMotifs = [...source.matchAll(tileMotifPattern)]
					.filter((match) => Number(match[1]) < 48)
					.map((match) => match[2]);

				expect(railMotifs).toHaveLength(6);
				expect(new Set(railMotifs).size).toBe(preset.id === "forest" ? 4 : 3);
				expect(preview).toEqual(railMotifs.slice(0, 3));

				for (let index = 1; index < railMotifs.length; index++)
					expect(railMotifs[index]).not.toBe(railMotifs[index - 1]);
			}
		}
	}
});

it("raises only the upper-left motif while retaining every other symbol's pixels", async () => {
	for (const preset of repositoryPatternPresets) {
		const artwork = RepositoryPatternArtwork.create(preset.id, 42);
		const regular = Buffer.from(artwork.source);
		const corner = Buffer.from(artwork.cornerSource);

		const regions = [
			{ left: 64, top: 0, width: 192, height: repositoryPatternTileHeight },
			{ left: 0, top: 64, width: 64, height: repositoryPatternTileHeight - 64 },
		];

		for (const region of regions) {
			const original = await sharp(regular)
				.extract(region)
				.ensureAlpha()
				.raw()
				.toBuffer();

			const unchanged = await sharp(corner)
				.extract({ ...region, top: region.top + repositoryPatternCornerOffset })
				.ensureAlpha()
				.raw()
				.toBuffer();

			expect(unchanged.equals(original)).toBe(true);
		}

		const elevated = await sharp(corner)
			.extract({
				left: 0,
				top: 0,
				width: 64,
				height: repositoryPatternCornerOffset,
			})
			.ensureAlpha()
			.raw()
			.toBuffer();

		expect(elevated.some((value, index) => index % 4 === 3 && value > 0)).toBe(
			true
		);
	}
});

it("restores old pack IDs with stable repository-specific layouts and validates saved seeds", () => {
	const directory = "/repo/.git";
	const legacy = RepositoryPatterns.parse({ [directory]: "forest" });

	expect(legacy[directory]).toBe("forest");
	expect(RepositoryPatterns.selection(legacy[directory], directory)).toEqual({
		id: "forest",
		seed: RepositoryPatterns.defaultSeed(directory),
	});
	expect(RepositoryPatterns.defaultSeed(directory)).not.toBe(
		RepositoryPatterns.defaultSeed("/other/.git")
	);

	for (const seed of [0, 42, 0xffffffff]) {
		const choices = RepositoryPatterns.set(legacy, directory, "cosmic", seed);

		const document = WorkspaceSession.parse(
			JSON.stringify({
				version: 1,
				tabs: [],
				activeId: null,
				repositoryPatterns: choices,
			})
		);

		expect(document.repositoryPatterns?.[directory]).toEqual({
			id: "cosmic",
			seed,
		});
		expect(
			RepositoryPatterns.set(choices, directory, "rose")[directory]
		).toEqual({ id: "rose", seed });
		expect(RepositoryPatterns.set(choices, directory, undefined)).toEqual({});
	}

	for (const seed of [-1, 1.5, 0x100000000, NaN, Infinity, "42", null]) {
		expect(RepositoryPatterns.seed(seed)).toBeUndefined();
		expect(
			RepositoryPatterns.parse({ [directory]: { id: "forest", seed } })
		).toEqual({});
	}

	expect(
		RepositoryPatterns.parse({ [directory]: { id: "unknown", seed: 42 } })
	).toEqual({});
	expect(() =>
		RepositoryPatterns.set(legacy, directory, "forest", -1)
	).toThrow();
	expect(legacy[directory]).toBe("forest");
});

it("creates deterministic layouts and a fresh valid seed for Shuffle", () => {
	for (const preset of repositoryPatternPresets) {
		for (const seed of [0, 1, 42, 0xffffffff]) {
			const artwork = RepositoryPatternArtwork.create(preset.id, seed);

			expect(RepositoryPatternArtwork.create(preset.id, seed)).toEqual(artwork);
			const shuffled = RepositoryPatterns.shuffleSeed(seed);

			expect(shuffled).not.toBe(seed);
			expect(RepositoryPatterns.seed(shuffled)).toBe(shuffled);
			expect(
				RepositoryPatternArtwork.create(preset.id, shuffled).source
			).not.toBe(artwork.source);
		}
	}
});
