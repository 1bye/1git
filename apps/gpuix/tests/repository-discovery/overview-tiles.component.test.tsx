/**
 * Covers: compact status details, themes, stable search layouts, scroll resets and visible-only Home reads.
 * Real: Home library, bounded overview queue and native GPUIX layout/input.
 * Doubles: Git snapshots and open actions; no user files, accounts or SSH requests.
 * Requires: patched GPUIX renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { useState } from "react";
import { AppThemeContext, appThemes } from "../../src/styles/theme";
import { RepositoryWelcome } from "../../src/feature/repository-workspace/components/repository-welcome";
import type { RepositoryLibraryPreferences } from "../../src/feature/repository-discovery/repository-library";
import type { RepositoryReader } from "../../src/feature/repository-workspace/lib/repository-reader";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";

let root: TestRoot;
const available = () => true;
const empty = [] as const;

function Welcome({
	paths,
	read,
	onOpen,
	appearance = "dark",
	view = "tiles",
	folder,
}: {
	paths: readonly string[];
	read: typeof RepositoryReader.read;
	onOpen: (path: string) => void;
	appearance?: "light" | "dark";
	view?: "tiles" | "list";
	folder?: string;
}) {
	const [library, setLibrary] = useState<RepositoryLibraryPreferences>({
		starred: paths,
		view,
		folder,
	});

	return (
		<AppThemeContext
			value={{ ...appThemes[appearance], commitTypeBadges: true }}
		>
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					flexDirection: "column",
					backgroundColor: appThemes[appearance].colors.editorSurface,
				}}
			>
				<RepositoryWelcome
					paths={paths}
					library={library}
					onLibraryChange={setLibrary}
					readRepository={read}
					canReadRepository={available}
					openWorkspaces={empty}
					busy={false}
					actions={null}
					onOpen={() => {}}
					onOpenRecent={onOpen}
					onForget={() => {}}
				/>
			</div>
		</AppThemeContext>
	);
}

beforeEach(() => {
	root = createTestRoot({ width: 980, height: 640 });
	root.renderer.clockPause();
});
afterEach(() => {
	root.unmount();
});

async function settle() {
	for (let index = 0; index < 5; index++) {
		await Bun.sleep(20);
		root.renderer.flush();
	}
}

const node = (id: string) => {
	const element = root.renderer.findByTestId(id);

	if (!element) throw new Error(`Missing ${id}`);

	return element;
};

for (const appearance of ["light", "dark"] as const) {
	it(`keeps repository tiles compact while showing status in ${appearance} mode`, async () => {
		const path = "/projects/my-project";

		const base = repositorySnapshot([
			changedFile("one"),
			changedFile("two", { recordType: "untracked" }),
		]);

		const read = mock<typeof RepositoryReader.read>(async () => ({
			ok: true,
			value: {
				...base,
				head: {
					...base.head,
					branch: "feature/long-branch-name",
					upstream: "origin/main",
					ahead: 3,
					behind: 2,
				},
			},
		}));

		const open = mock();

		root.render(
			<Welcome
				paths={[path]}
				read={read}
				onOpen={open}
				appearance={appearance}
			/>
		);
		await settle();
		expect(root.renderer.getAllText()).toContain("feature/long-branch-name");
		expect(root.renderer.getAllText()).toContain("2 changed");
		expect(root.renderer.getAllText()).toContain("↓2 ↑3");
		expect(read).toHaveBeenCalledTimes(1);
		const tile = root.renderer.getElementBounds(
			node(`welcome-row-${path}`).id
		)!;

		const status = root.renderer.getElementBounds(
			node(`welcome-status-${path}`).id
		)!;

		const sync = root.renderer.getElementBounds(
			node(`welcome-sync-${path}`).id
		)!;

		expect(tile.height).toBe(112);
		expect(status.y).toBeGreaterThan(tile.y);
		expect(status.y + status.height).toBeLessThanOrEqual(tile.y + tile.height);
		expect(sync.x + sync.width).toBeLessThanOrEqual(tile.x + tile.width);
		const button = root.renderer.getElementBounds(
			node(`welcome-repository-${path}`).id
		)!;

		root.renderer.nativeSimulateClick(
			button.x + button.width / 2,
			button.y + button.height / 2
		);
		root.renderer.flush();
		expect(open).toHaveBeenCalledWith(path);
		const screenshot = process.env.GPUIX_OVERVIEW_SCREENSHOT;

		if (screenshot)
			root.renderer.captureScreenshot(`${screenshot}.${appearance}.png`);
	});
}

it("shows no upstream instead of invented tracking counts and makes failed reads explicit in list view", async () => {
	const read = mock<typeof RepositoryReader.read>(async (path) => {
		if (path.endsWith("missing")) throw new Error("Directory is missing");

		return { ok: true, value: repositorySnapshot() };
	});

	root.render(
		<Welcome
			paths={["/projects/clean", "/projects/missing"]}
			read={read}
			onOpen={() => {}}
			view="list"
			folder="other"
		/>
	);
	await settle();
	expect(root.renderer.getAllText()).toContain("Clean");
	expect(root.renderer.getAllText()).toContain("No upstream");
	expect(root.renderer.getAllText()).toContain("Status unavailable");
	expect(root.renderer.getAllText()).not.toContain("↓0 ↑0");
	const row = root.renderer.getElementBounds(
		node("welcome-row-/projects/clean").id
	)!;

	const status = root.renderer.getElementBounds(
		node("welcome-status-/projects/clean").id
	)!;

	expect(status.y + status.height).toBeLessThanOrEqual(row.y + row.height);
	expect(
		node("welcome-status-/projects/missing").customProps?.["aria-description"]
	).toBe("Directory is missing");
});

it("limits status reads to the visible part of a large repository list", async () => {
	const paths = Array.from(
		{ length: 1000 },
		(_, index) => `/projects/repo-${index}`
	);

	const read = mock<typeof RepositoryReader.read>(async () => ({
		ok: true,
		value: repositorySnapshot(),
	}));

	root.render(
		<Welcome
			paths={paths}
			read={read}
			onOpen={() => {}}
			view="list"
			folder="other"
		/>
	);
	await settle();
	expect(read.mock.calls.length).toBeGreaterThan(0);
	expect(read.mock.calls.length).toBeLessThan(25);
	expect(read.mock.calls.some(([path]) => path === paths[999])).toBe(false);
	root.renderer.focusElement(node(`welcome-repository-${paths[0]}`).id);
	root.renderer.simulateKeystrokes("end");
	root.renderer.flush();
	await settle();
	expect(read.mock.calls.some(([path]) => path === paths[999])).toBe(true);
});

it("keeps the measured tile columns on each search edit", async () => {
	const paths = [
		"/projects/alpha-one",
		"/projects/alpha-two",
		"/projects/beta",
	];

	root.render(
		<Welcome
			paths={paths}
			read={async () => ({ ok: true, value: repositorySnapshot() })}
			onOpen={() => {}}
			folder="other"
		/>
	);
	await settle();
	root.renderer.focusElement(node("welcome-search").id);

	// Inspect the first frame of every edit, before the deferred width measurement.
	for (const keystrokes of ["a", "l", "p", "backspace", "cmd-a backspace"]) {
		root.renderer.simulateKeystrokes(keystrokes);
		root.renderer.flush();
		const first = root.renderer.getElementBounds(
			node(`welcome-row-${paths[0]}`).id
		)!;

		const second = root.renderer.getElementBounds(
			node(`welcome-row-${paths[1]}`).id
		)!;

		expect(second.y).toBe(first.y);
		expect(second.x).toBeGreaterThan(first.x);
		await settle();
	}
});

for (const view of ["tiles", "list"] as const) {
	it(`returns scrolled ${view} search results to the first repository`, async () => {
		const paths = Array.from(
			{ length: 300 },
			(_, index) => `/projects/alpha-${String(index).padStart(3, "0")}`
		);

		root.render(
			<Welcome
				paths={paths}
				read={async () => ({ ok: true, value: repositorySnapshot() })}
				onOpen={() => {}}
				folder="other"
				view={view}
			/>
		);
		await settle();
		root.renderer.focusElement(node(`welcome-repository-${paths[0]}`).id);
		root.renderer.simulateKeystrokes("end");
		root.renderer.flush();
		await settle();
		expect(
			root.renderer.getListScrollTop(node("welcome-repositories").id)?.[0]
		).toBeGreaterThan(40);
		root.renderer.focusElement(node("welcome-search").id);

		for (const keystrokes of [
			"a",
			"cmd-a a l p h a - 0 0",
			"cmd-a backspace",
		]) {
			root.renderer.simulateKeystrokes(keystrokes);
			root.renderer.flush();
			const list = node("welcome-repositories");

			const first = root.renderer.getElementBounds(
				node(`welcome-row-${paths[0]}`).id
			)!;

			const viewport = root.renderer.getElementBounds(
				node("welcome-repositories-viewport").id
			)!;

			expect(root.renderer.getListScrollTop(list.id)?.slice(0, 2)).toEqual([
				0, 0,
			]);
			expect(list.customProps?.windowStart).toBe(0);
			expect(first.y).toBe(viewport.y);
			expect(first.height).toBeGreaterThan(0);
			await settle();
		}
	});
}

it("loads only visible starred repositories and follows their scroll viewport", async () => {
	const paths = Array.from(
		{ length: 40 },
		(_, index) => `/projects/starred-${index}`
	);

	const read = mock<typeof RepositoryReader.read>(async () => ({
		ok: true,
		value: repositorySnapshot(),
	}));

	root.render(<Welcome paths={paths} read={read} onOpen={() => {}} />);
	await settle();
	expect(read.mock.calls.length).toBeGreaterThan(0);
	expect(read.mock.calls.length).toBeLessThan(20);
	expect(read.mock.calls.some(([path]) => path === paths[39])).toBe(false);
	const viewport = root.renderer.getElementBounds(node("welcome-library").id)!;

	root.renderer.nativeSimulateScrollWheel(
		viewport.x + 20,
		viewport.y + 20,
		0,
		-30000
	);
	root.renderer.flush();
	await settle();
	expect(read.mock.calls.some(([path]) => path === paths[39])).toBe(true);
});
