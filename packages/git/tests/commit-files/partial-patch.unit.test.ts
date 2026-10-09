/**
 * Covers: stable coordinates, incomplete/multi-file/unsupported patches, group subsets and newline markers.
 * Real: PartialPatch parser and patch generation.
 * Doubles: none.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { PartialPatch } from "../../src/partial-patch.js";

const patch =
	"diff --git a/file b/file\nindex 111..222 100644\n--- a/file\n+++ b/file\n@@ -1,4 +1,5 @@\n start\n-old\n+new\n+extra\n middle\n end\n";

it("uses old/new coordinates and preserves unchanged/excluded content", () => {
	const parsed = new PartialPatch(patch);

	expect(parsed.lines).toEqual(["-:2", "+:2", "+:3"]);
	const selected = parsed.select(["+:3"]);

	expect(selected).toContain("@@ -1,4 +1,5 @@");
	expect(selected).toContain(" start\n old\n+extra\n middle\n end\n");
	expect(selected).not.toContain("index ");
	expect(() => parsed.select([])).toThrow();
	expect(() => parsed.select(["+:100"])).toThrow();
});

it("rejects incomplete, multi-file, renamed, symlink, submodule and binary patches", () => {
	for (const source of [
		patch.replace(" end\n", ""),
		patch + patch,
		patch.replace("index 111..222 100644", "index 111..222 120000"),
		patch.replace("index 111..222 100644", "index 111..222 160000"),
		patch.replace("index 111..222 100644", "rename from old\nrename to new"),
		"diff --git a/file b/file\nBinary files a/file and b/file differ\n",
	])
		expect(() => new PartialPatch(source)).toThrow();
});

it("handles a zero-context deletion and preserves no-final-newline metadata", () => {
	const source =
		"diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -2,1 +1,0 @@\n-last\n\\ No newline at end of file\n";

	expect(new PartialPatch(source).select(["-:2"])).toContain(
		"@@ -2,1 +1,0 @@\n-last\n\\ No newline at end of file\n"
	);
});
