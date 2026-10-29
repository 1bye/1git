/**
 * Covers: exact path targeting for staging, unstaging, restoring and selected-path stashes.
 * Real: GitRepository and disposable Git repositories.
 * Doubles: none.
 * Requires: Git and writable temporary storage.
 */
import { afterEach, expect, it } from "bun:test";
import {
	RepositoryFixtures,
	unwrapResult,
} from "./_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => await fixtures.cleanup());

it.each([false, true])(
	"stages and unstages bracketed paths literally, including unborn repositories (%s)",
	async (initialCommit) => {
		const fixture = await fixtures.create({ initialCommit });

		await fixture.write("[id].txt", "selected\n");
		await fixture.write("i.txt", "unrelated\n");
		unwrapResult(await fixture.repository.stage({ paths: ["[id].txt"] }));
		expect(await fixture.git(["diff", "--cached", "--name-only"])).toBe(
			"[id].txt"
		);
		unwrapResult(await fixture.repository.stage({ paths: ["i.txt"] }));
		unwrapResult(await fixture.repository.unstage({ paths: ["[id].txt"] }));
		expect(await fixture.git(["diff", "--cached", "--name-only"])).toBe(
			"i.txt"
		);
		expect(await fixture.read("i.txt")).toBe("unrelated\n");
	}
);

it("restores and stashes only the literal selection", async () => {
	const fixture = await fixtures.create();

	await fixture.write("[id].txt", "base\n");
	await fixture.write("i.txt", "base\n");
	await fixture.commitAll("Base paths");
	await fixture.write("[id].txt", "selected\n");
	await fixture.write("i.txt", "unrelated\n");
	unwrapResult(
		await fixture.repository.restore({
			paths: ["[id].txt"],
			allowDestructive: true,
		})
	);
	expect(await fixture.read("[id].txt")).toBe("base\n");
	expect(await fixture.read("i.txt")).toBe("unrelated\n");
	await fixture.write("[id].txt", "saved\n");
	unwrapResult(await fixture.repository.stash({ paths: ["[id].txt"] }));
	expect(await fixture.read("[id].txt")).toBe("base\n");
	expect(await fixture.read("i.txt")).toBe("unrelated\n");
	expect(await fixture.git(["stash", "show", "--name-only", "stash@{0}"])).toBe(
		"[id].txt"
	);
});
