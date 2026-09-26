/**
 * Covers: cancellation and output-limit failures wait for child shutdown before caller cleanup.
 * Real: process spawning, signals, output collection and temporary files.
 * Doubles: a local shell executable with delayed termination instead of Git.
 * Requires: a POSIX shell, Git for isolated fixture setup and writable temporary storage; no network.
 */
import { afterEach, expect, it } from "bun:test";
import { chmod, writeFile } from "node:fs/promises";
import { GitProcess } from "../../src/process/git-process.js";
import { RepositoryFixtures } from "../_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => {
	await fixtures.cleanup();
});

it.each(["aborted", "output-too-large"] as const)(
	"waits for process termination on %s",
	async (reason) => {
		const fixture = await fixtures.create();
		const executable = fixture.path("delayed-exit.sh");

		await writeFile(
			executable,
			[
				"#!/bin/sh",
				`trap 'sleep 0.1; touch "$0.stopped"; exit 0' TERM`,
				'touch "$0.ready"',
				reason === "output-too-large" ? "echo trigger-output-limit" : "",
				"while :; do sleep 0.02; done",
				"",
			].join("\n")
		);
		await chmod(executable, 0o700);
		const controller = new AbortController();
		const process = new GitProcess({ executable, maxOutputBytes: 1 });

		const result = process
			.run({ args: [], cwd: fixture.sandboxPath, signal: controller.signal })
			.catch((error: unknown) => error);

		if (reason === "aborted") {
			const deadline = Date.now() + 2000;

			while (
				!(await Bun.file(`${executable}.ready`).exists()) &&
				Date.now() < deadline
			)
				await Bun.sleep(10);

			controller.abort();
		}

		expect(await result).toMatchObject({ reason });
		expect(await Bun.file(`${executable}.stopped`).exists()).toBe(true);
	}
);
