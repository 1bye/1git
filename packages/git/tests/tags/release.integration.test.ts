/**
 * Covers: annotated historical tags, reviewed identity guards, dirty/detached/linked worktrees, exact single-tag pushes and no replacement.
 * Real: Git and disposable local repositories/remotes, including push config and hooks.
 * Doubles: none.
 * Requires: Git and temporary storage; no network or user repositories.
 */
import { afterEach, expect, it } from "bun:test";
import { chmod } from "node:fs/promises";
import type {
	CreateReleaseTagInput,
	PushTagInput,
} from "../../src/contracts.js";
import { GitRepository } from "../../src/repository.js";
import {
	RepositoryFixtures,
	type RepositoryFixture,
	unwrapResult,
} from "../_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => await fixtures.cleanup());

async function createFixture(): Promise<RepositoryFixture> {
	const fixture = await fixtures.create();

	await fixture.git(["config", "tag.gpgSign", "false"]);
	await fixture.git(["config", "core.hooksPath", ".git/hooks"]);

	return fixture;
}

async function createRequest(
	fixture: RepositoryFixture
): Promise<CreateReleaseTagInput> {
	const head = await fixture.git(["rev-parse", "HEAD"]);

	return {
		name: "v1.0.0",
		message: "Release 1.0.0\n\nReviewed changes",
		commit: head,
		expectedHead: head,
		expectedBranch: "main",
	};
}

async function pushRequest(
	fixture: RepositoryFixture,
	remote: string
): Promise<PushTagInput> {
	const tag = unwrapResult(await fixture.repository.getTags())[0];

	if (!tag) throw new Error("Expected local tag");

	return {
		name: tag.name,
		expectedOid: tag.oid,
		expectedTarget: tag.targetOid,
		remote: "origin",
		expectedUrl: remote,
		expectedHead: await fixture.git(["rev-parse", "HEAD"]),
		expectedBranch: "main",
	};
}

it("creates an annotated tag on an older commit without changing HEAD, staging, working files or remote refs", async () => {
	const fixture = await createFixture();
	const older = await fixture.git(["rev-parse", "HEAD"]);
	const remote = await fixture.createBareRemote();

	await fixture.git(["remote", "add", "origin", remote]);
	await fixture.write("later.txt", "later\n");
	await fixture.commitAll("Later");
	await fixture.write("later.txt", "staged\n");
	await fixture.git(["add", "later.txt"]);
	await fixture.write("later.txt", "unstaged\n");
	await fixture.write("keep.txt", "untracked\n");
	const before = await fixture.git(["status", "--porcelain=v1"]);
	const index = await fixture.git(["write-tree"]);
	const request = { ...(await createRequest(fixture)), commit: older };

	const result = unwrapResult(
		await fixture.repository.createReleaseTag(request)
	);

	const tag = unwrapResult(await fixture.repository.getTags())[0];

	expect(tag).toMatchObject({
		name: request.name,
		targetOid: older,
		type: "annotated",
		message: "Release 1.0.0",
	});
	expect(
		await fixture.git([
			"for-each-ref",
			"--format=%(contents)",
			`refs/tags/${request.name}`,
		])
	).toBe(request.message);
	expect(await fixture.git(["cat-file", "-t", request.name])).toBe("tag");
	expect(result.head.oid).toBe(request.expectedHead);
	expect(await fixture.git(["status", "--porcelain=v1"])).toBe(before);
	expect(await fixture.git(["write-tree"])).toBe(index);
	expect(await fixture.read("later.txt")).toBe("unstaged\n");
	expect(await fixture.read("keep.txt")).toBe("untracked\n");
	expect(
		await fixture.git([
			"--git-dir",
			remote,
			"for-each-ref",
			"--format=%(refname)",
		])
	).toBe("");
});

