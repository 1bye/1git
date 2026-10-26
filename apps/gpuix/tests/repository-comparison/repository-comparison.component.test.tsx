/**
 * Covers: branch picking, combined/commit files, pagination, stale cancellation and Back.
 * Real: comparison view, native select/list layout and renderer events.
 * Doubles: immutable Git reads. Requires: patched GPUIX and macOS graphics.
 */
import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import type { CommitInfo } from "@1git/git";
import { RepositoryComparison } from "../../src/feature/repository-comparison/repository-comparison";
import { RepositoryFileViewProvider } from "../../src/feature/repository-workspace/components/repository-file-view";
import type { RepositoryFileLayout } from "../../src/feature/repository-workspace/lib/repository-file-tree";
import {
	RepositoryComparison as Reader,
	type ComparisonRequest,
} from "../../src/feature/repository-comparison/lib/repository-comparison";
import { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import { RepositoryDiff } from "../../src/feature/repository-workspace/lib/repository-diff";
import { diffPatch } from "../_shared/diff-patch";

let root: TestRoot;

const request: ComparisonRequest = {
	root: "/test",
	base: "base",
	baseName: "main",
	branches: [
		{ value: "feature", label: "feature", oid: "head" },
		{ value: "other", label: "other", oid: "other-head" },
	],
};

const file = {
	path: "file.txt",
	status: "M" as const,
	beforeOid: "before",
	afterOid: "after",
};

const commit: CommitInfo = {
	oid: "commit",
	summary: "Incoming work",
	body: "",
	parentOids: ["base"],
	authoredAt: "2026-09-27T00:00:00Z",
	committedAt: "2026-09-27T00:00:00Z",
	author: { name: "Test", email: "test@example.invalid" },
	committer: { name: "Test", email: "test@example.invalid" },
};

const readComparison = mock<typeof Reader.read>(async (_root, base, head) => ({
	ok: true,
	value: { base, head, mergeBase: "ancestor", files: [file] },
}));

const readHistory = mock<typeof RepositoryHistory.read>(async () => ({
	ok: true,
	value: { commits: [commit], hasMore: false, nextOffset: null },
}));

const readFiles = mock<typeof RepositoryHistory.readFiles>(async () => ({
	ok: true,
	value: [
		RepositoryHistory.fileEntry({ ...file, path: "commit.txt" }, "commit"),
	],
}));

const readDiff = mock<typeof RepositoryDiff.read>(async () => ({
	ok: true,
	value: [],
}));

const close = mock(() => {});

beforeEach(() => {
	root = createTestRoot({ width: 980, height: 640 });
	root.renderer.clockPause();
	readComparison.mockClear();
	readHistory.mockClear();
	readFiles.mockClear();
	readDiff.mockClear();
	close.mockClear();
});
afterEach(() => root.unmount());
const settle = async (): Promise<void> => {
	for (let index = 0; index < 4; index += 1) {
		await Bun.sleep(0);
		root.renderer.flush();
		root.renderer.clockFastForward(100);
		root.renderer.dispatchNativeEvents();
		root.renderer.flush();
	}
};

const click = (id: string): void => {
	const element = root.renderer.findByTestId(id);

	if (!element) throw new Error(`Missing ${id}`);

	const bounds = root.renderer.getElementBounds(element.id);

	if (!bounds) throw new Error(`No bounds for ${id}`);

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	root.renderer.flush();
};

const show = (
	reader: typeof Reader.read = readComparison,
	layout: RepositoryFileLayout = "list"
): void => {
	root.render(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				backgroundColor: "#ffffff",
			}}
		>
			<RepositoryFileViewProvider initialLayout={layout}>
				<RepositoryComparison
					request={request}
					onClose={close}
					readComparison={reader}
					readHistory={readHistory}
					readCommitFiles={readFiles}
					readDiff={readDiff}
				/>
			</RepositoryFileViewProvider>
		</div>
	);
};

const choose = async (branch: string): Promise<void> => {
	click("comparison-branch");
	await settle();
	click(`compare-option-${branch}`);
	await settle();
};

it("uses read-only file trees for comparisons and keeps incoming commits flat", async () => {
	show(
		async (_root, base, head) => ({
			ok: true,
			value: {
				base,
				head,
				mergeBase: "ancestor",
				files: [
					{ ...file, path: "src/a.ts" },
					{ ...file, path: "src/b.ts" },
				],
			},
		}),
		"tree"
	);
	await choose("feature");
	expect(
		root.renderer.findByTestId("comparison-files-viewport")?.customProps?.role
	).toBe("tree");
	expect(
		root.renderer.findByTestId("comparison-commits-viewport")?.customProps?.role
	).toBe("listbox");
	expect(root.renderer.findByTestId("include-folder:src/")).toBeUndefined();
	click("entry-folder:src/");
	expect(root.renderer.findByTestId("entry-src/a.ts")).toBeUndefined();
	click("comparison-file-layout");
	expect(root.renderer.findByTestId("entry-src/a.ts")).toBeDefined();
	expect(
		root.renderer.findByTestId("comparison-files-viewport")?.customProps?.role
	).toBe("listbox");
});

