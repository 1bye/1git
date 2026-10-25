/**
 * Covers: per-gap 20-line expansion, merging, correct coordinates, stale reads and bounded output.
 * Real: pure context transformation on unified Git patches.
 * Doubles: deterministic patch fixtures; no repository or renderer.
 * Requires: Bun only.
 */
import { expect, it } from "bun:test";
import { DiffContext } from "../../src/feature/repository-workspace/lib/diff-context";
import { contextPatch } from "../_shared/context-patch";

it("reveals trailing context in twenty-line steps through the final partial page", () => {
	let patch = contextPatch();

	for (const [end, count, complete] of [
		[123, 27, false],
		[143, 47, false],
		[150, 54, true],
	] as const) {
		const request = DiffContext.request(patch, undefined, undefined, true);

		if (!request) throw new Error("Missing trailing context request.");

		expect(request.after).toBe(true);
		const result = DiffContext.expand(
			patch,
			contextPatch(request.contextLines),
			request
		);

		patch = result.patch;
		expect(result.endReached).toBe(complete);
		expect(patch).toContain(`@@ -97,${count} +97,${count} @@`);
		expect(patch).toEndWith(` line ${end}\n`);
		expect(patch).toContain("@@ -37,7 +37,7 @@");
	}
});

it("hides trailing expansion at known EOF and preserves a missing final newline", () => {
	const full = contextPatch(150);

	expect(DiffContext.hasAfter(contextPatch(), full)).toBe(true);
	expect(DiffContext.hasAfter(full, full)).toBe(false);
	let patch = contextPatch();

	for (let step = 0; step < 3; step++) {
		const request = DiffContext.request(patch, undefined, undefined, true);

		if (!request) throw new Error("Missing trailing request.");

		const source = contextPatch(request.contextLines).replace(
			" line 150\n",
			" line 150\n\\ No newline at end of file\n"
		);

		patch = DiffContext.expand(patch, source, request).patch;
	}

	expect(patch).toEndWith(" line 150\n\\ No newline at end of file\n");
	expect(DiffContext.hasAfter(patch)).toBe(false);
	expect(DiffContext.request(patch, undefined, undefined, true)).toBeNull();
});

it("reveals twenty lines at the clicked gap without expanding other hunks", () => {
	const original = contextPatch();
	const request = DiffContext.request(original, 97, 97);

	if (!request) throw new Error("Missing context request.");

	expect(request).toEqual({
		oldLine: 97,
		newLine: 97,
		lines: 20,
		contextLines: 23,
	});
	const expanded = DiffContext.expand(
		original,
		contextPatch(23),
		request
	).patch;

	expect(expanded).toContain("@@ -37,7 +37,7 @@ example");
	expect(expanded).toContain("@@ -77,27 +77,27 @@ example\n line 77\n");
	expect(expanded).not.toContain(" line 76\n");
	expect(expanded.match(/^[-+]changed|^-line/gm)).toHaveLength(4);
});

it("repeats twenty-line expansion, then reveals the remainder and joins adjacent hunks", () => {
	let patch = contextPatch();

	for (const [start, count, context] of [
		[97, 20, 23],
		[77, 20, 43],
		[57, 13, 56],
	] as const) {
		const request = DiffContext.request(patch, start, start);

		if (!request) throw new Error("Missing context request.");

		expect(request.lines).toBe(count);
		expect(request.contextLines).toBe(context);
		patch = DiffContext.expand(patch, contextPatch(context), request).patch;
	}

	expect(patch.match(/^@@ /gm)).toHaveLength(1);
	expect(patch).toContain("@@ -37,67 +37,67 @@ example");
	expect(patch).toContain(" line 44\n");
	expect(patch).toContain(" line 96\n");
	expect(DiffContext.request(patch, 57, 57)).toBeNull();
});

it("expands leading context to the start of the file and keeps trailing whitespace intact", () => {
	let patch = contextPatch().replace(" line 103\n", " line 103  \n");
	const first = DiffContext.request(patch);

	if (!first) throw new Error("Missing context request.");

	patch = DiffContext.expand(patch, contextPatch(23), first).patch;
	const last = DiffContext.request(patch);

	if (!last) throw new Error("Missing final leading context.");

	expect(last.lines).toBe(16);
	patch = DiffContext.expand(patch, contextPatch(39), last).patch;
	expect(patch).toContain("@@ -1,43 +1,43 @@ example");
	expect(patch).toEndWith(" line 103  \n");
	expect(DiffContext.request(patch, 1, 1)).toBeNull();
});

it("rejects changed Git content and missing context instead of mixing snapshots", () => {
	const patch = contextPatch();
	const request = DiffContext.request(patch, 97, 97);

	if (!request) throw new Error("Missing context request.");

	expect(() =>
		DiffContext.expand(
			patch,
			contextPatch(23).replace("+changed 40", "+external edit"),
			request
		)
	).toThrow("changed outside");
	expect(() => DiffContext.expand(patch, patch, request)).toThrow(
		"requested context"
	);
	expect(() =>
		DiffContext.expand(
			patch,
			contextPatch(23).replace("1111111", "aaaaaaa"),
			request
		)
	).toThrow("changed outside");
});

it("bounds native preview growth and ignores additions without omitted context", () => {
	const patch = contextPatch();
	const request = DiffContext.request(patch, 97, 97);

	if (!request) throw new Error("Missing context request.");

	const prefix = "metadata\n".repeat(1980);

	expect(() =>
		DiffContext.expand(prefix + patch, prefix + contextPatch(23), request)
	).toThrow("safe size limit");
	expect(
		DiffContext.request(
			"diff --git a/new b/new\n--- /dev/null\n+++ b/new\n@@ -0,0 +1 @@\n+content\n"
		)
	).toBeNull();
});
