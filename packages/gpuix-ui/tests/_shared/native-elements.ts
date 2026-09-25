import type { TestElement, TestRenderer } from "@gpuix/react/testing";

export function elementByTestId(
	renderer: TestRenderer,
	testId: string
): TestElement {
	const element = renderer.findByTestId(testId);
	if (!element) throw new Error(`Missing native test element: ${testId}`);

	return element;
}

export function clickElement(renderer: TestRenderer, testId: string): void {
	const element = elementByTestId(renderer, testId);
	const bounds = renderer.getElementBounds(element.id);
	if (!bounds) throw new Error(`Missing native bounds: ${testId}`);

	renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
}