it("retains the sidebar and shows vector artwork while waiting for a branch", async () => {
	show();
	await settle();
	const bounds = (id: string) => {
		const node = root.renderer.findByTestId(
			id === "comparison-commits" || id === "comparison-files"
				? `${id}-viewport`
				: id
		);

		if (!node) throw new Error(`Missing ${id}`);

		const box = root.renderer.getElementBounds(node.id);

		if (!box) throw new Error(`Missing bounds for ${id}`);

		return box;
	};

	const sidebar = bounds("comparison-sidebar");
	const preview = bounds("comparison-preview");
	const artwork = bounds("comparison-art-empty");

	expect(Math.abs(sidebar.width - 310)).toBeLessThanOrEqual(1);
	expect(preview.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width - 1);
	expect(artwork.x + artwork.width / 2).toBeCloseTo(
		preview.x + preview.width / 2,
		0
	);
	expect(root.renderer.getPaintedText().join(" ")).toContain(
		"Choose an incoming branch above"
	);
	expect(root.renderer.findByTestId("comparison-art-direction")).toBeTruthy();
	expect(root.renderer.findByTestId("comparison-art-swap")).toBeTruthy();
	expect(readComparison).not.toHaveBeenCalled();
	expect(root.renderer.getPaintedText().join(" ")).toContain(
		"Choose a branch…"
	);
	await choose("feature");
	expect(root.renderer.findByTestId("comparison-empty")).toBeUndefined();
	expect(root.renderer.findByTestId("comparison-files")).toBeTruthy();
});

it("keeps the toolbar horizontal and the lists beside a full-height preview", async () => {
	readDiff.mockImplementationOnce(async () => ({
		ok: true,
		value: [
			{
				target: "commit",
				patch: diffPatch("file.txt"),
				stats: [],
				message: null,
			},
		],
	}));
	show();
	await choose("feature");
	const bounds = (id: string) => {
		const node = root.renderer.findByTestId(
			id === "comparison-commits" || id === "comparison-files"
				? `${id}-viewport`
				: id
		);

		if (!node) throw new Error(`Missing ${id}`);

		const box = root.renderer.getElementBounds(node.id);

		if (!box) throw new Error(`Missing bounds for ${id}`);

		return box;
	};

	const back = bounds("close-comparison");
	const picker = bounds("comparison-branch");
	const body = bounds("comparison-body");
	const sidebar = bounds("comparison-sidebar");
	const preview = bounds("comparison-preview");
	const pair = bounds("comparison-branch-pair");
	const base = bounds("comparison-base");
	const commits = bounds("comparison-commits");
	const files = bounds("comparison-files");

	expect(
		Math.abs(back.y + back.height / 2 - picker.y - picker.height / 2)
	).toBeLessThan(2);
	expect(back.width).toBeLessThan(100);
	expect(pair.x + pair.width / 2).toBeCloseTo(preview.x + preview.width / 2, 0);
	expect(base.x + base.width).toBeLessThan(picker.x);
	expect(root.renderer.getAllText().join(" ")).not.toContain(
		"Read-only snapshot"
	);
	expect(preview.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width - 1);
	expect(preview.y).toBeCloseTo(sidebar.y, 0);
	expect(body.height).toBeGreaterThan(500);
	expect(preview.height).toBeCloseTo(body.height, 0);
	expect(commits.y + commits.height).toBeLessThan(files.y);
	expect(root.renderer.findByTestId("comparison-all-files")).toBeUndefined();
	expect(root.renderer.getAllText().join(" ")).not.toContain(
		"All branch changes"
	);
	expect(files.height).toBeGreaterThan(150);
	const header = bounds("diff-header");

	expect(header.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width - 1);
	expect(header.y).toBeCloseTo(preview.y, 0);
	expect(root.renderer.getPaintedText().join(" ")).toContain("const value = 2");
});

it("changes either endpoint and swaps the complete branch selection", async () => {
	show();
	await choose("feature");
	click("comparison-base");
	await settle();
	click("base-option-other");
	await settle();
	expect(readComparison.mock.calls.at(-1)?.slice(0, 3)).toEqual([
		"/test",
		"other-head",
		"head",
	]);
	click("swap-comparison");
	await settle();
	expect(readComparison.mock.calls.at(-1)?.slice(0, 3)).toEqual([
		"/test",
		"head",
		"other-head",
	]);
	await choose("HEAD");
	expect(readComparison.mock.calls.at(-1)?.slice(0, 3)).toEqual([
		"/test",
		"head",
		"base",
	]);
});

