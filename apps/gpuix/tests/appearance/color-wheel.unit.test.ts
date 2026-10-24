/**
 * Covers: RGB/HSV conversion, grayscale hue retention, wheel coordinates and RGBA artwork.
 * Real: native picker's color model.
 * Doubles: none.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { ColorWheel } from "../../src/feature/repository-appearance/color-wheel";

it("round-trips presets, extremes and arbitrary six-digit colors", () => {
	for (const hex of [
		"#ff0000",
		"#00ff00",
		"#0000ff",
		"#ffffff",
		"#000000",
		"#808080",
		"#d9b34a",
		"#123456",
	])
		expect(ColorWheel.hex(ColorWheel.fromHex(hex))).toBe(hex);

	expect(ColorWheel.fromHex("#808080", 240).hue).toBe(240);
	expect(ColorWheel.hex({ hue: 720, saturation: 1, brightness: 1 })).toBe(
		"#ff0000"
	);
});

it("maps hue around the wheel, saturation outward and clamps outside drags", () => {
	expect(ColorWheel.hex(ColorWheel.atPoint(0, 0, 1))).toBe("#ffffff");
	expect(ColorWheel.hex(ColorWheel.atPoint(1, 0, 1))).toBe("#ff0000");
	expect(ColorWheel.hex(ColorWheel.atPoint(-1, 0, 1))).toBe("#00ffff");
	expect(ColorWheel.atPoint(0, -1, 0.5)).toMatchObject({
		hue: 90,
		saturation: 1,
		brightness: 0.5,
	});
	expect(ColorWheel.atPoint(5, 2, 1).saturation).toBe(1);
});

it("paints a multicolor wheel with a pale center and transparent corners", () => {
	const size = 100;
	const pixels = ColorWheel.pixels(size);

	const pixel = (x: number, y: number) => [
		...pixels.subarray((y * size + x) * 4, (y * size + x) * 4 + 4),
	];

	expect(pixels.length).toBe(size * size * 4);
	expect(pixel(0, 0)).toEqual([0, 0, 0, 0]);
	expect(pixel(50, 50).every((channel) => channel > 245)).toBe(true);
	const red = pixel(97, 50);
	const cyan = pixel(2, 50);

	expect(red[0]).toBe(255);
	expect(red[1]).toBeLessThan(15);
	expect(cyan[0]).toBeLessThan(15);
	expect(cyan[1]).toBeGreaterThan(240);
});
