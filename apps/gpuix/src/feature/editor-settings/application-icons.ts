const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const maxIconBytes = 256 * 1024;
const maxCachedIcons = 64;

/** Small AppKit PNGs, cached per native renderer and installed bundle revision. */
export class ApplicationIcons {
	private static readonly caches = new WeakMap<
		object,
		Map<string, string | undefined>
	>();

	static load(
		renderer: object,
		path: string,
		revision = ""
	): string | undefined {
		if (
			!("getApplicationIcon" in renderer) ||
			typeof renderer.getApplicationIcon !== "function"
		)
			return undefined;

		let cache = ApplicationIcons.caches.get(renderer);

		if (!cache) {
			cache = new Map();
			ApplicationIcons.caches.set(renderer, cache);
		}

		const key = `${path}\0${revision}`;

		if (cache.has(key)) return cache.get(key);

		let source: string | undefined;

		try {
			const png: unknown = renderer.getApplicationIcon(path);

			if (
				png instanceof Uint8Array &&
				png.length > pngSignature.length &&
				png.length <= maxIconBytes &&
				pngSignature.every((byte, index) => png[index] === byte)
			) {
				source = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
			}
		} catch {
			// A decorative icon must never prevent choosing or saving an editor.
		}

		if (cache.size >= maxCachedIcons) {
			const oldest = cache.keys().next().value;

			if (oldest !== undefined) cache.delete(oldest);
		}

		cache.set(key, source);

		return source;
	}
}
