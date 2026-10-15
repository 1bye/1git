// One deterministic monochrome mask, cached by GPUIX; no filters, animation or per-frame noise.
const pixels: string[] = [];
const grainPointCount = 1600;
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
export const chromeGrainSource = `<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048" viewBox="0 0 2048 2048" preserveAspectRatio="none"><defs><pattern id="grain" width="64" height="64" patternUnits="userSpaceOnUse">${pixels.join("")}</pattern></defs><rect width="2048" height="2048" fill="url(#grain)"/></svg>`;
