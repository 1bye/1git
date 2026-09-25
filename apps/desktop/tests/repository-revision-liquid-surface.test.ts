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

const diffWorkspace = readSource(
	"../src/renderer/src/fixture/repository-workspace/components/repository-diff-workspace.tsx"
);

const revisionRail = readSource(
	"../src/renderer/src/fixture/repository-workspace/components/repository-revision-rail.tsx"
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
		const revisionReveal = styles.slice(
			styles.indexOf("@keyframes repository-revision-liquid-reveal"),
			styles.indexOf('[data-name="RepositoryFileLiquidSurface"]')
		);

		expect(styles).toContain("@keyframes repository-revision-liquid-reveal");
		expect(revisionReveal).toContain("clip-path: inset(0 100% 0 0);");
		expect(revisionReveal).not.toContain("clip-path: inset(0 0 0 100%);");
		expect(styles).toContain(
			'[data-name="RepositoryRevisionLiquidSurfaceFill"]'
		);
		expect(styles).toContain("fill: var(--editor-sunken-2);");
	});

	test("places the revision file shelf before the diff canvas", () => {
		expect(diffWorkspace.indexOf("<RepositoryRevisionFileRail")).toBeLessThan(
			diffWorkspace.indexOf('data-name="RepositoryDiffCanvas"')
		);
		expect(revisionRail).toContain(
			'className="absolute inset-y-0 left-0 flex w-(--repository-context-rail-width) flex-col"'
		);
	});
});
