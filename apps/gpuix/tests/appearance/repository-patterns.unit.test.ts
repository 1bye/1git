/**
 * Covers: validated opt-in patterns, reset, local session round trips and bounded shared SVG sources.
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
	repositoryPatternSources,
	repositoryPatternTileSize,
} from "../../src/feature/repository-appearance/pattern-artwork";
import { WorkspaceSession } from "../../src/feature/workspace-tabs/lib/workspace-session";
import { WorkspaceTabsModel } from "../../src/feature/workspace-tabs/lib/workspace-tabs-model";
import { appThemes } from "../../src/styles/theme";
import { RepositoryTheme } from "../../src/styles/repository-theme";

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

it("persists wallpaper choices with colors without changing legacy sessions", () => {
	const choices = RepositoryPatterns.set({}, "/repo/.git", "seaside");
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
});

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

it("reuses four small monochrome tiles across colors rather than generating window-sized images", async () => {
	expect(Object.keys(repositoryPatternSources)).toHaveLength(4);

	for (const preset of repositoryPatternPresets) {
		const source = repositoryPatternSources[preset.id];

		const image = await sharp(Buffer.from(source))
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });

		expect(source.length).toBeLessThan(12000);
		expect(source).not.toMatch(
			/<filter|<image|https?:\/\/(?!www\.w3\.org)|#[a-f0-9]{6}/u
		);
		expect(image.info.width).toBe(repositoryPatternTileSize);
		expect(image.info.height).toBe(repositoryPatternTileSize);
		expect(
			image.data.some((value, index) => index % 4 === 3 && value > 0)
		).toBe(true);
	}
});
