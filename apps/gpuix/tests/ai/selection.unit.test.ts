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

	const first = selected.overview(0, 2048);

	expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(2048);
	expect(first.files.length).toBeGreaterThan(0);
	expect(first.files.length).toBeLessThan(25);

	if (first.nextOffset === null)
		throw new Error("Expected another overview page.");

	const last = selected.overview(first.nextOffset, 2048);

	expect([...first.files, ...last.files]).toEqual([...selected.files]);
	expect(last.nextOffset).toBeNull();
	expect(selected.search(".*").matches).toHaveLength(12);
	expect(selected.search(".*", 12).nextOffset).toBe(24);
	expect(selected.search(".*", 24).matches).toHaveLength(1);
	expect(() => selected.overview(25)).toThrow("valid");
	expect(() => selected.overview(0, 100)).toThrow("2048 bytes");
	expect(() => selected.search("", 0)).toThrow("literal");
});

it("keeps overview pages within their byte budget even for long Unicode file names", () => {
	const selected = new SelectedDiff(
		Array.from(
			{ length: 133 },
			(_, id) =>
				`diff --git a/${"漢".repeat(240)}-${id} b/${id}\n@@ -0,0 +1 @@\n+selected\n`
		).join("")
	);

	const ids: number[] = [];
	let offset: number | null = 0;

	while (offset !== null) {
		const page = selected.overview(offset, 4096);

		expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(4096);
		expect(page.files.length).toBeGreaterThan(0);
		ids.push(...page.files.map((file) => file.id));
		offset = page.nextOffset;
	}

	expect(ids).toEqual(selected.files.map((file) => file.id));
});
