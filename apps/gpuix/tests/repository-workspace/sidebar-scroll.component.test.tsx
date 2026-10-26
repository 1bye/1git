/**
 * Covers: enabled pane scrollbars, native wheel frame cost and React work in Changes, History and Stashes sidebars.
 * Real: repository navigation/reducer, React Profiler and native layout/paint/events.
 * Doubles: generated repository/revision data; no Git, accounts or personal files.
 * Requires: patched release GPUIX addon and macOS graphics access.
 */
import { afterEach, expect, it, mock } from "bun:test";
import { Profiler, useState } from "react";
import { createTestRoot } from "@gpuix/react/testing";
import { AppThemeContext, appThemes } from "../../src/styles/theme";
import { RepositoryNavigation } from "../../src/feature/repository-workspace/components/repository-navigation";
import { RepositoryWorkspaceModel as Model } from "../../src/feature/repository-workspace/lib/repository-workspace-model";
import type { RepositoryView } from "../../src/feature/repository-workspace/types";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";
import { historyPage } from "../_shared/history-page";
import { stashList } from "../_shared/stash-list";
import { prepareNativeInputFrames } from "../_shared/native-input-frame";

const scrollbarTheme = {
	...appThemes.light,
	tokens: { ...appThemes.light.tokens, showScrollbars: true },
	commitTypeBadges: true,
};

// Match the live renderer's 8ms frame loop; exclude idle time from measured work.
const frameIntervalMs = 8;

afterEach(() => mock.restore());

function Sidebar({
	view,
	count,
	onScrollSave,
}: {
	view: RepositoryView;
	count: number;
	onScrollSave?: (y: number) => void;
}) {
	const [state, setState] = useState(() => {
		const snapshot = repositorySnapshot(
			Array.from({ length: count }, (_, index) =>
				changedFile(`src/components/file-${index}.tsx`)
			)
		);

		let initial = Model.reduce(Model.create(), { type: "loaded", snapshot });

		if (view === "history") {
			const page = historyPage(0, count);

			initial = Model.reduce(initial, {
				type: "history-page",
				root: snapshot.repository.root,
				head: snapshot.head.oid ?? "",
				offset: 0,
				page: {
					...page,
					commits: page.commits.map((commit, index) => ({
						...commit,
						oid: index.toString(16).padStart(40, "0"),
						summary: `${index % 2 ? "fix" : "refactor(db)"}: improve workspace ${index}`,
					})),
				},
			});
		}

		if (view === "stashes")
			initial = Model.reduce(initial, {
				type: "stashes-loaded",
				root: snapshot.repository.root,
				generation: initial.stashes.generation,
				stashes: stashList(count),
			});

		return Model.reduce(initial, { type: "view", view });
	});

	return (
		<AppThemeContext value={scrollbarTheme}>
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					width: "100%",
					height: "100%",
					backgroundColor: "#ffffff",
				}}
			>
				<RepositoryNavigation
					workspaceId="scroll-fixture"
					state={state}
					onAction={(action) => {
						if (action.type === "scroll") onScrollSave?.(action.y);

						setState((previous) => Model.reduce(previous, action));
					}}
					onRefresh={() => {}}
				/>
			</div>
		</AppThemeContext>
	);
}

