/**
 * Covers: branch picking, combined/commit files, pagination, stale cancellation and Back.
 * Real: comparison view, native select/list layout and renderer events.
 * Doubles: immutable Git reads. Requires: patched GPUIX and macOS graphics.
 */
import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import type { CommitInfo } from "@1git/git";
import { RepositoryComparison } from "../../src/feature/repository-comparison/repository-comparison";
import {
	RepositoryComparison as Reader,
	type ComparisonRequest,
} from "../../src/feature/repository-comparison/lib/repository-comparison";
import { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import { RepositoryDiff } from "../../src/feature/repository-workspace/lib/repository-diff";

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

const show = (reader: typeof Reader.read = readComparison): void => {
	root.render(
		<div style={{ width: "100%", height: "100%", flexDirection: "column" }}>
			<RepositoryComparison
				request={request}
				onClose={close}
				readComparison={reader}
				readHistory={readHistory}
				readCommitFiles={readFiles}
				readDiff={readDiff}
			/>
		</div>
	);
};

const choose = async (branch: string): Promise<void> => {
	click("comparison-branch");
	await settle();
	click(`compare-option-${branch}`);
	await settle();
};

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
	click("comparison-all-files");
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

it("appends another page without losing the selected file", async () => {
	readHistory.mockImplementationOnce(async () => ({
		ok: true,
		value: { commits: [commit], hasMore: true, nextOffset: 50 },
	}));
	readHistory.mockImplementationOnce(async () => ({
		ok: true,
		value: {
			commits: [{ ...commit, oid: "second", summary: "Older incoming work" }],
			hasMore: false,
			nextOffset: null,
		},
	}));
	show();
	await choose("feature");
	click("comparison-load-more");
	await settle();
	expect(readHistory.mock.calls.at(-1)?.[2]).toBe(50);
	expect(root.renderer.findByTestId("entry-commit")).toBeTruthy();
	expect(root.renderer.findByTestId("entry-second")).toBeTruthy();
	expect(root.renderer.findByTestId("comparison-load-more")).toBeUndefined();
	expect(readDiff.mock.calls.at(-1)?.[1].path).toBe("file.txt");
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
