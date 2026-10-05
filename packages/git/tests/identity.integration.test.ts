/**
 * Covers: global author reads/saves, missing keys, validation and partial failure recovery.
 * Real: Git CLI and a disposable config file, never the user's global config.
 * Doubles: process adapter redirects --global to the disposable file; injected write failure.
 * Requires: Git executable.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitIdentity } from "../src/identity";
import {
	GitCommandFailure,
	GitProcess,
	type GitCommandInput,
} from "../src/process/git-process";

let directory: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "1git-identity-"));
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

class IsolatedConfig extends GitProcess {
	readonly calls: string[][] = [];
	failEmail = false;
	async run(input: GitCommandInput) {
		this.calls.push([...input.args]);

		if (this.failEmail && input.args[2] === "user.email")
			throw new GitCommandFailure(4, "Config write failed");

		const args = input.args.flatMap((argument) =>
			argument === "--global"
				? ["--file", join(directory, "gitconfig")]
				: [argument]
		);

		return await super.run({ ...input, args });
	}
}

test("reads absent defaults and saves only global name and email without needing a repository", async () => {
	const git = new IsolatedConfig();
	const identity = new GitIdentity(git, directory);

	expect(await identity.read()).toEqual({
		ok: true,
		value: { name: null, email: null },
	});
	expect(
		await identity.write({
			name: " Tester ",
			email: " tester@example.invalid ",
		})
	).toEqual({
		ok: true,
		value: { name: "Tester", email: "tester@example.invalid" },
	});
	expect(
		git.calls.every((args) => args[0] === "config" && args[1] === "--global")
	).toBe(true);
});

test("rejects incomplete or multiline identities before writing", async () => {
	const git = new IsolatedConfig();
	const identity = new GitIdentity(git, directory);

	for (const values of [
		{ name: "", email: "a@b.invalid" },
		{ name: "Test\nInjected", email: "a@b.invalid" },
		{ name: "Test", email: "not-an-email" },
	]) {
		expect(await identity.write(values)).toMatchObject({
			ok: false,
			error: { code: "invalid-input" },
		});
	}

	expect(git.calls).toEqual([]);
});

test("reports a failed second key and allows rereading the actual saved values", async () => {
	const git = new IsolatedConfig();
	const identity = new GitIdentity(git, directory);

	await identity.write({ name: "Before", email: "before@example.invalid" });
	git.failEmail = true;
	expect(
		await identity.write({ name: "After", email: "after@example.invalid" })
	).toMatchObject({ ok: false });
	expect(await identity.read()).toEqual({
		ok: true,
		value: { name: "After", email: "before@example.invalid" },
	});
});
