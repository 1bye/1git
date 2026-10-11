/**
 * Covers: preview reuse, whitespace isolation, shared reads, cancellation, snapshot invalidation and bounded eviction.
 * Real: preview cache and diff sections.
 * Doubles: cancellable Git/image reader.
 * Requires: none.
 */
import { expect, it, mock } from "bun:test";
import { RepositoryPreviewCache } from "../../src/feature/repository-workspace/lib/repository-preview-cache";
import type { RepositoryDiff } from "../../src/feature/repository-workspace/lib/repository-diff";
import { changedFile } from "../_shared/repository-snapshot";
import { diffPatch, diffSection } from "../_shared/diff-patch";

const version = {};

const request = (path: string, snapshot = version) => ({
	root: "/test/project",
	change: changedFile(path),
	version: snapshot,
});

const response = (path: string) => ({
	ok: true as const,
	value: [diffSection("working", diffPatch(path))],
});

const signal = () => new AbortController().signal;

it("separates whitespace-filtered previews and forwards the option to foreground and prefetched reads", async () => {
	const reader = mock<typeof RepositoryDiff.read>(
		async (_root, change, _signal, ignoreWhitespace) => ({
			ok: true,
			value: [
				diffSection(
					"working",
					diffPatch(change.path, ignoreWhitespace ? "filtered" : "original")
				),
			],
		})
	);

	const cache = new RepositoryPreviewCache(reader);
	const normal = request("a.ts");
	const filtered = { ...normal, ignoreWhitespace: true };

	await cache.read(normal, signal());
	expect(cache.peek(filtered)).toBeUndefined();
	await cache.read(filtered, signal());
	expect(cache.peek(normal)?.[0]?.patch).toContain("diff --git");
	expect(cache.peek(filtered)?.[0]?.patch).toContain("+filtered");
	expect(cache.peek(normal)?.[0]?.patch).toContain("+original");
	expect(cache.key(normal)).toBe(
		cache.key({ ...normal, ignoreWhitespace: false })
	);
	cache.prefetch([{ ...request("b.ts"), ignoreWhitespace: true }]);
	await Bun.sleep(0);
	expect(reader.mock.calls.map((call) => call[3])).toEqual([false, true, true]);
	cache.dispose();
});

it("reuses prepared previews and shares pending work without cancelling another consumer", async () => {
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryDiff.read>>>();

	const reader = mock<typeof RepositoryDiff.read>(() => pending.promise);
	const cache = new RepositoryPreviewCache(reader);
	const first = new AbortController();
	const second = new AbortController();
	const a = cache.read(request("a.ts"), first.signal);
	const b = cache.read(request("a.ts"), second.signal);
	const cancelled = a.catch((error: unknown) => error);

	first.abort();
	expect(await cancelled).toBeInstanceOf(Error);
	expect(reader.mock.calls[0]?.[2].aborted).toBe(false);
	pending.resolve(response("a.ts"));
	expect(await b).toEqual(response("a.ts"));
	expect(cache.peek(request("a.ts"))).toEqual(response("a.ts").value);
	expect(await cache.read(request("a.ts"), signal())).toEqual(response("a.ts"));
	expect(reader).toHaveBeenCalledTimes(1);
	cache.dispose();
});

it("does not retain cancelled or failed work, even when the reader ignores abort", async () => {
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryDiff.read>>>();

	const reader = mock<typeof RepositoryDiff.read>(() => pending.promise);
	const cache = new RepositoryPreviewCache(reader);
	const controller = new AbortController();
	const read = cache.read(request("a.ts"), controller.signal);
	const cancelled = read.catch((error: unknown) => error);

	controller.abort();
	expect(await cancelled).toBeInstanceOf(Error);
	expect(reader.mock.calls[0]?.[2].aborted).toBe(true);
	pending.resolve(response("a.ts"));
	await Bun.sleep(0);
	expect(cache.peek(request("a.ts"))).toBeUndefined();
	reader.mockRejectedValue(new Error("Unavailable"));
	await expect(cache.read(request("a.ts"), signal())).rejects.toThrow(
		"Unavailable"
	);
	reader.mockResolvedValue(response("a.ts"));
	expect(await cache.read(request("a.ts"), signal())).toEqual(response("a.ts"));
	expect(reader).toHaveBeenCalledTimes(3);
	cache.dispose();
});

it("invalidates live files on new snapshots but keeps immutable commits until the root closes", async () => {
	const reader = mock<typeof RepositoryDiff.read>(async (_root, change) =>
		response(change.path)
	);

	const cache = new RepositoryPreviewCache(reader);

	const committed = {
		...request("a.ts"),
		change: {
			path: "a.ts",
			status: "M" as const,
			beforeOid: "111",
			afterOid: "222",
			commit: "abcdef",
		},
	};

	await cache.read(request("a.ts"), signal());
	await cache.read(committed, signal());
	const next = {};

	cache.retain([{ root: "/test/project", version: next }]);
	expect(cache.peek(request("a.ts"))).toBeUndefined();
	expect(cache.peek({ ...committed, version: next })).toBeDefined();
	await cache.read(request("a.ts", next), signal());
	expect(reader).toHaveBeenCalledTimes(3);
	cache.retain([]);
	expect(cache.peek(committed)).toBeUndefined();
	cache.dispose();
});

