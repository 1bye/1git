import sharp from "sharp";

// One deterministic pattern; no filters, animation or per-frame noise.
const pixels: string[] = [];
const grainPointCount = 1600;
const grainArtworkSize = 2048;
const grainTextureSize = 4000;
const svgDefaultDensityDpi = 72;
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

/** Static grain for transparent chrome only; opaque editor surfaces cover it. */
export const chromeGrainSource = `<svg xmlns="http://www.w3.org/2000/svg" width="${grainArtworkSize}" height="${grainArtworkSize}" viewBox="0 0 ${grainArtworkSize} ${grainArtworkSize}" preserveAspectRatio="none"><defs><pattern id="grain" width="64" height="64" patternUnits="userSpaceOnUse">${pixels.join("")}</pattern></defs><rect width="${grainArtworkSize}" height="${grainArtworkSize}" fill="url(#grain)"/></svg>`;

const createGrainImages = async () => {
	const { data, info } = await sharp(Buffer.from(chromeGrainSource), {
		// Fractional source pixels retain the original mask's antialiased grain.
		density: (grainTextureSize / grainArtworkSize) * svgDefaultDensityDpi,
	})
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

/** Rasterized once at startup; resizing only scales the retained textures. */
export const chromeGrainImages = await createGrainImages();
