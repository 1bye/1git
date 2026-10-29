/**
 * Covers: bounded aggregate output for batches of untracked files.
 * Real: Git CLI, diff collection and a disposable repository.
 * Doubles: none.
 * Requires: Git and writable temporary storage; no network or credentials.
 */
import { afterEach, expect, it } from "bun:test";
import { GitRepository } from "../src/repository.js";
import {
	RepositoryFixtures,
	unwrapResult,
} from "./_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => await fixtures.cleanup());

it("bounds combined untracked patches even when each file fits the command limit", async () => {
	const fixture = await fixtures.create();
	const paths = ["one.txt", "two.txt", "three.txt"];

	for (const path of paths) await fixture.write(path, `${"a".repeat(600)}\n`);

	const repository = unwrapResult(
		await GitRepository.open({
			path: fixture.repositoryPath,
			runtime: { maxOutputBytes: 1024 },
		})
	);

	const single = unwrapResult(
		await repository.getDiff({
			target: { kind: "changes" },
			paths: [paths[0]!],
		})
	);

	const batch = unwrapResult(
		await repository.getDiff({ target: { kind: "changes" }, paths })
	);

	expect(single.patchOmittedReason).toBeUndefined();
	expect(single.patch).toContain(`+${"a".repeat(600)}`);
	expect(batch.patch).toBe("");
	expect(batch.patchOmittedReason).toBe("too-large");
	expect(await fixture.git(["ls-files"])).toBe("README.md");
});
