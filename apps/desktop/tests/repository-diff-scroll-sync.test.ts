import { describe, expect, it } from "bun:test";
import {
	createRepositoryDiffActivePathScheduler,
	getRepositoryCodeViewActiveEntry,
} from "@/fixture/repository-workspace/hooks/use-repository-diff-scroll-sync.js";
import type { RepositoryDiffFileEntry } from "@/fixture/repository-workspace/lib/repository-diff-files.js";

const paths = ["first.ts", "middle.ts", "last.ts"] as const;
const entries = paths.map(
	(path): RepositoryDiffFileEntry => ({
		change: null,
		file: null,
		id: undefined,
		key: path,
		patchOmittedReason: undefined,
		path,
		stat: null,
		target: { kind: "working" },
		targetLabel: "Working tree",
	})
);

const waitForTimers = (delayMs: number): Promise<void> =>
	new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));

const createViewer = ({
	height = 600,
	scrollHeight = 1600,
	tops = [0, 400, 900],
}: {
	readonly height?: number;
	readonly scrollHeight?: number;
	readonly tops?: readonly number[];
} = {}) => {
	const topsById = new Map(
		entries.map((entry, index) => [entry.key, tops[index]])
	);
	return {
		getHeight: () => height,
		getScrollHeight: () => scrollHeight,
		getTopForItem: (id: string) => topsById.get(id),
	};
};

describe("repository diff scroll synchronization", () => {
	it("coalesces rapid active-file changes to the latest path", async () => {
		const committedPaths: string[] = [];
		const scheduler = createRepositoryDiffActivePathScheduler(
			(path) => committedPaths.push(path),
			5
		);

		scheduler.schedule("first.ts");
		scheduler.schedule("middle.ts");
		scheduler.schedule("last.ts");
		expect(committedPaths).toEqual([]);

		await waitForTimers(10);
		expect(committedPaths).toEqual(["last.ts"]);

		scheduler.schedule("first.ts");
		scheduler.cancel();
		await waitForTimers(10);
		expect(committedPaths).toEqual(["last.ts"]);
	});

	it("selects the item whose top owns the sticky header position", () => {
		expect(
			getRepositoryCodeViewActiveEntry(entries, createViewer(), 0)?.path
		).toBe("first.ts");
		expect(
			getRepositoryCodeViewActiveEntry(entries, createViewer(), 360)?.path
		).toBe("middle.ts");
		expect(
			getRepositoryCodeViewActiveEntry(entries, createViewer(), 850)?.path
		).toBe("last.ts");
	});

	it("selects the last file at the bottom of an overflowing diff", () => {
		expect(
			getRepositoryCodeViewActiveEntry(entries, createViewer(), 1000)?.path
		).toBe("last.ts");
	});

	it("does not force the last file in a non-scrollable diff", () => {
		expect(
			getRepositoryCodeViewActiveEntry(
				entries,
				createViewer({ height: 600, scrollHeight: 600 }),
				0
			)?.path
		).toBe("first.ts");
	});

	it("handles an empty CodeView", () => {
		expect(getRepositoryCodeViewActiveEntry([], createViewer(), 0)).toBeNull();
	});
});
