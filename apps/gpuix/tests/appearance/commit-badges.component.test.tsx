/**
 * Covers: compact light/dark badges, scoped/breaking titles, tags, narrow-row clipping and original context-menu/accessible subjects; files and stashes remain plain.
 * Real: shared revision list, commit parser, app theme and native layout/input.
 * Doubles: generated Git entries and captured selection/menu callbacks; no Git or preference I/O.
 * Requires: patched GPUIX addon and macOS graphics access.
 */
import { expect, it } from "bun:test";
import { createTestRoot } from "@gpuix/react/testing";
import { AppThemeContext, appThemes } from "../../src/styles/theme";
import { RepositoryList } from "../../src/feature/repository-workspace/components/repository-list";
import { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import { commitInfo } from "../_shared/history-page";
import type { WorkspaceEntry } from "../../src/feature/repository-workspace/types";

function contrast(text: string, background: string): number {
	const luminance = (color: string): number => {
		const channels = [1, 3, 5].map((offset) => {
			const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;

			return value <= 0.04045
				? value / 12.92
				: ((value + 0.055) / 1.055) ** 2.4;
		});

		return (
			channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
		);
	};

	const first = luminance(text);
	const second = luminance(background);

	return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

for (const appearance of ["light", "dark"] as const) {
	it(`keeps ${appearance} badges small, readable and display-only through selection and context menus`, () => {
		const root = createTestRoot({ width: 440, height: 640 });

		const original =
			"refactor(db)!: generate the schema baseline and keep a long title clipped";

		const entries: readonly WorkspaceEntry[] = [
			{
				...RepositoryHistory.entry({ ...commitInfo(), summary: original }),
				tags: [
					{
						name: "v1.0.0",
						oid: "e".repeat(40),
						targetOid: commitInfo().oid,
						type: "lightweight",
						message: "",
						createdAt: null,
					},
				],
			},
			...[
				"feat",
				"fix",
				"perf",
				"docs",
				"test",
				"build",
				"ci",
				"chore",
				"style",
				"revert",
			].map((type, index) =>
				RepositoryHistory.entry({
					...commitInfo(index + 1),
					summary: `${type}: improve the workspace`,
				})
			),
			RepositoryHistory.entry({
				...commitInfo(12),
				summary: "Keep an ordinary message",
			}),
			{ id: "stash", title: "feat: saved work", detail: "Saved locally" },
			{ id: "file", title: "fix: filename.ts", status: "M" },
		];

		let menuSubject: string | undefined;
		let selected: string | undefined;

		const show = (commitTypeBadges = true) =>
			root.render(
				<AppThemeContext value={{ ...appThemes[appearance], commitTypeBadges }}>
					<div
						style={{
							width: 320,
							height: "100%",
							backgroundColor: appThemes[appearance].colors.editorSurface,
						}}
					>
						<RepositoryList
							entries={entries}
							label="Commit history"
							emptyMessage="No commits"
							state={{ selectedId: entries[0]!.id, scrollY: 0 }}
							onSelect={(id) => {
								selected = id;
							}}
							onScroll={() => {}}
							onContextMenu={(entry) => {
								menuSubject = entry.title;
							}}
						/>
					</div>
				</AppThemeContext>
			);

		try {
			root.renderer.clockPause();
			show();
			const row = root.renderer.findByTestId(`entry-${entries[0]!.id}`)!;

			const subject = root.renderer.findByTestId(
				`commit-subject-${entries[0]!.id}`
			)!;

			const rowBounds = root.renderer.getElementBounds(row.id)!;
			const subjectBounds = root.renderer.getElementBounds(subject.id)!;

			expect(row.customProps?.["aria-label"]).toBe(original);
			expect(subject.customProps?.["aria-label"]).toBe(original);
			expect(root.renderer.getAllText()).toContain("refactor!");
			expect(root.renderer.getAllText()).toContain(
				"(db) generate the schema baseline and keep a long title clipped"
			);
			expect(root.renderer.getAllText()).toContain("v1.0.0");
			expect(subjectBounds.x + subjectBounds.width).toBeLessThanOrEqual(
				rowBounds.x + rowBounds.width
			);
			expect(
				root.renderer.getElementBounds(
					root.renderer.findByTestId(`row-${entries[0]!.id}`)!.id
				)!.height
			).toBe(48);

			for (const entry of entries.slice(0, 11)) {
				const badge = root.renderer.findByTestId(
					`commit-subject-${entry.id}-badge`
				)!;

				const bounds = root.renderer.getElementBounds(badge.id)!;

				expect(bounds.height).toBeLessThanOrEqual(16);
				expect(badge.style.fontSize).toBe(10);
				expect(
					contrast(
						String(badge.style.color),
						String(badge.style.backgroundColor)
					)
				).toBeGreaterThanOrEqual(4.5);
			}

			expect(
				root.renderer.findByTestId(`commit-subject-${entries[11]!.id}-badge`)
			).toBeUndefined();
			expect(
				root.renderer.findByTestId("commit-subject-stash-badge")
			).toBeUndefined();
			expect(
				root.renderer.findByTestId("commit-subject-file-badge")
			).toBeUndefined();
			expect(root.renderer.getAllText()).toContain("feat: saved work");
			root.renderer.nativeSimulateClick(rowBounds.x + 12, rowBounds.y + 12);
			root.renderer.flush();
			expect(selected).toBe(entries[0]!.id);
			root.renderer.nativeSimulateKeyDown(row.id, "shift-f10");
			root.renderer.flush();
			expect(menuSubject).toBe(original);
			expect(entries[0]!.title).toBe(original);

			if (process.env.GPUIX_COMMIT_BADGES_SCREENSHOT)
				root.renderer.captureScreenshot(
					`${process.env.GPUIX_COMMIT_BADGES_SCREENSHOT}-${appearance}.png`
				);

			show(false);
			expect(root.renderer.getAllText()).toContain(original);
			expect(
				root.renderer.findByTestId(`commit-subject-${entries[0]!.id}-badge`)
			).toBeUndefined();
		} finally {
			root.unmount();
		}
	});
}
