import type { ImageMetadata } from "astro";

export type ScreenName =
	| "changes"
	| "ai-composer"
	| "ai-composer-busy"
	| "history"
	| "home-machines"
	| "devbox-remote"
	| "theme-rose"
	| "theme-forest"
	| "theme-cosmic"
	| "theme-workshop"
	| "tabs-strip";

const files = import.meta.glob<{ default: ImageMetadata }>(
	"../assets/screens/*.{webp,png,avif}",
	{ eager: true }
);

/** Resolve only supplied captures; absent states remain labelled placeholders. */
export function screenAsset(name: ScreenName): ImageMetadata | undefined {
	for (const extension of ["webp", "png", "avif"]) {
		const asset = files[`../assets/screens/${name}.${extension}`]?.default;

		if (asset) return asset;
	}

	return undefined;
}
