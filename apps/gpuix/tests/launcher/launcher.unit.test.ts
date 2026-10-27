/**
 * Covers: local path parsing and validation for launcher arguments and frames.
 * Real: path normalization and JSON parsing only.
 * Doubles: none.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	parseLauncherArguments,
	parseLauncherRequest,
} from "../../src/launcher/launcher-protocol";
import { launcherScript } from "../../src/launcher/launcher-script";

it("normalizes local paths and rejects remote-looking arguments", async () => {
	const directory = await mkdtemp(join(tmpdir(), "1git-launcher-"));
	const nested = join(directory, "repo");

	try {
		await mkdir(nested);

		expect(parseLauncherArguments(["repo"], directory).path).toBe(
			await realpath(nested)
		);
		expect(parseLauncherArguments([], directory)).toEqual({ version: 1 });
		expect(parseLauncherArguments(["-psn_0_1234"], directory)).toEqual({
			version: 1,
		});
		expect(() =>
			parseLauncherArguments(["https://example.test"], directory)
		).toThrow("local paths");
		expect(() => parseLauncherArguments(["one", "two"], directory)).toThrow(
			"zero or one"
		);
		expect(() =>
			parseLauncherRequest('{"version":1,"path":"/tmp/a\\u0000b"}')
		).toThrow();
		expect(() =>
			parseLauncherRequest('{"version":1,"path":"relative"}')
		).toThrow("absolute");
		expect(() => parseLauncherRequest('{"version":1,"extra":true}')).toThrow();
		expect(() => parseLauncherRequest("[]")).toThrow();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

it("keeps the packaged launcher detached after validating its arguments", async () => {
	const shell = Bun.spawn(["/bin/sh", "-n", "-c", launcherScript], {
		stdout: "pipe",
		stderr: "pipe",
	});

	expect(await shell.exited, await new Response(shell.stderr).text()).toBe(0);
	expect(launcherScript).toContain("ONEGIT_LAUNCHER_VALIDATE=1");
	expect(launcherScript).toContain('openCommand="/usr/bin/open"');
	expect(launcherScript).not.toContain("nohup");
	expect(launcherScript).toContain('[ -S "$socketPath" ]');
});

it("reports a failed cold start after the readiness budget", async () => {
	const directory = await mkdtemp(
		join(tmpdir(), "1git-launcher-failed-start-")
	);

	const bundle = join(directory, "1git.app");
	const executable = join(bundle, "Contents", "MacOS", "1git");
	const launcher = join(bundle, "Contents", "Resources", "1git-launcher");
	const openStub = join(directory, "open");
	const sleepStubDirectory = join(directory, "bin");
	const sleepStub = join(sleepStubDirectory, "sleep");
	const socketPath = join(directory, "missing.sock");

	try {
		await mkdir(join(bundle, "Contents", "MacOS"), { recursive: true });
		await mkdir(join(bundle, "Contents", "Resources"), { recursive: true });
		await mkdir(sleepStubDirectory);
		await writeFile(
			executable,
			`#!/bin/sh
if [ "\${ONEGIT_LAUNCHER_VALIDATE:-0}" = 1 ]; then exit 10; fi
exit 1
`,
			{ mode: 0o755 }
		);
		await writeFile(openStub, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
		await writeFile(sleepStub, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
		await writeFile(
			launcher,
			launcherScript.replace(
				'openCommand="/usr/bin/open"',
				`openCommand="${openStub}"`
			),
			{ mode: 0o755 }
		);

		const child = Bun.spawn(["/bin/sh", launcher], {
			env: {
				...Bun.env,
				GPUIX_LAUNCHER_SOCKET: socketPath,
				PATH: `${sleepStubDirectory}:${Bun.env.PATH ?? "/usr/bin:/bin"}`,
			},
			stdout: "pipe",
			stderr: "pipe",
		});

		const stderr = new Response(child.stderr).text();

		expect(await child.exited).toBe(1);
		expect(await stderr).toContain("did not become ready");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
