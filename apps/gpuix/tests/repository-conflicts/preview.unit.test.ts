/**
 * Covers: marker detection, bounded source/result patches and collapsed hunk context.
 * Real: conflict comparison model and diff library. Doubles: none. Requires: none.
 */
import { expect, it } from "bun:test";
import { applyPatch, parsePatch } from "diff";
import { ConflictPreviewModel } from "../../src/feature/repository-workspace/lib/conflict-preview";

it("locates multiple blocks without treating ordinary comparison operators as markers", () => {
	const preview = ConflictPreviewModel.markers(
		"const x = a << 7;\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\ncontext\n<<<<<<<< HEAD\nours\n========\ntheirs\n>>>>>>>> incoming\n"
	);

	expect(preview).toEqual({ starts: [1, 7], unresolved: true });
});

it.each(["=======\n", "||||||| base\n", ">>>>>>> other\n"])(
	"keeps incomplete marker content unresolved: %s",
	(text) => {
		expect(ConflictPreviewModel.markers(text)).toEqual({
			starts: [],
			unresolved: true,
		});
	}
);

it("does not change or mark resolved text as conflicted", () => {
	expect(ConflictPreviewModel.markers('const theme = "light";\n')).toEqual({
		starts: [],
		unresolved: false,
	});
});

it("compares the actual indexed version with the unchanged marker-bearing result", () => {
	const source = 'const theme = "light";\n';

	const result =
		'<<<<<<< HEAD\nconst theme = "light";\n=======\nconst theme = "dark";\n>>>>>>> upstream\n';

	const comparison = ConflictPreviewModel.compare(
		"src/theme.ts",
		source,
		result
	);

	expect(comparison.message).toBeNull();
	expect(applyPatch(source, comparison.patch)).toBe(result);
	expect(comparison.patch).toContain("+<<<<<<< HEAD");
	expect(comparison.patch).toContain(' const theme = "light";');
});

it("keeps distant conflicts in separate hunks with original line numbers and expandable context", () => {
	const lines = Array.from({ length: 120 }, (_, index) => `context ${index}`);
	const source = lines.join("\n");

	const result = [
		...lines.slice(0, 20),
		"<<<<<<< HEAD",
		lines[20],
		"=======",
		"incoming first",
		">>>>>>> upstream",
		...lines.slice(21, 100),
		"<<<<<<< HEAD",
		lines[100],
		"=======",
		"incoming second",
		">>>>>>> upstream",
		...lines.slice(101),
	].join("\n");

	const compact = ConflictPreviewModel.compare("file.txt", source, result);
	const full = ConflictPreviewModel.compare("file.txt", source, result, 2000);
	const hunks = parsePatch(compact.patch)[0]?.hunks;

	expect(hunks).toHaveLength(2);
	expect(hunks?.[1]?.oldStart).toBeGreaterThan(90);
	expect(hunks?.[1]?.newStart).toBeGreaterThan(hunks?.[1]?.oldStart ?? 0);
	expect(compact.patch).not.toContain(" context 60\n");
	expect(full.patch).toContain(" context 60\n");
	expect(applyPatch(source, compact.patch)).toBe(result);
	expect(applyPatch(source, full.patch)).toBe(result);
});

it.each(['src/a b"c.ts', "src/tab\tname.ts", "src/line\nbreak.ts"])(
	"safely encodes %s and preserves working newlines and Unicode",
	(path) => {
		const source = "\ufeffconst café = 1;\r\n";
		const result = "\ufeffconst café = 2;\r\n";

		const comparison = ConflictPreviewModel.compare(path, source, result);

		expect(comparison.message).toBeNull();
		expect(applyPatch(source, comparison.patch)).toBe(result);
	}
);

it("explains missing, unchanged and oversized comparisons without showing partial content", () => {
	expect(ConflictPreviewModel.compare("a.txt", null, "result")).toMatchObject({
		patch: "",
		message: expect.stringContaining("unavailable"),
	});
	expect(
		ConflictPreviewModel.compare("a.txt", "same", "same").message
	).toContain("matches this version");
	expect(
		ConflictPreviewModel.compare("a.txt", "source", "x".repeat(4001))
	).toMatchObject({ patch: "", message: expect.stringContaining("too large") });
	expect(
		ConflictPreviewModel.compare("a.txt", "source", "line\n".repeat(2001)).patch
	).toBe("");
});
