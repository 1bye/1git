/**
 * Covers: unpushed indicators, compact light/dark layout, metadata refresh and stale/error reads.
 * Real: App, History hook, workspace state and native GPUIX layout/events.
 * Doubles: Git readers and folder picker; no live repositories or network writes.
 * Requires: patched GPUIX renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import type { ComponentProps } from "react";
import { App } from "../../src/app";
import type { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import { windowOptions } from "../../src/window-options";
import { commitInfo, historyPage } from "../_shared/history-page";
import { repositorySnapshot } from "../_shared/repository-snapshot";

let root: TestRoot;

beforeEach(() => {
	root = createTestRoot({
		width: 980,
		height: 640,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	spyOn(root.renderer, "promptForPaths").mockResolvedValue(["/test/project"]);
});

afterEach(() => {
	root.unmount();
	mock.restore();
});

function element(id: string) {
	const node = root.renderer.findByTestId(id);

	if (!node) throw new Error(`Missing ${id}`);

	return node;
}

function bounds(id: string) {
	const box = root.renderer.getElementBounds(element(id).id);

	if (!box) throw new Error(`Missing bounds ${id}`);

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

async function waitFor(ready: () => boolean): Promise<void> {
	const deadline = performance.now() + 2000;

	while (!ready()) {
		if (performance.now() > deadline)
			throw new Error("Timed out waiting for push status.");

		await Bun.sleep(5);
		root.renderer.flush();
	}
}

function show(
	props: ComponentProps<typeof App> = {},
	appearance: "light" | "dark" = "light"
): void {
	root.render(
		<App
			initialSession={{
				version: 1,
				activeId: "workspace-1",
				appearance,
				tabs: [{ id: "workspace-1", path: null, draft: "" }],
			}}
			readRepository={async () => ({ ok: true, value: repositorySnapshot() })}
			readHistory={async () => ({ ok: true, value: historyPage(0, 3) })}
			readHistoryCount={async () => ({ ok: true, value: 3 })}
			readCommitFiles={async () => ({ ok: true, value: [] })}
			readTags={async () => ({ ok: true, value: [] })}
			readUnpushedCommits={async () => ({
				ok: true,
				value: [commitInfo(1).oid],
			})}
			{...props}
		/>
	);
}

async function openHistory(): Promise<void> {
	click("open-repository");
	await waitFor(() => !!root.renderer.findByTestId("refresh-repository"));
	click("view-history");
	await waitFor(
		() => !!root.renderer.findByTestId(`entry-${commitInfo(1).oid}`)
	);
}

for (const appearance of ["light", "dark"] as const)
	it(`reserves a muted trailing arrow without overlapping long subjects and tags in ${appearance}`, async () => {
		const page = historyPage(0, 3);
		const oid = commitInfo(1).oid;

		const pages = mock<typeof RepositoryHistory.read>(async () => ({
			ok: true,
			value: {
				...page,
				commits: page.commits.map((commit) =>
					commit.oid === oid
						? {
								...commit,
								summary:
									"feat(history): keep a very long commit subject readable alongside release tags and publication status",
							}
						: commit
				),
			},
		}));

		show(
			{
				readHistory: pages,
				readTags: async () => ({
					ok: true,
					value: [
						{
							name: "v1.2.3",
							oid: "e".repeat(40),
							targetOid: oid,
							type: "lightweight",
							createdAt: null,
							message: "",
						},
					],
				}),
			},
			appearance
		);
		await openHistory();
		await waitFor(() => !!root.renderer.findByTestId(`unpushed-${oid}`));
		expect(
			root.renderer.findByTestId(`unpushed-${commitInfo(0).oid}`)
		).toBeUndefined();
		expect(element(`entry-${oid}`).customProps?.["aria-description"]).toContain(
			"Not pushed (based on last fetch)"
		);
		expect(element(`entry-${oid}`).customProps?.["aria-description"]).toContain(
			"Tags: v1.2.3"
		);
		const arrow = bounds(`unpushed-${oid}`);
		const row = bounds(`entry-${oid}`);
		const subject = bounds(`commit-subject-${oid}`);
		const tag = bounds(`tags-${oid}`);

		expect(arrow.width).toBe(14);
		expect(arrow.x + arrow.width).toBeLessThanOrEqual(row.x + row.width);
		expect(subject.x + subject.width).toBeLessThanOrEqual(tag.x);
		expect(tag.x + tag.width).toBeLessThan(arrow.x);
		click(`unpushed-${oid}`);
		expect(element(`entry-${oid}`).customProps?.["aria-selected"]).toBe(true);

		if (process.env.GPUIX_HISTORY_PUBLICATION_SCREENSHOT_DIR)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_HISTORY_PUBLICATION_SCREENSHOT_DIR}/${appearance}.png`
			);
	});

it("rechecks the same HEAD after refresh without reloading History or losing selection", async () => {
	const pages = mock<typeof RepositoryHistory.read>(async () => ({
		ok: true,
		value: historyPage(0, 3),
	}));

	const reads = mock<typeof RepositoryHistory.readUnpushed>(async () => ({
		ok: true,
		value: [commitInfo(1).oid],
	}));

	show({ readHistory: pages, readUnpushedCommits: reads });
	await openHistory();
	await waitFor(
		() => !!root.renderer.findByTestId(`unpushed-${commitInfo(1).oid}`)
	);
	click(`entry-${commitInfo(1).oid}`);
	reads.mockResolvedValue({ ok: true, value: [] });
	click("refresh-repository");
	await waitFor(() => reads.mock.calls.length === 2);
	await waitFor(
		() => !root.renderer.findByTestId(`unpushed-${commitInfo(1).oid}`)
	);
	expect(pages).toHaveBeenCalledTimes(1);
	expect(
		element(`entry-${commitInfo(1).oid}`).customProps?.["aria-selected"]
	).toBe(true);
	expect(reads.mock.calls[1]?.[1]).toEqual(
		historyPage(0, 3).commits.map((commit) => commit.oid)
	);
});

it("cancels a stale status read and retries failures without guessing that commits are unpushed", async () => {
	const pending =
		Promise.withResolvers<
			Awaited<ReturnType<typeof RepositoryHistory.readUnpushed>>
		>();

	const reads = mock<typeof RepositoryHistory.readUnpushed>(
		async () => await pending.promise
	);

	show({ readUnpushedCommits: reads });
	await openHistory();
	await waitFor(() => reads.mock.calls.length === 1);
	expect(
		root.renderer.findByTestId(`unpushed-${commitInfo(1).oid}`)
	).toBeUndefined();
	reads.mockResolvedValue({
		ok: false,
		error: {
			operation: "get-unpushed-commits",
			code: "command-failed",
			message: "Read failed",
			retryable: true,
		},
	});
	click("refresh-repository");
	await waitFor(
		() => !!root.renderer.findByTestId("retry-history-publication")
	);
	expect(reads.mock.calls[0]?.[2].aborted).toBe(true);
	pending.resolve({ ok: true, value: [commitInfo(1).oid] });
	await Bun.sleep(5);
	root.renderer.flush();
	expect(
		root.renderer.findByTestId(`unpushed-${commitInfo(1).oid}`)
	).toBeUndefined();
	reads.mockResolvedValue({ ok: true, value: [commitInfo(2).oid] });
	click("retry-history-publication");
	await waitFor(
		() => !!root.renderer.findByTestId(`unpushed-${commitInfo(2).oid}`)
	);
	expect(
		root.renderer.findByTestId("retry-history-publication")
	).toBeUndefined();
});

it("checks newly loaded pages without doing per-row Git reads or changing the saved scroll offset", async () => {
	const pages = mock<typeof RepositoryHistory.read>(
		async (_root, _head, offset) => ({
			ok: true,
			value: historyPage(offset, 12, offset === 0),
		})
	);

	const reads = mock<typeof RepositoryHistory.readUnpushed>(
		async (_root, oids) => ({
			ok: true,
			value: oids.filter(
				(oid) => oid === commitInfo(1).oid || oid === commitInfo(13).oid
			),
		})
	);

	show({ readHistory: pages, readUnpushedCommits: reads });
	await openHistory();
	await waitFor(
		() => !!root.renderer.findByTestId(`unpushed-${commitInfo(1).oid}`)
	);
	const box = bounds("repository-list-viewport");

	root.renderer.nativeSimulateScrollWheel(box.x + 50, box.y + 80, 0, -650);
	root.renderer.flush();
	await waitFor(
		() => !!root.renderer.findByTestId(`unpushed-${commitInfo(13).oid}`)
	);
	expect(pages).toHaveBeenCalledTimes(2);
	expect(reads).toHaveBeenCalledTimes(2);
	expect(reads.mock.calls[1]?.[1]).toHaveLength(24);
	expect(
		root.renderer.findByTestId(`unpushed-${commitInfo(12).oid}`)
	).toBeUndefined();
	const scroll =
		root.renderer.getScrollOffset(element("repository-list").id)?.[1] ?? 0;

	await Bun.sleep(5);
	root.renderer.flush();
	expect(
		root.renderer.getScrollOffset(element("repository-list").id)?.[1]
	).toBe(scroll);
});

it("clears an arrow after successful sync on the same HEAD without reloading History", async () => {
	const initial = repositorySnapshot();

	let snapshot = {
		...initial,
		remoteCount: 1,
		head: { ...initial.head, upstream: "origin/main", ahead: 1 },
	};

	let local = true;

	const pages = mock<typeof RepositoryHistory.read>(async () => ({
		ok: true,
		value: historyPage(0, 3),
	}));

	const push = mock<
		NonNullable<ComponentProps<typeof App>["writeSyncRepository"]>
	>(async () => {
		local = false;
		snapshot = { ...snapshot, head: { ...snapshot.head, ahead: 0 } };

		return {
			ok: true,
			value: { operation: "push", remote: "origin", branch: "main", snapshot },
		};
	});

	show({
		readRepository: async () => ({ ok: true, value: snapshot }),
		readHistory: pages,
		readUnpushedCommits: async () => ({
			ok: true,
			value: local ? [commitInfo(1).oid] : [],
		}),
		writeSyncRepository: push,
		readBranches: async () => ({
			ok: true,
			value: {
				branches: {
					current: "main",
					branches: [
						{
							name: "main",
							fullName: "refs/heads/main",
							oid: snapshot.head.oid ?? "",
							checkedOut: true,
							type: "local",
							worktreePath: "/test/project",
							ahead: snapshot.head.ahead,
							behind: 0,
							committedAt: null,
							remote: null,
							summary: "",
							upstream: "origin/main",
						},
					],
				},
				worktrees: [],
				remotes: [
					{
						name: "origin",
						defaultBranch: "main",
						fetchUrls: ["/test/remote"],
						pushUrls: ["/test/remote"],
					},
				],
			},
		}),
	});
	await openHistory();
	await waitFor(
		() => !!root.renderer.findByTestId(`unpushed-${commitInfo(1).oid}`)
	);
	click(`entry-${commitInfo(1).oid}`);
	click("rail-sync");
	await waitFor(() => push.mock.calls.length === 1);
	await waitFor(
		() => !root.renderer.findByTestId(`unpushed-${commitInfo(1).oid}`)
	);
	expect(push.mock.calls[0]?.[1].kind).toBe("sync");
	expect(pages).toHaveBeenCalledTimes(1);
	expect(
		element(`entry-${commitInfo(1).oid}`).customProps?.["aria-selected"]
	).toBe(true);
});
