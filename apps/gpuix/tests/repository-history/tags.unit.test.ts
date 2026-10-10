/**
 * Covers: safe tag destination display without URL credentials, query strings or fragments.
 * Real: display transformation.
 * Doubles: none.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { RepositoryTags } from "../../src/feature/repository-workspace/lib/repository-tags";

it("redacts URL secrets and preserves ordinary SSH/local destinations", () => {
	expect(
		RepositoryTags.destinationLabel(
			"https://user:secret@github.com/team/repo.git?token=private#secret"
		)
	).toBe("https://github.com/team/repo.git");
	expect(RepositoryTags.destinationLabel("git@github.com:team/repo.git")).toBe(
		"git@github.com:team/repo.git"
	);
	expect(RepositoryTags.destinationLabel("/tmp/local.git")).toBe(
		"/tmp/local.git"
	);
});
