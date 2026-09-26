import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { useEffect, useRef, useState, type RefObject } from "react";

import {
	ImagePreviewDecoder,
	type ImagePreview,
	type ImagePreviewViewport,
} from "../lib/image-preview";

const sampleIntervalMs = 100;
const resizeDelayMs = 100;
// GPUIX 0.10 exposes logical bounds, not monitor scale. A bounded 2× backing also covers 1× macOS displays.
const previewPixelRatio = 2;

/** Renders retained SVG vectors after layout settles; one decode per side, cancelled on resize/unmount. */
export function useSvgPreview(image: ImagePreview | null): {
	viewport: RefObject<PublicInstance | null>;
	src: string | undefined;
	error: string | null;
} {
	const renderer = useGpuixRequired();
	const viewport = useRef<PublicInstance>(null);

	const [rendered, setRendered] = useState<{
		image: ImagePreview;
		src: string;
		error: string | null;
	} | null>(null);

	useEffect(() => {
		const source = image?.svg;

		if (!source) return;

		let controller: AbortController | null = null;
		let rendering = false;
		let sampledSize = "";
		let completedSize = "";
		let changedAt = 0;

		const draw = async (
			size: ImagePreviewViewport,
			key: string
		): Promise<void> => {
			const current = new AbortController();

			controller = current;
			rendering = true;

			try {
				const preview = await ImagePreviewDecoder.prepare(
					source,
					current.signal,
					size
				);

				if (!current.signal.aborted) {
					completedSize = key;
					setRendered({ image, src: preview.src, error: null });
				}
			} catch (error) {
				if (!current.signal.aborted) {
					completedSize = key;
					setRendered((previous) => ({
						image,
						src: previous?.image === image ? previous.src : image.src,
						error:
							error instanceof Error
								? error.message
								: "Could not resize the SVG preview.",
					}));
				}
			} finally {
				rendering = false;
			}
		};

		const sample = (): void => {
			const node = viewport.current;
			const bounds = node && renderer.getElementBounds?.(node.id);

			if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;

			const size = {
				width: Math.ceil(bounds.width),
				height: Math.ceil(bounds.height),
				pixelRatio: previewPixelRatio,
			};

			const key = `${size.width}:${size.height}`;

			if (key !== sampledSize) {
				sampledSize = key;
				changedAt = performance.now();
				controller?.abort();

				return;
			}

			if (
				rendering ||
				key === completedSize ||
				performance.now() - changedAt < resizeDelayMs
			)
				return;

			void draw(size, key);
		};

		sample();
		const timer = setInterval(sample, sampleIntervalMs);

		return () => {
			clearInterval(timer);
			controller?.abort();
		};
	}, [image, renderer]);

	const current = rendered?.image === image ? rendered : null;

	return {
		viewport,
		src: current?.src ?? image?.src,
		error: current?.error ?? null,
	};
}
