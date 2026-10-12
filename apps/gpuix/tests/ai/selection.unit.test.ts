/**
 * Covers: immutable selection paging, metadata and bounded literal search.
 * Real: SelectedDiff.
 * Doubles: synthetic Git patches.
 * Requires: Bun; no external services.
 */
import { expect, it } from "bun:test";
import { SelectedDiff } from "../../src/feature/ai/lib/selected-diff";

it("preserves Unicode and long lines across pages and rejects out-of-range reads", () => {
	const source = `diff --git a/a.ts b/a.ts\n@@ -0,0 +1 @@\n+${"😀é漢字".repeat(10000)}\ndiff --git a/z.ts b/z.ts\n@@ -1 +1 @@\n-old\n+TRAILING_CHANGE\n`;
	const selected = new SelectedDiff(source);
	let reconstructed = "";

	for (const file of selected.files) {
		for (let page = 0; page < file.pages; page++) {
			const value = selected.read(file.id, page);

			expect(Buffer.byteLength(value.text)).toBeLessThanOrEqual(10 * 1024);
			expect(value.text).not.toContain("�");
			reconstructed += value.text;
		}
	}

	expect(reconstructed).toBe(source);
	expect(() => selected.read(2, 0)).toThrow("outside");
	expect(() => selected.read(-1, 0)).toThrow("valid");
	expect(() => selected.read(0, 1000)).toThrow("outside");
	expect(() => selected.read(Number.NaN, 0)).toThrow("valid");
	expect(selected.files[1]).toMatchObject({ added: 1, deleted: 1, hunks: 1 });
	expect(selected.search("TRAILING_CHANGE").matches).toMatchObject([
		{ file: 1, page: 0 },
	]);
	expect(selected.search("PRIVATE_UNCHECKED").matches).toEqual([]);
});

it("paginates all file metadata and search matches, treating regex syntax literally", () => {
	const selected = new SelectedDiff(
		Array.from(
			{ length: 25 },
			(_, id) =>
				`diff --git a/${id} b/${id}\n@@ -0,0 +1 @@\n+literal .* ${id}\n`
		).join("")
	);

	expect(selected.overview().files).toHaveLength(20);
	expect(selected.overview().nextOffset).toBe(20);
	expect(selected.overview(20).files).toHaveLength(5);
	expect(selected.overview(20).nextOffset).toBeNull();
	expect(selected.search(".*").matches).toHaveLength(12);
	expect(selected.search(".*", 12).nextOffset).toBe(24);
	expect(selected.search(".*", 24).matches).toHaveLength(1);
	expect(() => selected.overview(25)).toThrow("valid");
	expect(() => selected.search("", 0)).toThrow("literal");
});
