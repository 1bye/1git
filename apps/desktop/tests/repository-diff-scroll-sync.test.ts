import { describe, expect, it } from "bun:test";
import {
	createRepositoryDiffActivePathScheduler,
	getRepositoryDiffScrollEndPath,
	scrollRepositoryDiffPathIntoView,
} from "@/fixture/repository-workspace/hooks/use-repository-diff-scroll-sync.js";

const paths = ["first.ts", "middle.ts", "last.ts"] as const;

const waitForTimers = (delayMs: number): Promise<void> =>
	new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));

const fileElement = (path: string, top: number): HTMLElement =>
	({
		dataset: { repositoryDiffPath: path },
		getBoundingClientRect: () => ({ bottom: top + 30, top }),
	}) as unknown as HTMLElement;

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

	it("selects the last file at the bottom of an overflowing diff", () => {
		expect(
			getRepositoryDiffScrollEndPath(
				{
					clientHeight: 600,
					scrollHeight: 1600,
					scrollTop: 1000,
				},
				paths
			)
		).toBe("last.ts");
	});

	it("tolerates fractional scroll positions at the bottom", () => {
		expect(
			getRepositoryDiffScrollEndPath(
				{
					clientHeight: 600,
					scrollHeight: 1600,
					scrollTop: 999.4,
				},
				paths
			)
		).toBe("last.ts");
	});

	it("leaves normal and non-scrollable positions to intersection sync", () => {
		expect(
			getRepositoryDiffScrollEndPath(
				{
					clientHeight: 600,
					scrollHeight: 1600,
					scrollTop: 800,
				},
				paths
			)
		).toBeNull();
		expect(
			getRepositoryDiffScrollEndPath(
				{
					clientHeight: 600,
					scrollHeight: 600,
					scrollTop: 0,
				},
				paths
			)
		).toBeNull();
	});

	it("scrolls an externally selected file to the diff viewport start", () => {
		const files = [fileElement("first.ts", 120), fileElement("middle.ts", 420)];
		const container = {
			getBoundingClientRect: () => ({ bottom: 700, top: 100 }),
			querySelectorAll: () => files,
			scrollTop: 200,
		} as unknown as HTMLElement;

		expect(scrollRepositoryDiffPathIntoView(container, "middle.ts")).toBe(true);
		expect(container.scrollTop).toBe(520);
	});

	it("does not move the viewport when the selected diff file is absent", () => {
		const container = {
			querySelectorAll: () => [fileElement("first.ts", 120)],
			scrollTop: 200,
		} as unknown as HTMLElement;

		expect(scrollRepositoryDiffPathIntoView(container, "missing.ts")).toBe(
			false
		);
		expect(container.scrollTop).toBe(200);
	});
});
