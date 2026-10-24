import {
	RepositoryPatterns,
	type RepositoryPattern,
	type RepositoryPatternAdjustments,
} from "./repository-patterns";

// Existing Lucide v1.28.0 motifs retain the notices in pattern-artwork.LICENSE.
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
	// Original motifs for the additional packs, using the same 24 × 24 linework.
	daisy:
		'<circle cx="12" cy="12" r="2.5"/><path d="M10 8C5 1 1 7 8 10 1 13 5 19 10 16c-3 7 5 9 4 1 7 3 9-5 2-7 7-5 0-10-3-3Z"/>',
	butterfly:
		'<path d="M12 9C7 1 2 3 3 9c0 3 4 4 9 3-8 1-9 8-4 8 3 0 4-5 4-8m0-3c5-8 10-6 9 0 0 3-4 4-9 3 8 1 9 8 4 8-3 0-4-5-4-8m0-3v9m0-9L9 5m3 4 3-4"/>',
	sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
	tent: '<path d="m3 21 9-17 9 17Zm9-9-5 9m5-9 5 9M9 2l3 2 3-2M2 21h20"/>',
	campfire:
		'<path d="M12 3c1 4 5 5 5 9a5 5 0 0 1-10 0c0-2 1-4 2-5 0 3 2 3 2 1l1-5Zm-7 16 14 3M5 22l14-3"/>',
	compass:
		'<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6Zm-6 2 4 4M12 3v2m0 14v2M3 12h2m14 0h2"/>',
	cloud:
		'<path d="M7 17h11a4 4 0 0 0 0-8h-1a6 6 0 0 0-11-1 4.5 4.5 0 0 0 1 9ZM8 20l-1 2m6-2-1 2m6-2-1 2"/>',
	umbrella:
		'<path d="M3 12a9 9 0 0 1 18 0c-2-2-4-2-6 0-2-2-4-2-6 0-2-2-4-2-6 0Zm9-9v15a3 3 0 0 0 6 0M12 1v2M9 12c0-4 1-7 3-9 2 2 3 5 3 9"/>',
	droplet:
		'<path d="M12 3C10 7 5 11 5 15a7 7 0 0 0 14 0c0-4-5-8-7-12ZM8 15c0 2 1 3 3 3"/>',
	branch:
		'<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 7v10m12-10v2c0 4-12 2-12 6"/>',
	terminal:
		'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/>',
	braces:
		'<path d="M8 3H6c-2 0-2 2-2 4v2c0 2-1 3-2 3 1 0 2 1 2 3v2c0 2 0 4 2 4h2m8-18h2c2 0 2 2 2 4v2c0 2 1 3 2 3-1 0-2 1-2 3v2c0 2 0 4-2 4h-2"/>',
};

/** Fixed logical pixels keep illustrated wallpaper masks shared across colors and window sizes. */
export const repositoryPatternTileSize = 256;

/** Six rail motifs per repeat reveal every pack's symbols without a short, uniform rhythm. */
export const repositoryPatternTileHeight = 768;

/** Extra headroom for the single motif above the rail's sync control. */
export const repositoryPatternCornerOffset = 32;

const patternMotifs: Readonly<Record<RepositoryPattern, readonly string[]>> = {
	rose: [motifs.rose, motifs.leaf, motifs.sprout],
	seaside: [motifs.shell, motifs.bird, motifs.anchor],
	forest: [motifs.tree, motifs.leaf, motifs.mountain, motifs.sprout],
	cosmic: [motifs.moon, motifs.star, motifs.orbit],
	meadow: [motifs.daisy, motifs.butterfly, motifs.sun],
	camping: [motifs.tent, motifs.campfire, motifs.compass],
	rainfall: [motifs.cloud, motifs.umbrella, motifs.droplet],
	workshop: [motifs.branch, motifs.terminal, motifs.braces],
};

interface Placement {
	readonly icon: string;
	readonly x: number;
	readonly y: number;
	readonly size: number;
	readonly angle: number;
}

/** Color-independent masks and a compact preview of the same rail's symbols. */
export interface PatternArtwork {
	readonly tileHeight: number;
	readonly source: string;
	readonly cornerSource: string;
	readonly previewSource: string;
}

