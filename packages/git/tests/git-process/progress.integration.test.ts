/**
 * Covers: live safe progress before child exit, including authenticated commands and CR-separated updates.
 * Real: process spawning, stderr streaming and temporary files.
 * Doubles: a local executable emitting Git progress; no hosted remote or credential store.
 * Requires: a POSIX shell, Git for fixture setup and writable temporary storage.
 */
import { afterEach, expect, it } from "bun:test";
import { writeFile } from "node:fs/promises";
import { GitProcess } from "../../src/process/git-process.js";
import type { GitTransferProgress } from "../../src/contracts.js";
import { RepositoryFixtures } from "../_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => {
	await fixtures.cleanup();
});

it("reports only typed progress while the command is running, preserving its output", async () => {
	const fixture = await fixtures.create();
	const executable = fixture.path("progress-git.sh");

	await writeFile(
		executable,
		"#!/bin/sh\nprintf 'fixture-secret\\nWriting objects: 31%% (31/100)\\r' >&2\nsleep 0.1\nprintf 'Writing objects: 100%% (100/100), done.\\n' >&2\n",
		{ mode: 0o700 }
	);
	const first = Promise.withResolvers<GitTransferProgress>();
	const events: GitTransferProgress[] = [];
	let finished = false;

	const running = (async () => {
		const output = await new GitProcess({ executable }).run({
			args: ["push", "--progress"],
			cwd: fixture.repositoryPath,
			httpAuthentication: {
				url: "https://example.invalid/repo.git",
				username: "fixture",
				password: "fixture-secret",
			},
			onProgress: (event) => {
				events.push(event);
				first.resolve(event);
			},
		});

		finished = true;

		return output;
	})();

	expect(await first.promise).toEqual({ phase: "sending", percent: 31 });
	expect(finished).toBe(false);
	const output = await running;

	expect(events).toEqual([
		{ phase: "sending", percent: 31 },
		{ phase: "sending", percent: 100 },
	]);
	expect(JSON.stringify(events)).not.toContain("fixture-secret");
	expect(output.stderr.toString()).toContain("Writing objects: 100%");
});
