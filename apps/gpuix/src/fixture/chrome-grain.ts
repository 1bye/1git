import sharp from "sharp";

// One deterministic pattern; no filters, animation or per-frame noise.
const pixels: string[] = [];
const grainPointCount = 1600;
const grainArtworkSize = 2048;
const grainTextureSize = 1000;
const svgDefaultDensityDpi = 72;

/** Repeat a quarter-width tile at the original full-square pixel density. */
export const chromeGrainTileCount = 4;

let seed = 17;

// Dense enough to remain visible when the mask is downsampled on Retina displays.
for (let index = 0; index < grainPointCount; index++) {
	seed = (seed * 1664525 + 1013904223) >>> 0;
	const x = (seed >>> 16) % 64;

	seed = (seed * 1664525 + 1013904223) >>> 0;
	const y = (seed >>> 16) % 64;

	seed = (seed * 1664525 + 1013904223) >>> 0;

	pixels.push(
		`<rect x="${x}" y="${y}" width="1" height="1" fill-opacity="${0.2 + (seed % 6) / 10}"/>`
	);
}

const grainSource = (size: number): string =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" preserveAspectRatio="none"><defs><pattern id="grain" width="64" height="64" patternUnits="userSpaceOnUse">${pixels.join("")}</pattern></defs><rect width="${size}" height="${size}" fill="url(#grain)"/></svg>`;

/** Static grain for transparent chrome only; opaque editor surfaces cover it. */
export const chromeGrainSource = grainSource(grainArtworkSize);

const createGrainImages = async () => {
	const { data, info } = await sharp(
		Buffer.from(grainSource(grainArtworkSize / chromeGrainTileCount)),
		{
			// Fractional source pixels retain the original mask's antialiased grain.
			density:
				((grainTextureSize * chromeGrainTileCount) / grainArtworkSize) *
				svgDefaultDensityDpi,
		}
	)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	const light = await sharp(data, { raw: info })
		.toColourspace("b-w")
		.webp({ lossless: true, exact: true })
		.toBuffer();

	// Keep transparent pixels white too, so GPU filtering cannot darken the mask's edges.
	for (let offset = 0; offset < data.length; offset += 4) {
		data[offset] = 255;
		data[offset + 1] = 255;
		data[offset + 2] = 255;
	}

	const dark = await sharp(data, { raw: info })
		.toColourspace("b-w")
		.webp({ lossless: true, exact: true })
		.toBuffer();

	return {
		light: `data:image/webp;base64,${light.toString("base64")}`,
		dark: `data:image/webp;base64,${dark.toString("base64")}`,
	} as const;
};

/** Two shared 1000 × 1000 tiles; resizing scales their grid without decoding new textures. */
export const chromeGrainImages = await createGrainImages();