for (const view of ["changes", "history", "stashes"] as const) {
	for (const count of [30, 300, 3000]) {
		it(`keeps ${view} wheel scrolling within budget with ${count} items`, async () => {
			const root = createTestRoot({ width: 980, height: 720 });
			const commits: number[] = [];

			try {
				root.renderer.clockPause();
				root.render(
					<Profiler
						id="sidebar"
						onRender={(_id, _phase, duration) => commits.push(duration)}
					>
						<Sidebar view={view} count={count} />
					</Profiler>
				);
				const list = root.renderer.findByTestId("repository-list");
				const viewport = root.renderer.findByTestId("repository-list-viewport");
				const box = viewport && root.renderer.getElementBounds(viewport.id);

				if (!list || !box) throw new Error("Missing sidebar viewport");

				const flushInputChanges = prepareNativeInputFrames(root);

				commits.length = 0;
				root.renderer.resetDebugFrameOverlayStats();
				const frames: number[] = [];

				for (let tick = 0; tick < 40; tick++) {
					const start = performance.now();

					root.renderer.dispatchScrollWheel(box.x + 80, box.y + 40, 0, -12);
					flushInputChanges();
					const elapsed = performance.now() - start;

					frames.push(elapsed);
					await Bun.sleep(Math.max(0, frameIntervalMs - elapsed));
				}

				const draw = root.renderer.getDebugFrameOverlayStats();
				const sorted = frames.toSorted((left, right) => left - right);
				const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;

				const reactMs = commits.reduce(
					(total, duration) => total + duration,
					0
				);

				process.stdout.write(
					`${view} ${count}: wheel p90=${p90.toFixed(2)}ms draw p90=${draw.p90Ms?.toFixed(2)}ms React commits=${commits.length} React total=${reactMs.toFixed(2)}ms\n`
				);
				expect(root.renderer.getScrollOffset(list.id)?.[1]).toBeLessThan(-100);
				expect(p90).toBeLessThan(16.7);
				expect(draw.p90Ms).toBeLessThan(12);
				expect(commits.length).toBeLessThanOrEqual(3);

				if (
					process.env.SIDEBAR_SCREENSHOT &&
					view === "changes" &&
					count === 300
				)
					root.renderer.captureScreenshot(process.env.SIDEBAR_SCREENSHOT);
			} finally {
				root.unmount();
			}
		});
	}
}

for (const view of ["changes", "history", "stashes"] as const) {
	it(`keeps ${view} populated through fast scrolling and persists only settled positions`, async () => {
		const root = createTestRoot({ width: 980, height: 720 });
		const commits: number[] = [];
		const savedPositions: number[] = [];

		try {
			root.renderer.clockPause();
			root.render(
				<Profiler
					id="buffered-sidebar"
					onRender={(_id, _phase, duration) => commits.push(duration)}
				>
					<Sidebar
						view={view}
						count={3000}
						onScrollSave={(y) => savedPositions.push(y)}
					/>
				</Profiler>
			);
			const list = root.renderer.findByTestId("repository-list");
			const viewport = root.renderer.findByTestId("repository-list-viewport");
			const box = viewport && root.renderer.getElementBounds(viewport.id);

			if (!list || !box) throw new Error("Missing sidebar viewport");

			const flushInputChanges = prepareNativeInputFrames(root);

			commits.length = 0;
			const frames: number[] = [];

			for (let tick = 0; tick < 120; tick++) {
				const start = performance.now();

				root.renderer.dispatchScrollWheel(box.x + 80, box.y + 40, 0, -48);
				flushInputChanges();
				const elapsed = performance.now() - start;

				frames.push(elapsed);
				await Bun.sleep(Math.max(0, frameIntervalMs - elapsed));

				if (tick % 12 !== 0) continue;

				const anchor = root.renderer.getListScrollTop(list.id);
				const index = anchor?.[0] ?? 0;

				const id =
					view === "changes"
						? `src/components/file-${index}.tsx`
						: view === "history"
							? index.toString(16).padStart(40, "0")
							: (index + 1).toString(16).padStart(40, "0");

				const visible = root.renderer.findByTestId(`entry-${id}`);

				expect(visible).toBeDefined();

				if (!visible) throw new Error("Missing scrolled row");

				expect(root.renderer.getElementBounds(visible.id)).not.toBeNull();
			}

			const p90 =
				frames.toSorted((left, right) => left - right)[
					Math.floor(frames.length * 0.9)
				] ?? 0;

			process.stdout.write(
				`${view} fast scroll: wheel p90=${p90.toFixed(2)}ms max=${Math.max(...frames).toFixed(2)}ms React commits=${commits.length}\n`
			);
			expect(p90).toBeLessThan(16.7);
			expect(commits.length).toBeLessThanOrEqual(10);
			expect(root.renderer.getScrollOffset(list.id)?.[1]).toBeLessThan(-5000);
			expect(savedPositions).toEqual([]);
			await Bun.sleep(180);
			root.renderer.flush();
			expect(savedPositions).toHaveLength(1);
			const saved = root.renderer.getScrollOffset(list.id);

			await Bun.sleep(180);
			root.renderer.flush();
			expect(savedPositions).toHaveLength(1);
			expect(root.renderer.getScrollOffset(list.id)).toEqual(saved);
		} finally {
			root.unmount();
		}
	}, 15000);
}
