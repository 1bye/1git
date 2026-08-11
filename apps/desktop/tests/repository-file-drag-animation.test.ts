import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const readSource = (relativePath: string): string =>
	readFileSync(new URL(relativePath, import.meta.url), "utf8");

const styles = readSource("../src/renderer/src/styles.css");
const fileList = readSource(
	"../src/renderer/src/fixture/repository-workspace/components/repository-file-list.tsx"
);

describe("repository file drag animation", () => {
	test("compresses only the dragged row content", () => {
		expect(styles).toContain(
			'[data-name="RepositoryFileRow"][data-dragging="true"] > button'
		);
		expect(styles).toContain("transform: scale3d(0.84, 0.68, 1);");
		expect(fileList).not.toContain('isDragging && "opacity-45"');
	});

	test("retracts the active SDF until a cross-group drop settles", () => {
		expect(styles).toContain(
			'[data-name="RepositoryFileRow"][data-active="true"]:is('
		);
		expect(styles).toContain('[data-drag-settling="true"]');
		expect(fileList).toContain(
			'data-drag-settling={isDragSettling ? "true" : undefined}'
		);
		expect(fileList).toContain("await onSetStaged(file, shouldStage);");
	});
});