it("evicts least recently used previews by retained bytes, not only file count", async () => {
	const reader = mock<typeof RepositoryDiff.read>(async (_root, change) =>
		response(change.path)
	);

	const bytes = Buffer.byteLength(diffPatch("a.ts"), "utf16le") + 256;
	const cache = new RepositoryPreviewCache(reader, bytes * 2);

	await cache.read(request("a.ts"), signal());
	await cache.read(request("b.ts"), signal());
	cache.peek(request("a.ts"));
	await cache.read(request("c.ts"), signal());

	expect(cache.peek(request("a.ts"))).toBeDefined();
	expect(cache.peek(request("b.ts"))).toBeUndefined();
	expect(cache.peek(request("c.ts"))).toBeDefined();
	cache.dispose();
});

it("budgets hidden syntax context with its visible preview", async () => {
	const syntaxPatch = "hidden context".repeat(100);

	const reader = mock<typeof RepositoryDiff.read>(async (_root, change) => ({
		ok: true,
		value: [{ ...diffSection("working", diffPatch(change.path)), syntaxPatch }],
	}));

	const bytes = (diffPatch("a.ts").length + syntaxPatch.length) * 2 + 256;
	const cache = new RepositoryPreviewCache(reader, bytes);

	await cache.read(request("a.ts"), signal());
	await cache.read(request("b.ts"), signal());
	expect(cache.peek(request("a.ts"))).toBeUndefined();
	expect(cache.peek(request("b.ts"))?.[0]?.syntaxPatch).toBe(syntaxPatch);
	cache.dispose();
});

it("budgets prepared image pixels, base64 and retained SVG source", async () => {
	const reader = mock<typeof RepositoryDiff.read>(async () => ({
		ok: true,
		value: [
			{
				...diffSection("working"),
				image: {
					before: null,
					after: {
						image: {
							src: "data:image/png;base64,AAAA",
							width: 2048,
							height: 2048,
							sizeBytes: 10,
						},
						error: null,
					},
					svg: false,
				},
			},
		],
	}));

	const cache = new RepositoryPreviewCache(reader, 1024);

	await cache.read(request("a.png"), signal());

	expect(cache.peek(request("a.png"))).toBeUndefined();
	cache.dispose();
});

it("preloads serially and lets foreground selection adopt an in-flight neighbour", async () => {
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryDiff.read>>>();

	const reader = mock<typeof RepositoryDiff.read>((_root, change) =>
		change.path === "a.ts"
			? pending.promise
			: Promise.resolve(response(change.path))
	);

	const cache = new RepositoryPreviewCache(reader);

	cache.prefetch([request("a.ts"), request("b.ts"), request("c.ts")]);
	await Bun.sleep(0);
	expect(reader).toHaveBeenCalledTimes(1);
	const adopted = cache.read(request("a.ts"), signal());

	cache.cancelPrefetch();
	expect(reader.mock.calls[0]?.[2].aborted).toBe(false);
	pending.resolve(response("a.ts"));
	await adopted;
	expect(reader).toHaveBeenCalledTimes(1);
	expect(cache.peek(request("a.ts"))).toBeDefined();
	cache.dispose();
});

it("bounds background work to two files and cancels obsolete queued snapshots", async () => {
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryDiff.read>>>();

	const reader = mock<typeof RepositoryDiff.read>((_root, change) =>
		change.path === "a.ts"
			? pending.promise
			: Promise.resolve(response(change.path))
	);

	const cache = new RepositoryPreviewCache(reader);

	cache.prefetch([request("a.ts"), request("b.ts"), request("c.ts")]);
	await Bun.sleep(0);
	expect(reader).toHaveBeenCalledTimes(1);
	pending.resolve(response("a.ts"));
	await Bun.sleep(0);
	expect(reader.mock.calls.map((call) => call[1].path)).toEqual([
		"a.ts",
		"b.ts",
	]);
	cache.retain([{ root: "/test/project", version: {} }]);
	expect(cache.peek(request("a.ts"))).toBeUndefined();
	expect(cache.peek(request("b.ts"))).toBeUndefined();
	cache.dispose();
});

it("waits for pointer intent and never caches failures or conflict hashes", async () => {
	const reader = mock<typeof RepositoryDiff.read>(async (_root, change) =>
		response(change.path)
	);

	const cache = new RepositoryPreviewCache(reader);

	cache.intent(request("a.ts"));
	cache.intent(null);
	await Bun.sleep(100);
	expect(reader).not.toHaveBeenCalled();
	cache.intent(request("a.ts"));
	cache.intent(request("b.ts"));
	await Bun.sleep(100);
	expect(reader.mock.calls.map((call) => call[1].path)).toEqual(["b.ts"]);
	reader.mockResolvedValue({
		ok: true,
		value: [
			{
				...diffSection("working"),
				conflict: { text: "conflicted", hash: "fresh hash" },
			},
		],
	});
	await cache.read(request("conflict.txt"), signal());
	expect(cache.peek(request("conflict.txt"))).toBeUndefined();
	cache.dispose();
});

it("aborts root closures and releases cached data on dispose", async () => {
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryDiff.read>>>();

	const reader = mock<typeof RepositoryDiff.read>(() => pending.promise);
	const cache = new RepositoryPreviewCache(reader);
	const read = cache.read(request("a.ts"), signal());
	const cancelled = read.catch((error: unknown) => error);

	cache.retain([]);
	expect(await cancelled).toBeInstanceOf(Error);
	expect(reader.mock.calls[0]?.[2].aborted).toBe(true);
	pending.resolve(response("a.ts"));
	await Bun.sleep(0);
	cache.dispose();
	await expect(cache.read(request("a.ts"), signal())).rejects.toThrow();
	expect(cache.peek(request("a.ts"))).toBeUndefined();
});
