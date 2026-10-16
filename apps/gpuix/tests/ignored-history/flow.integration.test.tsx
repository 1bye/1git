/**
 * Covers: real encrypted snapshots rendered as native text diffs and restored through the review UI.
 * Real: temporary Git repository, snapshot encryption, native diff renderer, file list and restore writes.
 * Doubles: isolated in-memory credential vault; no user keys, preferences or repository writes.
 * Requires: local Git, patched native addon and macOS graphics access.
 */
import { expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { useState } from "react";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import {
	IgnoredHistory,
	defaultIgnoredPreferences,
	type IgnoredHistoryState,
	type IgnoredRepository,
} from "../../src/feature/ignored-history/ignored-history";
import { IgnoredHistoryView } from "../../src/feature/ignored-history/ignored-history-view";
import { defaultDiffSettings } from "../../src/feature/repository-workspace/lib/repository-diff";
import { AppThemeContext, appThemes } from "../../src/styles/theme";

function Flow({
	history,
	repository,
	initial,
}: {
	history: IgnoredHistory;
	repository: IgnoredRepository;
	initial: IgnoredHistoryState;
}) {
	const [data, setData] = useState(initial);

	return (
		<AppThemeContext value={{ ...appThemes.light, commitTypeBadges: true }}>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					width: "100%",
					height: "100%",
				}}
			>
				<IgnoredHistoryView
					repository={repository}
					history={history}
					status={{ data, busy: false }}
					onRefresh={async () => setData(await history.refresh(repository))}
					onSettings={() => {}}
					settings={defaultDiffSettings}
					onSettingsChange={() => {}}
				/>
			</div>
		</AppThemeContext>
	);
}

it("renders a captured .env change and restores the accepted version", async () => {
	const directory = await mkdtemp(join(tmpdir(), "1git-ignored-flow-"));
	let root: TestRoot | undefined;

	try {
		const repositoryPath = join(directory, "repo");

		await promisify(execFile)("git", ["init", "--quiet", repositoryPath]);
		await writeFile(join(repositoryPath, ".gitignore"), ".env\n");
		await writeFile(
			join(repositoryPath, ".env"),
			"API_URL=https://old.example.test\nMODE=development\n"
		);
		let key: string | null = null;

		const history = new IgnoredHistory(
			{
				async read() {
					return key;
				},
				async write(_name, value) {
					key = value;
				},
				async delete() {
					key = null;
				},
			},
			join(directory, "history")
		);

		const repository = {
			root: repositoryPath,
			commonDirectory: join(repositoryPath, ".git"),
			gitDirectory: join(repositoryPath, ".git"),
		};

		await history.configure(repository, {
			...defaultIgnoredPreferences,
			enabled: true,
			paths: [".env"],
		});
		await writeFile(
			join(repositoryPath, ".env"),
			"API_URL=https://new.example.test\nMODE=development\n"
		);
		const initial = await history.refresh(repository);

		root = createTestRoot({ width: 1100, height: 720 });
		root.render(
			<Flow history={history} repository={repository} initial={initial} />
		);
		const current = root;

		const waitFor = async (id: string) => {
			for (let attempt = 0; attempt < 100; attempt++) {
				await Bun.sleep(10);
				current.renderer.flush();
				const found = current.renderer.findByTestId(id);

				if (found) return found;
			}

			throw new Error(`Missing ${id}`);
		};

		const diff = await waitFor("ignored-history-diff-content");

		expect(diff.customProps?.patch).toContain(
			"-API_URL=https://old.example.test"
		);
		expect(diff.customProps?.patch).toContain(
			"+API_URL=https://new.example.test"
		);
		const bounds = current.renderer.getElementBounds(diff.id);

		expect(bounds?.height).toBeGreaterThan(100);

		if (process.env.GPUIX_IGNORED_SCREENSHOT)
			current.renderer.captureScreenshot(
				`${process.env.GPUIX_IGNORED_SCREENSHOT}-real.png`
			);

		current.renderer.nativeSimulateKeyDown(
			(await waitFor("ignored-history-restore")).id,
			"enter"
		);
		current.renderer.flush();
		current.renderer.nativeSimulateKeyDown(
			(await waitFor("ignored-history-restore-confirm")).id,
			"enter"
		);

		for (let attempt = 0; attempt < 100; attempt++) {
			await Bun.sleep(10);
			current.renderer.flush();

			if (
				(await readFile(join(repositoryPath, ".env"), "utf8")).includes(
					"old.example.test"
				)
			)
				break;
		}

		expect(await readFile(join(repositoryPath, ".env"), "utf8")).toContain(
			"old.example.test"
		);
	} finally {
		root?.unmount();
		await rm(directory, { recursive: true, force: true });
	}
});
