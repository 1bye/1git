/**
 * Covers: cancellation and output-limit failures wait for process/descendant shutdown, including streamed stdout and bounded stderr.
 * Real: process spawning, signals, output collection and temporary files.
 * Doubles: a local shell executable with delayed termination instead of Git.
 * Requires: a POSIX shell, Git for isolated fixture setup and writable temporary storage; no network.
 */
import { afterEach, expect, it } from "bun:test";
import { chmod, open, writeFile } from "node:fs/promises";
import { GitProcess } from "../../src/process/git-process.js";
import { RepositoryFixtures } from "../_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => {
	await fixtures.cleanup();
});

it("stops a helper holding inherited output pipes before acknowledging cancellation", async () => {
	const fixture = await fixtures.create();
	const executable = fixture.path("parent.sh");
	const helper = fixture.path("helper.sh");

	await writeFile(
		helper,
		`#!/bin/sh\ntrap 'touch "$0.stopped"; exit 0' TERM\ntouch "$0.ready"\nwhile :; do sleep 1; done\n`
	);
	await writeFile(executable, `#!/bin/sh\n/bin/sh "$0.helper" &\nwait\n`);
	await writeFile(`${executable}.helper`, await Bun.file(helper).text());
	await chmod(executable, 0o700);
	const controller = new AbortController();
	const process = new GitProcess({ executable });

	const result = process
		.run({ args: [], cwd: fixture.sandboxPath, signal: controller.signal })
		.catch((error: unknown) => error);

	const deadline = Date.now() + 2000;

	while (
		!(await Bun.file(`${executable}.helper.ready`).exists()) &&
		Date.now() < deadline
	)
		await Bun.sleep(10);

	controller.abort();
	expect(await result).toMatchObject({ reason: "aborted" });
	expect(await Bun.file(`${executable}.helper.stopped`).exists()).toBe(true);
});

it.each([
	["buffered", "aborted"],
	["buffered", "output-too-large"],
	["streamed", "aborted"],
	["streamed", "output-too-large"],
] as const)("waits for process termination (%s, %s)", async (mode, reason) => {
	const streamed = mode === "streamed";
	const fixture = await fixtures.create();
	const executable = fixture.path("delayed-exit.sh");

	await writeFile(
		executable,
		[
			"#!/bin/sh",
			`trap 'sleep 0.1; touch "$0.stopped"; exit 0' TERM`,
			'touch "$0.ready"',
			streamed ? "echo streamed-output" : "",
			reason === "output-too-large" ? "echo trigger-output-limit >&2" : "",
			"while :; do sleep 0.02; done",
			"",
		].join("\n")
	);
	await chmod(executable, 0o700);
	const controller = new AbortController();
	const process = new GitProcess({ executable, maxOutputBytes: 1 });

	const output = streamed
		? await open(fixture.path("patch"), "wx", 0o600)
		: undefined;

	try {
		const result = process
			.run({
				args: [],
				cwd: fixture.sandboxPath,
				signal: controller.signal,
				stdoutFile: output?.fd,
			})
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
	} finally {
		await output?.close();
	}
});
