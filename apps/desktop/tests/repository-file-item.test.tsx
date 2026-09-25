import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
	RepositoryFilePath,
	RepositoryFileStats,
} from "../src/renderer/src/fixture/repository-workspace/components/repository-file-item.js";

describe("repository file item presentation", () => {
	test("renders a repository-relative path with its filename emphasized", () => {
		const markup = renderToStaticMarkup(
			<RepositoryFilePath path="apps/desktop/src/app.tsx" />
		);

		expect(markup).toContain("apps/desktop/src/");
		expect(markup).toContain("app.tsx");
		expect(markup).toContain("text-editor-muted/75");
		expect(markup).toContain("font-medium text-editor-ink");
		expect(markup).toContain('title="apps/desktop/src/app.tsx"');
	});

	test("shares diff stats while preserving binary placeholders", () => {
		const counts = renderToStaticMarkup(
			<RepositoryFileStats addedLines={12} deletedLines={3} />
		);
		const binary = renderToStaticMarkup(
			<RepositoryFileStats
				addedLines={null}
				deletedLines={null}
				unavailableLabel="–"
			/>
		);

		expect(counts).toContain("+12");
		expect(counts).toContain("−3");
		expect(counts).toContain("grid-cols-2");
		expect(counts).toContain("w-[9ch]");
		expect(counts.match(/text-right/g)).toHaveLength(2);
		expect(binary).toContain("+–");
		expect(binary).toContain("−–");
	});
});
