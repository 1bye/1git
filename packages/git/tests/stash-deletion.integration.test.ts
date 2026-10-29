/**
 * Covers: immutable stash deletion, reflog preservation and concurrent Git lock failures.
 * Real: GitRepository, filesystem locks, packed refs and disposable Git repositories.
 * Doubles: none.
 * Requires: Git and writable temporary storage.
 */
import { afterEach, expect, it } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import {
	RepositoryFixtures,
	unwrapResult,
} from "./_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => await fixtures.cleanup());

it("deletes middle, newest and final entries without changing retained stash contents", async () => {
	const fixture = await fixtures.create();
	const ids: string[] = [];

	for (const name of ["first", "middle", "newest"]) {
		await fixture.write("README.md", `${name}\n`);
		await fixture.git(["stash", "push", "-m", name]);
		ids.push(await fixture.git(["rev-parse", "refs/stash"]));
	}

	await fixture.git(["pack-refs", "--all", "--prune"]);
	unwrapResult(
		await fixture.repository.dropStash({
			reference: "stash@{1}",
			expectedOid: ids[1]!,
		})
	);
	expect(await fixture.git(["stash", "list", "--format=%H"])).toBe(
		`${ids[2]}\n${ids[0]}`
	);
	expect(await fixture.git(["stash", "show", "-p", "stash@{0}"])).toContain(
		"+newest"
	);
	expect(await fixture.git(["stash", "show", "-p", "stash@{1}"])).toContain(
		"+first"
	);
	unwrapResult(
		await fixture.repository.dropStash({
			reference: "stash@{0}",
			expectedOid: ids[2]!,
		})
	);
	expect(await fixture.git(["rev-parse", "refs/stash"])).toBe(ids[0]!);
	expect(await fixture.git(["stash", "list", "--format=%H"])).toBe(ids[0]!);
	unwrapResult(
		await fixture.repository.dropStash({
			reference: "stash@{0}",
			expectedOid: ids[0]!,
		})
	);
	expect(await fixture.git(["stash", "list"])).toBe("");
	await expect(
		fixture.git(["rev-parse", "--verify", "refs/stash"])
	).rejects.toThrow();
	expect(await fixture.git(["status", "--porcelain"])).toBe("");
});

it.each(["refs/stash.lock", "logs/refs/stash.lock"])(
	"preserves another Git writer's %s and leaves stashes untouched",
	async (path) => {
		const fixture = await fixtures.create();

		await fixture.write("README.md", "saved\n");
		await fixture.git(["stash", "push"]);
		const oid = await fixture.git(["rev-parse", "refs/stash"]);

		const log = await readFile(
			`${fixture.repository.info.commonDirectory}/logs/refs/stash`
		);

		const lock = `${fixture.repository.info.commonDirectory}/${path}`;

		await writeFile(lock, "foreign-lock");
		const result = await fixture.repository.dropStash({
			reference: "stash@{0}",
			expectedOid: oid,
		});

		expect(result.ok).toBe(false);
		expect(await readFile(lock, "utf8")).toBe("foreign-lock");
		expect(
			await readFile(
				`${fixture.repository.info.commonDirectory}/logs/refs/stash`
			)
		).toEqual(log);
		expect(await fixture.git(["rev-parse", "refs/stash"])).toBe(oid);
	}
);

it("refuses ambiguous duplicate entries without rewriting the stash reflog", async () => {
	const fixture = await fixtures.create();

	await fixture.write("README.md", "saved\n");
	await fixture.git(["stash", "push"]);
	const oid = await fixture.git(["rev-parse", "refs/stash"]);

	await fixture.write("README.md", "different stash\n");
	await fixture.git(["stash", "push"]);
	const other = await fixture.git(["rev-parse", "refs/stash"]);

	await fixture.git(["stash", "store", "-m", "Duplicate", oid]);
	const log = await readFile(
		`${fixture.repository.info.commonDirectory}/logs/refs/stash`
	);

	const result = await fixture.repository.dropStash({
		reference: "stash@{0}",
		expectedOid: oid,
	});

	expect(result.ok).toBe(false);
	expect(
		await readFile(`${fixture.repository.info.commonDirectory}/logs/refs/stash`)
	).toEqual(log);
	expect(await fixture.git(["stash", "list", "--format=%H"])).toBe(
		`${oid}\n${other}\n${oid}`
	);
});
