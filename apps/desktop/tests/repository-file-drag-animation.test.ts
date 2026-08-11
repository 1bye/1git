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
		expect(fileList).toContain(
			"const isDragFeedbackActive = isRepositoryFileDragFeedbackActive("
		);
		expect(fileList).not.toContain('isDragging && "opacity-45"');
	});

	test("projects the destination and uses a stable dropping overlay", () => {
		expect(fileList).toContain("<DragOverlay");
		expect(fileList).toContain(
			"setStageProjection({ path: file.path, staged: shouldStage });"
		);
		expect(fileList).toContain("<RepositoryFileDragOverlay file={file} />");
		expect(fileList).toContain("await animateRepositoryFileDrop(context);");
		expect(styles).toContain(
			'[data-name="RepositoryFileRow"][data-drag-landing="true"] > button'
		);
	});

	test("retracts the active SDF until the Git mutation settles", () => {
		expect(styles).toContain(
			'[data-name="RepositoryFileRow"][data-active="true"]:is('
		);
		expect(styles).toContain('[data-drag-settling="true"]');
		expect(fileList).toContain(
			"data-drag-settling={getBooleanDataAttribute(isDragSettling)}"
		);
		expect(fileList).toContain("await onSetStaged(file, shouldStage);");
	});
});
