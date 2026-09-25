import { afterEach, describe, expect, test } from "bun:test";
import { chmod, writeFile } from "node:fs/promises";

import {
	GitCommandFailure,
	GitProcess,
	GitProcessFailure,
} from "../src/process/git-process.js";
import { RepositoryFixtures } from "./_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => {
	await fixtures.cleanup();
});

describe("GitProcess", () => {
	test("executes Git without a shell", async () => {
		const gitProcess = new GitProcess();

		const output = await gitProcess.run({
			args: ["--version"],
			cwd: process.cwd(),
		});

		expect(output.stdout.toString("utf8")).toStartWith("git version ");
	});

	test("passes stdin to Git", async () => {
		const gitProcess = new GitProcess();

		const output = await gitProcess.run({
			args: ["hash-object", "--stdin"],
			cwd: process.cwd(),
			stdin: "hello\n",
		});

		expect(output.stdout.toString("utf8").trim()).toHaveLength(40);
	});

	test("uses configured Git credential helpers without terminal prompts", async () => {
		const fixture = await fixtures.create();
		const helperPath = fixture.path("credential-helper.sh");

		await writeFile(
			helperPath,
			[
				"#!/bin/sh",
				'if [ "$1" = "get" ]; then',
				'  echo "username=helper-user"',
				'  echo "password=helper-secret"',
				"fi",
				"",
			].join("\n")
		);
		await chmod(helperPath, 0o700);
		await fixture.git(["config", "credential.helper", `!${helperPath}`]);

		const credentials = await fixture.git(
			["credential", "fill"],
			"protocol=https\nhost=example.com\n\n"
		);

		expect(credentials).toContain("username=helper-user");
		expect(credentials).toContain("password=helper-secret");
	});

	test("reports non-zero Git exits", async () => {
		const gitProcess = new GitProcess();

		await expect(
			gitProcess.run({
				args: ["rev-parse", "--verify", "definitely-missing"],
				cwd: process.cwd(),
			})
		).rejects.toBeInstanceOf(GitCommandFailure);
	});

	test("reports missing executables", async () => {
		const gitProcess = new GitProcess({
			executable: "onegit-definitely-missing-git",
		});

		try {
			await gitProcess.run({ args: ["--version"], cwd: process.cwd() });

			throw new Error("Expected the Git process to fail.");
		} catch (error: unknown) {
			expect(error).toBeInstanceOf(GitProcessFailure);

			if (error instanceof GitProcessFailure) {
				expect(error.reason).toBe("git-not-found");
			}
		}
	});

	test("rejects an already aborted operation", async () => {
		const gitProcess = new GitProcess();
		const controller = new AbortController();

		controller.abort();

		try {
			await gitProcess.run({
				args: ["--version"],
				cwd: process.cwd(),
				signal: controller.signal,
			});

			throw new Error("Expected the Git process to abort.");
		} catch (error: unknown) {
			expect(error).toBeInstanceOf(GitProcessFailure);

			if (error instanceof GitProcessFailure) {
				expect(error.reason).toBe("aborted");
			}
		}
	});

	test("bounds collected stdout and stderr", async () => {
		const fixture = await fixtures.create();

		await fixture.write("large.txt", "x".repeat(4096));
		await fixture.commitAll("large file");
		const gitProcess = new GitProcess({ maxOutputBytes: 32 });

		try {
			await gitProcess.run({
				args: ["show", "HEAD:large.txt"],
				cwd: fixture.repositoryPath,
			});

			throw new Error("Expected output collection to stop.");
		} catch (error: unknown) {
			expect(error).toBeInstanceOf(GitProcessFailure);

			if (error instanceof GitProcessFailure) {
				expect(error.reason).toBe("output-too-large");
			}
		}
	});
});
