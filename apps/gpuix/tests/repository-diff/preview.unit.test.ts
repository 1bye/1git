/**
 * Covers: native-preview guards, binary/empty/conflict notices.
 * Real: diff presentation model.
 * Doubles: explicit Git patches, no repository I/O.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import {
	RepositoryDiff,
	diffLimits,
} from "../../src/feature/repository-workspace/lib/repository-diff";
import { diffPatch, diffSection } from "../_shared/diff-patch";

it("passes complete patches through unchanged, including no-newline and rename metadata", () => {
	for (const patch of [
		diffPatch(),
		`${diffPatch()}\\ No newline at end of file\n`,
		"diff --git a/old b/new\nsimilarity index 100%\nrename from old\nrename to new\n",
		"diff --git a/empty b/empty\nnew file mode 100644\nindex 0000000..e69de29\n",
	]) {
		const section = diffSection("working", patch);

		expect(section.patch).toBe(patch);
		expect(section.message).toBeNull();
	}
});

it("does not confuse binary or conflicted content with an empty or clean diff", () => {
	expect(
		diffSection(
			"working",
			"diff --git a/a.png b/a.png\nBinary files /dev/null and b/a.png differ\n"
		).message
	).toContain("Binary file");
	expect(
		RepositoryDiff.section(
			{
				target: { kind: "staged" },
				patch: "",
				stats: [{ path: "a.png", addedLines: null, deletedLines: null }],
			},
			"working"
		).message
	).toContain("Binary file");
	expect(
		diffSection(
			"working",
			"diff --cc conflict\n@@@ -1,1 -1,1 +1,1 @@@\n++wrong\n"
		).message
	).toContain("merge conflicts");
	expect(diffSection("working", "").message).toContain("No remaining changes");
	expect(diffSection("working", "Not a patch").message).toContain(
		"does not support"
	);
});

it("omits oversized patches in full rather than rendering a misleading truncated diff", () => {
	for (const patch of [
		diffPatch("a", "x".repeat(diffLimits.lineLength + 1)),
		diffPatch("a", "line\n".repeat(diffLimits.lines)),
		diffPatch("a", "a".repeat(diffLimits.bytes)),
	]) {
		const result = diffSection("working", patch);

		expect(result.patch).toBe("");
		expect(result.message).toContain("too large");
	}

	expect(
		RepositoryDiff.section(
			{
				target: { kind: "working" },
				stats: [],
				patch: "",
				patchOmittedReason: "too-large",
			},
			"working"
		).message
	).toContain("too large");
});