it("never replaces duplicate tags and rejects invalid names, revision expressions and non-commit objects", async () => {
	const fixture = await createFixture();
	const request = await createRequest(fixture);

	unwrapResult(await fixture.repository.createReleaseTag(request));
	const oid = await fixture.git(["rev-parse", request.name]);

	const duplicate = await fixture.repository.createReleaseTag({
		...request,
		message: "Other release",
	});

	expect(duplicate.ok).toBe(false);

	if (!duplicate.ok)
		expect(duplicate.error.message).toContain("already exists");

	expect(await fixture.git(["rev-parse", request.name])).toBe(oid);

	for (const name of [
		"bad name",
		"a..b",
		"-force",
		"a\0b",
		"refs/../bad",
		"a.lock",
	])
		expect(
			(await fixture.repository.createReleaseTag({ ...request, name })).ok
		).toBe(false);

	for (const commit of [
		"HEAD",
		"HEAD^{commit}",
		await fixture.git(["rev-parse", "HEAD^{tree}"]),
		oid,
	])
		expect(
			(
				await fixture.repository.createReleaseTag({
					...request,
					name: "bad-target",
					commit,
				})
			).ok
		).toBe(false);

	expect(
		(
			await fixture.repository.createReleaseTag({
				...request,
				name: "empty-message",
				message: " \n ",
			})
		).ok
	).toBe(false);
	expect(unwrapResult(await fixture.repository.getTags())).toHaveLength(1);
});

it("rejects stale HEAD/branch, in-progress operations and missing commits", async () => {
	const fixture = await createFixture();
	const request = await createRequest(fixture);

	await fixture.git(["checkout", "-b", "other"]);
	await fixture.write("other.txt", "other\n");
	const unrelated = await fixture.commitAll("Other");

	await fixture.git(["checkout", "main"]);

	for (const input of [
		{ ...request, expectedHead: unrelated },
		{ ...request, expectedBranch: "other" },
		{ ...request, commit: "0".repeat(40) },
	])
		expect((await fixture.repository.createReleaseTag(input)).ok).toBe(false);

	await fixture.write(".git/MERGE_HEAD", `${unrelated}\n`);
	expect((await fixture.repository.createReleaseTag(request)).ok).toBe(false);
	expect(unwrapResult(await fixture.repository.getTags())).toHaveLength(0);
});

it("supports detached HEAD and shares tags across linked worktrees", async () => {
	const fixture = await createFixture();
	const request = await createRequest(fixture);
	const linked = fixture.path("linked");

	await fixture.git(["worktree", "add", "--detach", linked, request.commit]);
	const repository = unwrapResult(await GitRepository.open({ path: linked }));

	const result = unwrapResult(
		await repository.createReleaseTag({ ...request, expectedBranch: null })
	);

	expect(result.head.branch).toBeNull();
	expect(unwrapResult(await fixture.repository.getTags())[0]?.targetOid).toBe(
		request.commit
	);
	expect(unwrapResult(await repository.getTags())).toEqual(
		unwrapResult(await fixture.repository.getTags())
	);
});

it("pushes only the selected annotated object despite mirror, force, follow-tags and default push configuration", async () => {
	const fixture = await createFixture();
	const remote = await fixture.createBareRemote();

	await fixture.git(["remote", "add", "origin", remote]);
	unwrapResult(
		await fixture.repository.createReleaseTag(await createRequest(fixture))
	);
	const request = await pushRequest(fixture, remote);

	await fixture.git(["tag", "-a", "-m", "Do not send", "other-release"]);
	await fixture.git(["config", "remote.origin.mirror", "true"]);
	await fixture.git([
		"config",
		"remote.origin.push",
		"+refs/heads/*:refs/heads/*",
	]);
	await fixture.git(["config", "push.followTags", "true"]);
	await fixture.git(["config", "push.default", "matching"]);
	await fixture.write("dirty.txt", "keep\n");
	const result = unwrapResult(await fixture.repository.pushTag(request));

	expect(result).toMatchObject({
		name: request.name,
		oid: request.expectedOid,
		remote: "origin",
	});
	expect(
		await fixture.git([
			"--git-dir",
			remote,
			"for-each-ref",
			"--format=%(refname)",
		])
	).toBe(`refs/tags/${request.name}`);
	expect(
		await fixture.git(["--git-dir", remote, "rev-parse", request.name])
	).toBe(request.expectedOid);
	expect(
		await fixture.git(["--git-dir", remote, "cat-file", "-t", request.name])
	).toBe("tag");
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(request.expectedHead);
	expect(await fixture.read("dirty.txt")).toBe("keep\n");
	// An explicit second push of the same object is safe and idempotent.
	expect((await fixture.repository.pushTag(request)).ok).toBe(true);
});