/** Generates bounded, deterministic SVGs; callers memoize by pack, seed and geometry controls, never by tint or viewport. */
export class RepositoryPatternArtwork {
	static create(
		pattern: RepositoryPattern,
		seed = 0,
		adjustments?: RepositoryPatternAdjustments
	): PatternArtwork {
		const settings = RepositoryPatterns.adjustments(adjustments);
		const variation = settings.variation / 50;
		const sizeScale = 0.5 + settings.size / 100;
		let state = seed >>> 0;

		const random = (): number => {
			state = (state + 0x6d2b79f5) >>> 0;
			let value = Math.imul(state ^ (state >>> 15), state | 1);

			value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

			return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
		};

		const icons = [...patternMotifs[pattern]];

		for (let index = icons.length - 1; index > 0; index--) {
			const other = Math.floor(random() * (index + 1));
			const first = icons[index];
			const second = icons[other];

			if (first && second) {
				icons[index] = second;
				icons[other] = first;
			}
		}

		const placements: Placement[] = [];
		const count = 6;

		const tileHeight = Math.round(
			repositoryPatternTileHeight * (1.5 - settings.density / 100)
		);

		const step = tileHeight / count;

		for (let column = 0; column < 3; column++) {
			for (let row = 0; row < count; row++) {
				const nominalSize = (column === 0 ? 33 : 35) * sizeScale;

				const emphasis =
					settings.layout === "hero" ? (row === 0 ? 1.5 : 0.7) : 1;

				const size = Math.round(
					(nominalSize + (random() * 6 - 3) * variation * sizeScale) * emphasis
				);

				const x =
					column === 0
						? (48 - size) / 2 + Math.round((random() * 2 - 1) * variation)
						: column * 88 + 12 + Math.round((random() * 12 - 6) * variation);

				let y = row * step + (column === 1 ? step / 2 : 8);

				if (settings.layout === "clusters") {
					const groupStep = tileHeight / Math.ceil(count / 2);

					y =
						Math.floor(row / 2) * groupStep +
						8 +
						(row % 2) * Math.min(groupStep / 2, nominalSize * 1.45 + 8);
				} else if (settings.layout === "hero" && row > 0)
					y = 96 + ((row - 1) * (tileHeight - 96)) / (count - 1);

				placements.push({
					icon: icons[(row + column) % icons.length] ?? "",
					x,
					y:
						row === 0 && column === 0
							? 8
							: Math.round(y + (random() * 16 - 8) * variation),
					size,
					angle: Math.round((random() * 40 - 20) * variation),
				});
			}
		}

		const previewCount =
			settings.density < 25 ? 2 : settings.density > 75 ? 4 : 3;

		const preview = placements
			.slice(0, previewCount)
			.map((placement, index) =>
				RepositoryPatternArtwork.motif({
					...placement,
					x: 4,
					y:
						4 +
						index * (60 / previewCount) -
						(settings.layout === "clusters" && index === 1 ? 2 : 0),
					size: Math.min(
						60 / previewCount - 4,
						16 *
							sizeScale *
							(settings.layout === "hero" ? (index === 0 ? 1.5 : 0.7) : 1)
					),
				})
			)
			.join("");

		return {
			tileHeight,
			source: RepositoryPatternArtwork.tile(placements, 0, tileHeight),
			cornerSource: RepositoryPatternArtwork.tile(
				placements,
				repositoryPatternCornerOffset,
				tileHeight
			),
			previewSource: `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64" viewBox="0 0 96 64" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="27" y="4" width="65" height="56" rx="5" fill="currentColor" fill-opacity="0.06" stroke-opacity="0.18"/><path d="M35 15h27m-27 8h44m-44 8h35m-35 8h44m-44 8h24" stroke-opacity="0.2"/>${preview}</svg>`,
		};
	}

	private static motif({ icon, x, y, size, angle }: Placement): string {
		return `<g transform="translate(${x} ${y}) rotate(${angle} ${size / 2} ${size / 2}) scale(${Number((size / 24).toFixed(4))})">${icon}</g>`;
	}

	private static tile(
		placements: readonly Placement[],
		cornerOffset: number,
		tileHeight: number
	): string {
		const artwork = placements
			.map((placement, index) =>
				RepositoryPatternArtwork.motif(
					index === 0
						? { ...placement, y: placement.y - cornerOffset }
						: placement
				)
			)
			.join("");

		const height = tileHeight + cornerOffset;

		return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="${height}" viewBox="0 ${-cornerOffset} 256 ${height}" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${artwork}</svg>`;
	}
}
