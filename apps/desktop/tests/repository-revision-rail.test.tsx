import { describe, expect, test } from "bun:test";
import type { FileDiff, StashInfo } from "@1git/git";
import { renderToStaticMarkup } from "react-dom/server";
import { LiquidMenuStackProvider } from "../src/renderer/src/fixture/liquid-menu/components/liquid-menu-stack-provider.js";
import {
	RepositoryRevisionFileRail,
	RepositoryStashRail,
} from "../src/renderer/src/fixture/repository-workspace/components/repository-revision-rail.js";

const REVISION_DIFF: FileDiff = {
	patch: "",
	stats: [
		{
			addedLines: 3,
			deletedLines: 1,
			path: "src/app.ts",
		},
		{
			addedLines: 1,
			deletedLines: 0,
			path: "README.md",
		},
	],
	target: { kind: "commit", revision: "revision-oid" },
};

const STASHES: readonly StashInfo[] = [
	{
		createdAt: "2026-08-11T10:00:00.000Z",
		oid: "stash-one",
		reference: "stash@{0}",
		summary: "On main: Shelf layout",
	},
	{
		createdAt: "2026-08-11T09:00:00.000Z",
		oid: "stash-two",
		reference: "stash@{1}",
		summary: "On main: Navigation polish",
	},
];

const succeed = async (): Promise<boolean> => true;
const selectFile = async (): Promise<void> => undefined;
const selectStash = async (): Promise<void> => undefined;

describe("repository revision rails", () => {
	test("shows revision files between the diff and history list", () => {
		const markup = renderToStaticMarkup(
			<RepositoryRevisionFileRail
				diffs={[REVISION_DIFF]}
				isPending={false}
				onApplyStash={succeed}
				onDropStash={succeed}
				onPopStash={succeed}
				onSelectFile={selectFile}
				selectedFilePath="src/app.ts"
				selectedStash={null}
				tab="history"
			/>
		);

		expect(markup).toContain('aria-label="Files in commit"');
		expect(markup).toContain('data-state="open"');
		expect(markup).toContain('data-repository-file-liquid-rail="true"');
		expect(markup).toContain("transition-[width,opacity]");
		expect(markup).toContain("w-(--repository-context-rail-width)");
		expect(markup).toContain('aria-current="true"');
		expect(markup).toContain("src/");
		expect(markup).toContain("app.ts");
		expect(markup).toContain("+3");
		expect(markup).toContain("−1");
	});

	test("shows saved work with the selected stash", () => {
		const markup = renderToStaticMarkup(
			<RepositoryStashRail
				isPending={false}
				onSelectStash={selectStash}
				selectedStashOid="stash-two"
				stashes={STASHES}
			/>
		);

		expect(markup).toContain('aria-label="Stash shelf"');
		expect(markup).toContain("Saved work");
		expect(markup).toContain("Shelf layout");
		expect(markup).toContain("Navigation polish");
		expect(markup.match(/aria-current="true"/g)).toHaveLength(1);
	});

	test("keeps stash actions above the revision files", () => {
		const markup = renderToStaticMarkup(
			<LiquidMenuStackProvider>
				<RepositoryRevisionFileRail
					diffs={[REVISION_DIFF]}
					isPending={false}
					onApplyStash={succeed}
					onDropStash={succeed}
					onPopStash={succeed}
					onSelectFile={selectFile}
					selectedFilePath="src/app.ts"
					selectedStash={STASHES[0] ?? null}
					tab="stashes"
				/>
			</LiquidMenuStackProvider>
		);
		const headerEnd = markup.indexOf("</header>");

		expect(markup).toContain("height:46px");
		expect(markup).toContain("h-9");
		expect(markup.indexOf("Apply")).toBeLessThan(headerEnd);
		expect(markup.indexOf("Pop")).toBeLessThan(headerEnd);
		expect(markup.lastIndexOf("Files in stash")).toBeGreaterThan(headerEnd);
		expect(markup).not.toContain("<footer");
	});

	test("keeps the contextual rail mounted but inert in changes", () => {
		const markup = renderToStaticMarkup(
			<RepositoryRevisionFileRail
				diffs={[]}
				isPending={false}
				onApplyStash={succeed}
				onDropStash={succeed}
				onPopStash={succeed}
				onSelectFile={selectFile}
				selectedFilePath={null}
				selectedStash={null}
				tab="changes"
			/>
		);

		expect(markup).toContain('data-state="closed"');
		expect(markup).toContain('aria-hidden="true"');
		expect(markup).toContain("pointer-events-none w-0");
		expect(markup).not.toContain("data-repository-file-liquid-rail");
	});
});
