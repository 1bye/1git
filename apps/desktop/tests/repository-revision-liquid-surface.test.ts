import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const readSource = (relativePath: string): string =>
	readFileSync(new URL(relativePath, import.meta.url), "utf8");

const surface = readSource(
	"../src/renderer/src/fixture/repository-workspace/components/repository-revision-liquid-surface.tsx"
);
const workspace = readSource(
	"../src/renderer/src/fixture/repository-workspace/components/repository-workspace.tsx"
);
const styles = readSource("../src/renderer/src/styles.css");

describe("repository revision liquid surface", () => {
	test("connects the selected revision to the open file shelf", () => {
		expect(workspace).toContain("<RepositoryRevisionLiquidSurface");
		expect(workspace).toContain("selectedRevisionKey={selectedRevisionKey}");
		expect(surface).toContain("createLiquidGeometryTracker(measure)");
		expect(surface).toContain("createRepositoryFileLiquidMeasurement(");
		expect(surface).toContain("createRepositoryFileLiquidPath(measurement)");
		expect(surface).toContain("REVISION_SHELF_SELECTOR");
		expect(surface).toContain("REVISION_ROW_SELECTOR");
	});

	test("reveals from the revision row toward the shelf", () => {
		expect(styles).toContain("@keyframes repository-revision-liquid-reveal");
		expect(styles).toContain("clip-path: inset(0 0 0 100%);");
		expect(styles).toContain(
			'[data-name="RepositoryRevisionLiquidSurfaceFill"]'
		);
		expect(styles).toContain("fill: var(--editor-sunken-2);");
	});
});
