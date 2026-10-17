/**
 * Covers: isolated remote execution scopes, local defaults, and no fallback after remote failures.
 * Real: AsyncLocalStorage, GitProcess dispatch, filesystem wrappers.
 * Doubles: two remote execution runtimes; no SSH host or Git process.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import {
	GitExecution,
	readFile,
	homedir,
	type GitExecutionRuntime,
} from "../src/runtime";
import { GitProcess } from "../src/process/git-process";
import { homedir as localHome } from "node:os";

it("keeps concurrent machines and the local filesystem in separate async scopes", async () => {
	const runtime = (home: string): GitExecutionRuntime => ({
		home,
		temporary: "/tmp",
		async files() {
			await Promise.resolve();

			return home;
		},
		async git() {
			await Promise.resolve();

			return { stdout: Buffer.from(home), stderr: Buffer.alloc(0) };
		},
	});

	const results = await Promise.all(
		["/first", "/second"].map((home) =>
			GitExecution.run(runtime(home), async () => {
				const file = await readFile("/remote/file", "utf8");

				const command = await new GitProcess({
					executable: "must-never-be-started-locally",
				}).run({ args: [], cwd: "/remote" });

				return [homedir(), file, command.stdout.toString()];
			})
		)
	);

	expect(results).toEqual([
		["/first", "/first", "/first"],
		["/second", "/second", "/second"],
	]);
	expect(homedir()).toBe(localHome());
	expect(await readFile(import.meta.filename, "utf8")).toContain(
		"separate async scopes"
	);
});

it("propagates remote failures even when the same path exists locally", async () => {
	const runtime: GitExecutionRuntime = {
		home: "/remote",
		temporary: "/tmp",
		async files() {
			throw new Error("Remote filesystem unavailable");
		},
		async git() {
			throw new Error("Remote Git unavailable");
		},
	};

	await expect(
		GitExecution.run(runtime, async () => await readFile(import.meta.filename))
	).rejects.toThrow("Remote filesystem unavailable");
	await expect(
		GitExecution.run(
			runtime,
			async () => await new GitProcess().run({ args: ["--version"], cwd: "/" })
		)
	).rejects.toThrow("Remote Git unavailable");
});