it("selects the first combined file, previews a commit and returns to all files", async () => {
	show();
	await choose("feature");
	expect(readComparison.mock.calls[0]?.slice(0, 3)).toEqual([
		"/test",
		"base",
		"head",
	]);
	expect(readHistory.mock.calls[0]?.[1]).toBe("base..head");
	expect(readDiff.mock.calls.at(-1)?.[1]).toEqual({
		...file,
		commit: "head",
		base: "ancestor",
	});
	expect(root.renderer.getPaintedText()).toContain("Incoming work");
	click("entry-commit");
	await settle();
	expect(readFiles.mock.calls.at(-1)?.[1]).toBe("commit");
	expect(readDiff.mock.calls.at(-1)?.[1].path).toBe("commit.txt");
	click("entry-commit");
	await settle();
	expect(readDiff.mock.calls.at(-1)?.[1].path).toBe("file.txt");
	const entry = root.renderer.findByTestId("entry-commit");

	if (!entry) throw new Error("Missing commit");

	root.renderer.nativeSimulateKeyDown(entry.id, "enter");
	await settle();
	expect(readDiff.mock.calls.at(-1)?.[1].path).toBe("commit.txt");
	root.renderer.nativeSimulateKeyDown(entry.id, "enter");
	await settle();
	expect(readDiff.mock.calls.at(-1)?.[1].path).toBe("file.txt");
	click("close-comparison");
	expect(close).toHaveBeenCalledTimes(1);
});

it("cancels an old branch read and ignores its late response", async () => {
	let release: (() => void) | undefined;
	let oldSignal: AbortSignal | undefined;

	const reader: typeof Reader.read = async (_root, base, head, signal) => {
		if (head === "head") {
			oldSignal = signal;
			await new Promise<void>((resolve) => {
				release = resolve;
			});
		}

		return {
			ok: true,
			value: {
				base,
				head,
				mergeBase: "ancestor",
				files: [{ ...file, path: `${head}.txt` }],
			},
		};
	};

	show(reader);
	await choose("feature");
	await choose("other");
	expect(oldSignal?.aborted).toBe(true);
	release?.();
	await settle();
	expect(readDiff.mock.calls.at(-1)?.[1].path).toBe("other-head.txt");
});

const firstPage = {
	commits: Array.from({ length: 12 }, (_, index) => ({
		...commit,
		oid: index === 0 ? commit.oid : `commit-${index}`,
	})),
	hasMore: true,
	nextOffset: 12,
};

const scrollCommits = (): void => {
	const node = root.renderer.findByTestId("comparison-commits-viewport");
	const box = node && root.renderer.getElementBounds(node.id);

	if (!box) throw new Error("Missing commit viewport");

	root.renderer.nativeSimulateScrollWheel(box.x + 50, box.y + 80, 0, -650);
	root.renderer.flush();
};

it("automatically appends one page at a time and keeps the selected commit and file", async () => {
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryHistory.read>>>();

	readHistory.mockImplementationOnce(async () => ({
		ok: true,
		value: firstPage,
	}));
	readHistory.mockImplementationOnce(async () => await pending.promise);
	show();
	await choose("feature");
	click("entry-commit");
	await settle();
	scrollCommits();
	await settle();
	expect(readHistory).toHaveBeenCalledTimes(2);
	expect(readHistory.mock.calls.at(-1)?.[2]).toBe(12);
	scrollCommits();
	await settle();
	expect(readHistory).toHaveBeenCalledTimes(2);
	pending.resolve({
		ok: true,
		value: {
			commits: [{ ...commit, oid: "second", summary: "Older incoming work" }],
			hasMore: false,
			nextOffset: null,
		},
	});
	await settle();
	expect(readHistory).toHaveBeenCalledTimes(2);
	expect(root.renderer.findByTestId("entry-commit")).toBeTruthy();
	expect(root.renderer.findByTestId("entry-second")).toBeTruthy();
	expect(root.renderer.findByTestId("comparison-load-more")).toBeUndefined();
	expect(readDiff.mock.calls.at(-1)?.[1].path).toBe("commit.txt");
});

it("does not loop on a failed page and can retry loading", async () => {
	readHistory.mockImplementationOnce(async () => ({
		ok: true,
		value: firstPage,
	}));
	readHistory.mockImplementationOnce(async () => ({
		ok: false,
		error: {
			code: "invalid-input",
			operation: "get-history",
			retryable: true,
			message: "Could not load the next page.",
		},
	}));
	show();
	await choose("feature");
	scrollCommits();
	await settle();
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Could not load the next page."
	);
	scrollCommits();
	await settle();
	expect(readHistory).toHaveBeenCalledTimes(2);
	click("retry-comparison");
	await settle();
	expect(readHistory).toHaveBeenCalledTimes(3);
	expect(root.renderer.getAllText().join(" ")).not.toContain(
		"Could not load the next page."
	);
});

it("shows comparison failures and remains dismissible", async () => {
	readComparison.mockImplementationOnce(async () => ({
		ok: false,
		error: {
			code: "invalid-input",
			operation: "compare-branches",
			retryable: false,
			message: "These branches do not share a common ancestor.",
		},
	}));
	show();
	await choose("feature");
	expect(root.renderer.getAllText().join(" ")).toContain("common ancestor");
	expect(readDiff).not.toHaveBeenCalled();
	click("close-comparison");
	expect(close).toHaveBeenCalledTimes(1);
});
