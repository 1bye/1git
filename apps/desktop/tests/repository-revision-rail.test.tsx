import { describe, expect, test } from "bun:test";
import type { FileDiff, StashInfo } from "@1git/git";
import { renderToStaticMarkup } from "react-dom/server";
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
const doNothing = (): void => undefined;

describe("repository revision rails", () => {
	test("shows revision files in the stacked history detail", () => {
		const markup = renderToStaticMarkup(
			<RepositoryRevisionFileRail
				diffs={[REVISION_DIFF]}
				isOpen
				isPending={false}
				onApplyStash={succeed}
				onBack={doNothing}
				onDropStash={succeed}
				onPopStash={succeed}
				onSelectFile={selectFile}
				revisionTitle="Build the stacked rail"
				selectedFilePath="src/app.ts"
				selectedStash={null}
				tab="history"
			/>
		);

		expect(markup).toContain('aria-label="Files in commit"');
		expect(markup).toContain('data-state="open"');
		expect(markup).toContain('data-repository-file-liquid-rail="revision"');
		expect(markup).toContain('aria-label="Back to History"');
		expect(markup).toContain("Build the stacked rail");
		expect(markup).toContain("transition-[transform,opacity]");
		expect(markup).toContain("translate-x-0");
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

	test("keeps the contextual rail mounted but inert in changes", () => {
		const markup = renderToStaticMarkup(
			<RepositoryRevisionFileRail
				diffs={[]}
				isOpen={false}
				isPending={false}
				onApplyStash={succeed}
				onBack={doNothing}
				onDropStash={succeed}
				onPopStash={succeed}
				onSelectFile={selectFile}
				revisionTitle="Selected revision"
				selectedFilePath={null}
				selectedStash={null}
				tab="changes"
			/>
		);

		expect(markup).toContain('data-state="closed"');
		expect(markup).toContain('aria-hidden="true"');
		expect(markup).toContain("pointer-events-none translate-x-full");
		expect(markup).not.toContain("data-repository-file-liquid-rail");
	});
});
