import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const readSource = (relativePath: string): string =>
	readFileSync(new URL(relativePath, import.meta.url), "utf8");

const fileNavigator = readSource(
	"../src/renderer/src/fixture/repository-workspace/components/repository-file-navigator.tsx"
);
const fileList = readSource(
	"../src/renderer/src/fixture/repository-workspace/components/repository-file-list.tsx"
);
const scrollArea = readSource(
	"../../../packages/ui/src/components/scroll-area.tsx"
);
const styles = readSource("../src/renderer/src/styles.css");

describe("repository file scroll area", () => {
	test("masks overflowing content while keeping the scrollbar separate", () => {
		expect(fileNavigator).toContain('data-name="RepositoryFileScrollArea"');
		expect(fileNavigator).toContain(
			"overflowEdgeThreshold={{ yEnd: 1, yStart: 1 }}"
		);
		expect(fileNavigator).toContain("<ScrollBar />");
		expect(fileNavigator).not.toContain("MutationObserver");
		expect(fileNavigator).not.toContain("ResizeObserver");
		expect(scrollArea).toContain('data-slot="scroll-area-viewport"');
		expect(scrollArea).toContain('data-slot="scroll-area-scrollbar"');
		expect(scrollArea).toContain('"z-20 flex touch-none');
		expect(styles).toContain(
			'[data-name="RepositoryFileScrollArea"][data-overflow-y-start]'
		);
		expect(styles).toContain(
			'[data-name="RepositoryFileScrollArea"][data-overflow-y-end]'
		);
		expect(styles).toContain("mask-image: linear-gradient(");
		expect(styles).toContain('[data-slot="scroll-area-viewport"]');
		expect(styles).not.toContain("backdrop-filter: blur(10px)");
		expect(styles).not.toContain(
			"color-mix(in srgb, var(--background) 28%, transparent)"
		);
		expect(fileList).not.toContain("sticky top-0 z-10");
		expect(fileList).not.toContain("backdrop-blur-sm");
		expect(styles).not.toContain(".repository-file-edge-mask");
	});
});
