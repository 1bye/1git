import type { RepositoryPattern } from "./repository-patterns";

// Lucide v1.28.0 motif paths. ISC/MIT notices are in pattern-artwork.LICENSE.
const motifs = {
	rose: '<path d="M17 10h-1a4 4 0 1 1 4-4v.534M17 6h1a4 4 0 0 1 1.42 7.74l-2.29.87a6 6 0 0 1-5.339-10.68l2.069-1.31M4.5 17c2.8-.5 4.4 0 5.5.8s1.8 2.2 2.3 3.7c-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2M9.77 12C4 15 2 22 2 22"/><circle cx="17" cy="8" r="2"/>',
	leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10ZM2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
	sprout:
		'<path d="M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4M5 21h14"/>',
	shell:
		'<path d="M14 11a2 2 0 1 1-4 0 4 4 0 0 1 8 0 6 6 0 0 1-12 0 8 8 0 0 1 16 0 10 10 0 1 1-20 0 11.93 11.93 0 0 1 2.42-7.22 2 2 0 1 1 3.16 2.44"/>',
	bird: '<path d="M16 7h.01M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20m18-13 2 .5-2 .5M10 18v3M14 17.75V21M7 18a6 6 0 0 0 3.84-10.61"/>',
	anchor:
		'<path d="M12 6v16m7-9 2-1a9 9 0 0 1-18 0l2 1m4-2h6"/><circle cx="12" cy="4" r="2"/>',
	tree: '<path d="m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17ZM12 22v-3"/>',
	mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
	moon: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
	star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
	orbit:
		'<path d="M20.341 6.484A10 10 0 0 1 10.266 21.85M3.659 17.516A10 10 0 0 1 13.74 2.152"/><circle cx="12" cy="12" r="3"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/>',
};

/** Fixed logical pixels keep illustrated wallpaper masks shared across colors and window sizes. */
export const repositoryPatternTileSize = 256;

const placements = [
	[10, 8, 36, -18],
	[108, 54, 32, 18],
	[195, 9, 38, -10],
	[6, 160, 40, 15],
	[144, 196, 32, -15],
	[200, 124, 38, 24],
] as const;

function tile(icons: readonly string[]): string {
	const artwork = placements
		.map(([x, y, size, angle], index) => {
			const icon = icons[index % icons.length];

			return `<g transform="translate(${x} ${y}) rotate(${angle} ${size / 2} ${size / 2}) scale(${size / 24})">${icon}</g>`;
		})
		.join("");

	return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${artwork}</svg>`;
}

/** One prebuilt monochrome tile per pack; rendering tint never changes the cached SVG source. */
export const repositoryPatternSources: Readonly<
	Record<RepositoryPattern, string>
> = {
	rose: tile([motifs.rose, motifs.leaf, motifs.rose, motifs.sprout]),
	seaside: tile([motifs.shell, motifs.bird, motifs.anchor]),
	forest: tile([motifs.tree, motifs.leaf, motifs.mountain, motifs.sprout]),
	cosmic: tile([motifs.moon, motifs.star, motifs.orbit]),
};
