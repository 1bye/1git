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
});
