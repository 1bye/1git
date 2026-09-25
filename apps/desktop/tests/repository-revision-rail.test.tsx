import { describe, expect, test } from "bun:test";

import type { CommitInfo, FileDiff, StashInfo } from "@1git/git";
import { renderToStaticMarkup } from "react-dom/server";

import { LiquidMenuStackProvider } from "../src/renderer/src/fixture/liquid-menu/components/liquid-menu-stack-provider.js";
import { RepositoryHistoryRail } from "../src/renderer/src/fixture/repository-workspace/components/repository-history-rail.js";
import {
	RepositoryRevisionFileRail,
	RepositoryStashRail,
} from "../src/renderer/src/fixture/repository-workspace/components/repository-revision-rail.js";
import { createRepositoryDiffFileEntries } from "../src/renderer/src/fixture/repository-workspace/lib/repository-diff-files.js";

const REVISION_DIFF: FileDiff = {
	patch: `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1 @@
-old
+new
diff --git a/README.md b/README.md
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/README.md
@@ -0,0 +1 @@
+readme
`,
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

const COMMITS: readonly CommitInfo[] = [
	{
		author: { email: "yurii@example.com", name: "Yurii Hulyk" },
		authoredAt: "2026-08-11T10:00:00.000Z",
		body: "",
		committedAt: "2026-08-11T10:00:00.000Z",
		committer: { email: "yurii@example.com", name: "Yurii Hulyk" },
		oid: "commit-one",
		parentOids: ["parent-oid"],
		summary: "Connect revision selection",
	},
	{
		author: { email: "yurii@example.com", name: "Yurii Hulyk" },
		authoredAt: "2026-08-11T09:00:00.000Z",
		body: "",
		committedAt: "2026-08-11T09:00:00.000Z",
		committer: { email: "yurii@example.com", name: "Yurii Hulyk" },
		oid: "commit-two",
		parentOids: ["older-parent-oid"],
		summary: "Polish revision navigation",
	},
];

const REVISION_ENTRIES = createRepositoryDiffFileEntries(
	[REVISION_DIFF],
	[],
	"revision-oid",
	"history"
);

const succeed = async (): Promise<boolean> => true;
const selectCommit = async (): Promise<void> => undefined;
const selectFile = async (): Promise<void> => undefined;
const selectStash = async (): Promise<void> => undefined;

describe("repository revision rails", () => {
	test("shows revision files on the contextual canvas shelf", () => {
		const markup = renderToStaticMarkup(
			<RepositoryRevisionFileRail
				diffs={[REVISION_DIFF]}
				entries={REVISION_ENTRIES}
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
		expect(markup).toContain('data-repository-context-shelf=""');
		expect(markup).toContain("bg-editor-sunken");
		expect(markup).toContain("transition-[width]");
		expect(markup).toContain("w-(--repository-context-rail-width)");
		expect(markup).toContain('aria-current="true"');
		expect(markup).toContain("src/");
		expect(markup).toContain("app.ts");
		expect(markup).toContain('data-status="modified"');
		expect(markup).toContain('data-status="added"');
		expect(markup).not.toContain("+3");
		expect(markup).not.toContain("−1");
		expect(markup).toContain(
			'data-repository-revision-navigation-group="files"'
		);
		expect(markup).toContain(
			'data-repository-revision-navigation-item="src/app.ts"'
		);
		expect(markup).toContain('tabindex="0"');
		expect(markup).not.toContain("focus-visible:ring-inset");
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
		expect(markup).toContain(
			'data-repository-revision-navigation-group="revisions"'
		);
		expect(markup).toContain(
			'data-repository-revision-navigation-item="stash-two"'
		);
		expect(markup).toContain('data-repository-revision-liquid-active="true"');
		expect(markup).not.toContain("bg-brand-softer");
		expect(markup).not.toContain("focus-visible:ring-inset");
	});

	test("marks the selected commit as the liquid revision anchor", () => {
		const markup = renderToStaticMarkup(
			<LiquidMenuStackProvider>
				<RepositoryHistoryRail
					branches={null}
					currentBranch="main"
					headOid="commit-one"
					history={{ commits: COMMITS, hasMore: false, nextOffset: null }}
					isPending={false}
					onAmendCommit={succeed}
					onCherryPickCommit={succeed}
					onCreateBranch={succeed}
					onResetCommit={succeed}
					onRevertCommit={succeed}
					onSelectCommit={selectCommit}
					selectedCommitOid="commit-two"
				/>
			</LiquidMenuStackProvider>
		);

		expect(markup.match(/aria-current="true"/g)).toHaveLength(1);
		expect(markup).toContain('data-repository-revision-liquid-active="true"');
		expect(markup).toContain(
			'data-repository-revision-navigation-item="commit-two"'
		);
		expect(markup).not.toContain("bg-brand-softer");
		expect(markup).not.toContain("focus-visible:ring-inset");
	});

	test("keeps stash actions above the revision files", () => {
		const markup = renderToStaticMarkup(
			<LiquidMenuStackProvider>
				<RepositoryRevisionFileRail
					diffs={[REVISION_DIFF]}
					entries={REVISION_ENTRIES}
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
				entries={[]}
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
