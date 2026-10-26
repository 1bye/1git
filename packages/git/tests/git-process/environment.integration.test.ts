/**
 * Covers: Git hooks inherit the command environment without the app's native-library override.
 * Real: Git pushes, pre-push hooks and disposable local repositories.
 * Doubles: fixture hook checks its environment instead of loading a native tool.
 * Requires: Git, a POSIX shell and writable temporary storage.
 */
import { afterEach, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { GitProcess } from "../../src/process/git-process.js";
import { RepositoryFixtures } from "../_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => {
	await fixtures.cleanup();
});

test.each(["default", "authenticated"] as const)(
	"runs pre-push hooks without the app's native override (%s environment)",
	async (environment) => {
		const fixture = await fixtures.create();
		const remote = await fixture.createBareRemote();

		await writeFile(
			join(fixture.repositoryPath, ".git/hooks/pre-push"),
			[
				"#!/bin/sh",
				'if [ "${NAPI_RS_NATIVE_LIBRARY_PATH+set}" = set ]; then',
				'  echo "Native-library override leaked into hook" >&2',
				"  exit 1",
				"fi",
				'printf "%s\\n" "hook ran" "PATH=$PATH" "GIT_TERMINAL_PROMPT=$GIT_TERMINAL_PROMPT" >&2',
				"",
			].join("\n"),
			{ mode: 0o700 }
		);
		const previousOverride = process.env.NAPI_RS_NATIVE_LIBRARY_PATH;
		const nativeLibrary = fixture.path("gpuix-native.node");

		process.env.NAPI_RS_NATIVE_LIBRARY_PATH = nativeLibrary;

		try {
			const output = await new GitProcess().run({
				args: ["-c", "protocol.file.allow=always", "push", remote, "HEAD"],
				cwd: fixture.repositoryPath,
				httpAuthentication:
					environment === "authenticated"
						? {
								url: "https://example.invalid/repo.git",
								username: "fixture-user",
								password: "fixture-secret",
							}
						: undefined,
			});

			const hookOutput = output.stderr.toString("utf8");

			expect(hookOutput).toContain("hook ran\n");
			expect(hookOutput).toContain(`${process.env.PATH}\n`);
			expect(hookOutput).toContain("GIT_TERMINAL_PROMPT=0\n");
			expect(process.env.NAPI_RS_NATIVE_LIBRARY_PATH).toBe(nativeLibrary);
		} finally {
			if (previousOverride === undefined)
				delete process.env.NAPI_RS_NATIVE_LIBRARY_PATH;
			else process.env.NAPI_RS_NATIVE_LIBRARY_PATH = previousOverride;
		}
	}
);
