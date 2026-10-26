import type { TestRoot } from "@gpuix/react/testing";
import { spyOn } from "bun:test";

/** Match live input frames: read painted metrics and redraw only after framework mutations. */
export function prepareNativeInputFrames(root: TestRoot): () => void {
	const renderer = root.renderer;
	const bounds = renderer.getElementBounds.bind(renderer);
	const offset = renderer.getScrollOffset.bind(renderer);
	const anchor = renderer.getListScrollTop.bind(renderer);
	const apply = renderer.applyBatch;
	let changed = false;

	renderer.getElementBounds = (id) => bounds(id, false);
	renderer.getScrollOffset = (id) => offset(id, false);
	renderer.getListScrollTop = (id) => anchor(id, false);
	spyOn(renderer, "applyBatch").mockImplementation((mutations) => {
		changed = true;

		return apply(mutations);
	});

	return () => {
		if (!changed) return;

		changed = false;
		renderer.flush();
		renderer.dispatchNativeEvents();
	};
}