it("rejects an existing different remote tag without moving either tag", async () => {
	const fixture = await createFixture();
	const remote = await fixture.createBareRemote();

	await fixture.git(["remote", "add", "origin", remote]);
	const request = await createRequest(fixture);

	unwrapResult(await fixture.repository.createReleaseTag(request));
	await fixture.git(["push", "origin", `HEAD:refs/tags/${request.name}`]);
	const input = await pushRequest(fixture, remote);

	expect((await fixture.repository.pushTag(input)).ok).toBe(false);
	expect(
		await fixture.git(["--git-dir", remote, "rev-parse", request.name])
	).toBe(request.commit);
	expect(await fixture.git(["rev-parse", request.name])).toBe(
		input.expectedOid
	);
});

it("rejects moved/deleted tags, stale identity/destination and multiple push destinations before sending anything", async () => {
	const fixture = await createFixture();
	const remote = await fixture.createBareRemote();

	await fixture.git(["remote", "add", "origin", remote]);
	unwrapResult(
		await fixture.repository.createReleaseTag(await createRequest(fixture))
	);
	const input = await pushRequest(fixture, remote);

	for (const request of [
		{ ...input, expectedOid: "b".repeat(40) },
		{ ...input, expectedTarget: "b".repeat(40) },
		{ ...input, expectedHead: "b".repeat(40) },
		{ ...input, expectedBranch: "other" },
		{ ...input, expectedUrl: fixture.path("elsewhere") },
		{ ...input, remote: "missing" },
	])
		expect((await fixture.repository.pushTag(request)).ok).toBe(false);

	await fixture.git(["remote", "set-url", "--add", "--push", "origin", remote]);
	await fixture.git([
		"remote",
		"set-url",
		"--add",
		"--push",
		"origin",
		fixture.path("elsewhere"),
	]);
	expect((await fixture.repository.pushTag(input)).ok).toBe(false);
	await fixture.git(["config", "--unset-all", "remote.origin.pushurl"]);
	await fixture.git(["tag", "-d", input.name]);
	expect((await fixture.repository.pushTag(input)).ok).toBe(false);
	expect(
		await fixture.git([
			"--git-dir",
			remote,
			"for-each-ref",
			"--format=%(refname)",
		])
	).toBe("");
});

it("runs the pre-push hook and reports rejection without publishing or changing local files", async () => {
	const fixture = await createFixture();
	const remote = await fixture.createBareRemote();

	await fixture.git(["remote", "add", "origin", remote]);
	unwrapResult(
		await fixture.repository.createReleaseTag(await createRequest(fixture))
	);
	await fixture.write(
		".git/hooks/pre-push",
		"#!/bin/sh\necho Tag rejected >&2\nexit 1\n"
	);
	await chmod(`${fixture.repositoryPath}/.git/hooks/pre-push`, 0o755);
	const input = await pushRequest(fixture, remote);
	const result = await fixture.repository.pushTag(input);

	expect(result.ok).toBe(false);

	if (!result.ok) expect(result.error.operation).toBe("push-tag");

	expect(
		await fixture.git([
			"--git-dir",
			remote,
			"for-each-ref",
			"--format=%(refname)",
		])
	).toBe("");
	expect(await fixture.git(["rev-parse", input.name])).toBe(input.expectedOid);
});

it("pins a relative local path even if a remote with that name points elsewhere", async () => {
	const fixture = await createFixture();
	const remote = `${fixture.repositoryPath}/remote.git`;

	await fixture.git(["init", "--bare", remote]);
	const other = await fixture.createBareRemote("other.git");

	await fixture.git(["remote", "add", "origin", "remote.git"]);
	await fixture.git(["remote", "add", "remote.git", other]);
	unwrapResult(
		await fixture.repository.createReleaseTag(await createRequest(fixture))
	);
	unwrapResult(
		await fixture.repository.pushTag(await pushRequest(fixture, "remote.git"))
	);
	expect(
		await fixture.git([
			"--git-dir",
			remote,
			"for-each-ref",
			"--format=%(refname)",
		])
	).toBe("refs/tags/v1.0.0");
	expect(
		await fixture.git([
			"--git-dir",
			other,
			"for-each-ref",
			"--format=%(refname)",
		])
	).toBe("");
});
