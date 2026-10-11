/**
 * Covers: selected-commit descriptions, native disclosure/copy controls, light/dark layout, file-switch preservation and empty commits.
 * Real: App, History state, shared badges, commit details and native GPUIX layout/input.
 * Doubles: Git readers and captured clipboard writes; no Git, network or OS clipboard changes.
 * Requires: patched GPUIX addon with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import type { TagInfo } from "@1git/git";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { Profiler } from "react";
import { App } from "../../src/app";
import { NativeClipboard } from "../../src/platform/clipboard";
import { AppThemeContext, appThemes } from "../../src/styles/theme";
import { RepositoryCommitDetails } from "../../src/feature/repository-workspace/components/repository-commit-details";
import { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import {
	commitInfo,
	committedFiles,
	historyPage,
} from "../_shared/history-page";
import { repositorySnapshot } from "../_shared/repository-snapshot";

let root: TestRoot;

beforeEach(() => {
	root = createTestRoot({ width: 980, height: 640 });
	root.renderer.clockPause();
});

afterEach(() => {
	root.unmount();
	mock.restore();
});

function element(id: string) {
	const node = root.renderer.findByTestId(id);

	if (!node) throw new Error(`Missing element: ${id}`);

	return node;
}

function bounds(id: string) {
	const box = root.renderer.getElementBounds(element(id).id);

	if (!box) throw new Error(`Missing bounds: ${id}`);

	return box;
}

function click(id: string): void {
	const box = bounds(id);

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2
	);
	root.renderer.flush();
}

async function settle(): Promise<void> {
	await Bun.sleep(0);
	root.renderer.flush();
}

const subject =
	"refactor(db): keep the full selected commit title readable above its files";

const description = Array.from(
	{ length: 20 },
	(_, index) => `Description line ${index + 1}: explain the change.`
).join("\n");

const commit = {
	...commitInfo(),
	summary: subject,
	body: `${subject}\n\n${description}`,
};

const tags: readonly TagInfo[] = [
	{
		name: "v1.0.0",
		targetOid: commit.oid,
		oid: "e".repeat(40),
		type: "lightweight",
		createdAt: null,
		message: "",
	},
	{
		name: "another-commit",
		targetOid: commitInfo(1).oid,
		oid: "f".repeat(40),
		type: "lightweight",
		createdAt: null,
		message: "",
	},
];

for (const appearance of ["light", "dark"] as const) {
	it(`shows compact ${appearance} metadata, bounds long descriptions and supports keyboard disclosure/copy`, async () => {
		const clipboard = spyOn(NativeClipboard, "write").mockResolvedValue();

		root.render(
			<AppThemeContext
				value={{ ...appThemes[appearance], commitTypeBadges: true }}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						width: 540,
						height: "100%",
						backgroundColor: appThemes[appearance].colors.editorSurface,
					}}
				>
					<RepositoryCommitDetails
						key={commit.oid}
						commit={commit}
						tags={tags}
					/>
					<div testId="file-toolbar" style={{ height: 36 }}>
						<text>file.ts · src</text>
					</div>
					<div testId="preview" style={{ flexGrow: 1 }} />
				</div>
			</AppThemeContext>
		);

		expect(root.renderer.getAllText()).toContain("refactor");
		expect(root.renderer.getAllText()).toContain(
			"(db) keep the full selected commit title readable above its files"
		);
		expect(element("commit-details-title").customProps?.["aria-label"]).toBe(
			subject
		);
		expect(
			element("commit-details-author").customProps?.["aria-label"]
		).toContain(commit.author.email);
		expect(
			element("commit-details-date").customProps?.["aria-label"]
		).toContain("Authored");
		expect(element("commit-details-tags").customProps?.["aria-label"]).toBe(
			"Tags: v1.0.0"
		);
		expect(
			element("commit-details-description").customProps?.["aria-label"]
		).toBe(description);
		expect(bounds("commit-details-description-viewport").height).toBe(48);
		expect(bounds("commit-details-description").height).toBeGreaterThan(48);
		expect(bounds("file-toolbar").y).toBeGreaterThan(
			bounds("commit-details").y
		);
		expect(bounds("preview").height).toBeGreaterThan(200);
		expect(
			element("commit-details-toggle-description").customProps?.[
				"aria-expanded"
			]
		).toBe(false);

		root.renderer.focusElement(element("commit-details-toggle-description").id);
		root.renderer.nativeSimulateKeyDown(
			element("commit-details-toggle-description").id,
			"enter"
		);
		root.renderer.flush();
		expect(
			element("commit-details-toggle-description").customProps?.[
				"aria-expanded"
			]
		).toBe(true);
		expect(bounds("commit-details-description-viewport").height).toBe(160);
		expect(bounds("preview").height).toBeGreaterThan(200);

		const box = bounds("commit-details-description-viewport");

		root.renderer.nativeSimulateScrollWheel(box.x + 80, box.y + 30, 0, -100);
		root.renderer.flush();
		expect(
			root.renderer.getScrollOffset(
				element("commit-details-description-viewport").id
			)?.[1]
		).toBeLessThan(0);
		click("commit-details-toggle-description");
		expect(bounds("commit-details-description-viewport").height).toBe(48);
		root.renderer.focusElement(element("commit-details-copy-sha").id);
		root.renderer.nativeSimulateKeyDown(
			element("commit-details-copy-sha").id,
			"enter"
		);
		await settle();
		expect(clipboard).toHaveBeenCalledWith(commit.oid);
		expect(root.renderer.getAllText().join("\n")).toContain("Copied");

		if (process.env.GPUIX_COMMIT_DETAILS_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_COMMIT_DETAILS_SCREENSHOT}-${appearance}.png`
			);
	});
}

it.each([1, 2, 3])(
	"fits a %i-line description without reserving unused space",
	(lines) => {
		const shortDescription = Array.from(
			{ length: lines },
			(_, index) => `Description line ${index + 1}.`
		).join("\n");

		root.render(
			<AppThemeContext value={{ ...appThemes.dark, commitTypeBadges: true }}>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						width: 540,
						height: "100%",
						backgroundColor: appThemes.dark.colors.editorSurface,
					}}
				>
					<RepositoryCommitDetails
						commit={{ ...commit, body: `${subject}\n\n${shortDescription}` }}
						tags={[]}
					/>
					<div testId="file-toolbar" style={{ height: 36 }}>
						<text>file.ts · src</text>
					</div>
					<div testId="preview" style={{ flexGrow: 1 }} />
				</div>
			</AppThemeContext>
		);

		const text = bounds("commit-details-description");
		const viewport = bounds("commit-details-description-viewport");
		const details = bounds("commit-details");

		expect(text.height).toBe(lines * 16);
		expect(viewport.height).toBe(text.height);
		expect(details.y + details.height - (text.y + text.height)).toBe(11);
		expect(bounds("file-toolbar").y).toBe(details.y + details.height);
		expect(
			root.renderer.findByTestId("commit-details-toggle-description")
		).toBeUndefined();

		if (lines === 2 && process.env.GPUIX_COMMIT_DETAILS_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_COMMIT_DETAILS_SCREENSHOT}-short.png`
			);
	}
);

it("fits the first paragraph of a longer description and preserves the rest behind inline disclosure", () => {
	const firstParagraph =
		"Repeated source scans and linear alias deduplication slow large scenes.\nBound source-index lifetime and preserve alias order and probe isolation.";

	const fullDescription = `${firstParagraph}\n\nRecord measured gains and selected-layer playback findings. The overlay\ncache trial was reverted because repeated playback measurements showed\nno reliable gain.`;

	root.render(
		<AppThemeContext value={{ ...appThemes.dark, commitTypeBadges: true }}>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					width: 900,
					height: "100%",
					backgroundColor: appThemes.dark.colors.editorSurface,
				}}
			>
				<RepositoryCommitDetails
					commit={{
						...commit,
						summary: "perf: speed up parsing and selector lookup",
						body: `perf: speed up parsing and selector lookup\n\n${fullDescription}`,
					}}
					tags={[]}
				/>
				<div testId="file-toolbar" style={{ height: 36 }}>
					<text>span.ts · core/alt-parser/src</text>
				</div>
				<div testId="preview" style={{ flexGrow: 1 }} />
			</div>
		</AppThemeContext>
	);

	expect(root.renderer.getAllText()).toContain(firstParagraph);
	expect(bounds("commit-details-description-viewport").height).toBe(32);
	expect(bounds("commit-details-toggle-description").y).toBeLessThan(
		bounds("commit-details-description").y
	);
	expect(
		bounds("file-toolbar").y -
			(bounds("commit-details-description").y +
				bounds("commit-details-description").height)
	).toBe(11);

	if (process.env.GPUIX_COMMIT_DETAILS_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_COMMIT_DETAILS_SCREENSHOT}-paragraphs.png`
		);

	click("commit-details-toggle-description");
	expect(root.renderer.getAllText()).toContain(fullDescription);
	expect(bounds("commit-details-description-viewport").height).toBe(96);
	click("commit-details-toggle-description");
	expect(bounds("commit-details-description-viewport").height).toBe(32);
});

it("hides absent descriptions and unnecessary disclosure, and reports clipboard failures", async () => {
	const clipboard = spyOn(NativeClipboard, "write").mockRejectedValue(
		new Error("Clipboard unavailable")
	);

	const show = (body: string) =>
		root.render(
			<RepositoryCommitDetails
				key={body}
				commit={{ ...commit, body }}
				tags={[]}
			/>
		);

	show(subject);
	expect(
		root.renderer.findByTestId("commit-details-description")
	).toBeUndefined();
	expect(
		root.renderer.findByTestId("commit-details-toggle-description")
	).toBeUndefined();
	expect(root.renderer.findByTestId("commit-details-tags")).toBeUndefined();
	show(`${subject}\n\nShort description.`);
	expect(root.renderer.getAllText()).toContain("Short description.");
	expect(
		root.renderer.findByTestId("commit-details-toggle-description")
	).toBeUndefined();
	click("commit-details-copy-sha");
	await settle();
	expect(root.renderer.getAllText()).toContain(
		"Could not copy SHA. Try again."
	);
	clipboard.mockResolvedValue();
	click("commit-details-copy-sha");
	await settle();
	expect(root.renderer.getAllText().join("\n")).not.toContain(
		"Could not copy SHA"
	);
});

it("wraps full titles and single-paragraph descriptions in narrow panes with badges disabled", () => {
	const title = `${subject} and preserve more detail without truncating the selected title`;

	const paragraph =
		"Explain why this changed and how it affects the repository. "
			.repeat(20)
			.trim();

	root.render(
		<AppThemeContext value={{ ...appThemes.dark, commitTypeBadges: false }}>
			<div
				style={{
					width: 260,
					height: "100%",
					display: "flex",
					flexDirection: "column",
				}}
			>
				<RepositoryCommitDetails
					key={commit.oid}
					commit={{
						...commit,
						summary: title,
						body: `${title}\n\n${paragraph}`,
						authoredAt: "Unknown date",
					}}
					tags={[]}
				/>
			</div>
		</AppThemeContext>
	);

	expect(root.renderer.getAllText()).toContain(title);
	expect(bounds("commit-details-title").height).toBeGreaterThan(16);
	expect(bounds("commit-details-title").width).toBeLessThanOrEqual(260);
	expect(
		root.renderer.findByTestId("commit-details-title-badge")
	).toBeUndefined();
	expect(root.renderer.getAllText()).toContain("· Unknown date");
	expect(
		element("commit-details-description").customProps?.["aria-label"]
	).toBe(paragraph);
	expect(bounds("commit-details-description-viewport").height).toBe(48);
	expect(
		element("commit-details-toggle-description").customProps?.["aria-expanded"]
	).toBe(false);
});

it("keeps details and disclosure when switching files, resets on commit selection, and shows empty commit metadata", async () => {
	let renders = 0;

	const pages = mock(async () => ({
		ok: true as const,
		value: {
			...historyPage(0, 2),
			commits: [
				commit,
				{
					...commitInfo(1),
					body: "Empty commit\n\nNo changed files.",
					summary: "Empty commit",
				},
			],
		},
	}));

	const files = mock<typeof RepositoryHistory.readFiles>(
		async (_root, oid) => ({
			ok: true,
			value: oid === commit.oid ? committedFiles(oid, 2) : [],
		})
	);

	const readTags = mock(async () => ({ ok: true as const, value: tags }));

	root.render(
		<Profiler id="history-details" onRender={() => renders++}>
			<App
				initialSession={{
					version: 1,
					activeId: "workspace-1",
					tabs: [{ id: "workspace-1", path: "/test/project", draft: "" }],
				}}
				readRepository={async () => ({ ok: true, value: repositorySnapshot() })}
				readHistory={pages}
				readCommitFiles={files}
				readTags={readTags}
				readLastCommit={async () => ({
					ok: true,
					value: { commit, undoUnavailableReason: null },
				})}
				readDiff={async (_root, file) => ({
					ok: true,
					value: [
						{
							target: "commit",
							patch: `diff --git a/${file.path} b/${file.path}\n--- a/${file.path}\n+++ b/${file.path}\n@@ -0,0 +1,100 @@\n${Array.from({ length: 100 }, (_, index) => `+const line${index} = true;`).join("\n")}\n`,
							stats: [],
							message: null,
						},
					],
				})}
			/>
		</Profiler>
	);
	await settle();
	click("view-history");
	await settle();
	await settle();
	await settle();

	expect(element("commit-details-tags").customProps?.["aria-label"]).toBe(
		"Tags: v1.0.0"
	);
	expect(bounds("commit-details").y + bounds("commit-details").height).toBe(
		bounds("diff-header").y
	);
	click("commit-details-toggle-description");
	click("entry-src/file-1.ts");
	await settle();
	await settle();
	expect(element("diff-identity").customProps?.["aria-label"]).toBe(
		"src/file-1.ts"
	);
	expect(
		element("commit-details-toggle-description").customProps?.["aria-expanded"]
	).toBe(true);
	expect(pages).toHaveBeenCalledTimes(1);
	expect(readTags).toHaveBeenCalledTimes(1);
	expect(files).toHaveBeenCalledTimes(1);
	renders = 0;
	const diffBox = bounds("diff-viewport");

	for (let tick = 0; tick < 20; tick++) {
		root.renderer.nativeSimulateScrollWheel(
			diffBox.x + 100,
			diffBox.y + 50,
			0,
			-12
		);
		root.renderer.flush();
	}

	expect(
		root.renderer.getScrollOffset(element("diff-viewport-content").id)?.[1]
	).toBeLessThan(-100);
	expect(renders).toBe(0);
	expect(pages).toHaveBeenCalledTimes(1);
	expect(readTags).toHaveBeenCalledTimes(1);

	if (process.env.GPUIX_COMMIT_DETAILS_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_COMMIT_DETAILS_SCREENSHOT}-app.png`
		);

	click(`entry-${commitInfo(1).oid}`);
	await settle();
	await settle();
	expect(root.renderer.getAllText()).toContain("No changed files.");
	expect(root.renderer.getAllText()).toContain("No file changes");
	expect(
		root.renderer.findByTestId("commit-details-toggle-description")
	).toBeUndefined();
	click(`entry-${commit.oid}`);
	await settle();
	await settle();
	expect(
		element("commit-details-toggle-description").customProps?.["aria-expanded"]
	).toBe(false);
	click("view-changes");
	expect(root.renderer.findByTestId("commit-details")).toBeUndefined();
	click("view-stashes");
	expect(root.renderer.findByTestId("commit-details")).toBeUndefined();
});
