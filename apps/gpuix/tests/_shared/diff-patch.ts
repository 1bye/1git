import type { FileDiff } from "@1git/git";
import {
	RepositoryDiff,
	type ChangeDiffTarget,
} from "../../src/feature/repository-workspace/lib/repository-diff";

export const diffPatch = (
	name = "example.ts",
	after = "const value = 2;",
	before = "const value = 1;"
): string =>
	`diff --git a/${name} b/${name}\nindex 1111111..2222222 100644\n--- a/${name}\n+++ b/${name}\n@@ -10,2 +10,2 @@\n const context = true;\n-${before}\n+${after}\n`;

export const diffSection = (
	target: ChangeDiffTarget,
	patch = diffPatch(),
	stats: FileDiff["stats"] = []
) => RepositoryDiff.section({ target: { kind: target }, patch, stats }, target);
