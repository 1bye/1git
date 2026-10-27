/**
 * Covers: local path parsing and validation for launcher arguments and frames.
 * Real: path normalization and JSON parsing only.
 * Doubles: none.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { chmod, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
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
	expect(launcherScript).toContain("nohup env ONEGIT_LAUNCHER_MODE=1");
});

it("returns after handing a first launch to a detached app process", async () => {
	const directory = await mkdtemp(join(tmpdir(), "1git-launcher-detached-"));
	const bundle = join(directory, "1git.app");
	const executable = join(bundle, "Contents", "MacOS", "1git");
	const launcher = join(bundle, "Contents", "Resources", "1git-launcher");
	const marker = join(directory, "launches.txt");

	try {
		await mkdir(join(bundle, "Contents", "MacOS"), { recursive: true });
		await mkdir(join(bundle, "Contents", "Resources"), { recursive: true });
		await writeFile(
			executable,
			`#!/bin/sh\nvalidate="\${ONEGIT_LAUNCHER_VALIDATE:-0}"\nprintf '%s\\n' "$validate:$*" >> "$ONEGIT_TEST_MARKER"\nif [ "$validate" = 1 ]; then\n  if [ "$(wc -l < "$ONEGIT_TEST_MARKER")" -eq 1 ]; then exit 10; fi\n  exit 0\nfi\n`,
			{ mode: 0o755 }
		);
		await writeFile(launcher, launcherScript, { mode: 0o755 });
		await chmod(launcher, 0o755);

		const started = Date.now();

		const process = Bun.spawn(["/bin/sh", launcher, "relative/path"], {
			env: { ...Bun.env, ONEGIT_TEST_MARKER: marker },
			stdout: "pipe",
			stderr: "pipe",
		});

		expect(await process.exited).toBe(0);
		expect(Date.now() - started).toBeLessThan(1_000);

		for (let attempt = 0; attempt < 100; attempt += 1) {
			try {
				const launches = await readFile(marker, "utf8");

				if (
					launches.includes("1:relative/path") &&
					launches.includes("0:relative/path")
				)
					break;
			} catch {
				// The detached child has not written its marker yet.
			}

			await Bun.sleep(10);
		}

		expect(await readFile(marker, "utf8")).toContain("1:relative/path");
		expect(await readFile(marker, "utf8")).toContain("0:relative/path");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

it("reports when a detached first launch never becomes ready", async () => {
	const directory = await mkdtemp(
		join(tmpdir(), "1git-launcher-failed-start-")
	);

	const bundle = join(directory, "1git.app");
	const executable = join(bundle, "Contents", "MacOS", "1git");
	const launcher = join(bundle, "Contents", "Resources", "1git-launcher");

	try {
		await mkdir(join(bundle, "Contents", "MacOS"), { recursive: true });
		await mkdir(join(bundle, "Contents", "Resources"), { recursive: true });
		await writeFile(
			executable,
			`#!/bin/sh\nif [ "\${ONEGIT_LAUNCHER_VALIDATE:-0}" = 1 ]; then exit 10; fi\nexit 1\n`,
			{ mode: 0o755 }
		);
		await writeFile(launcher, launcherScript, { mode: 0o755 });

		const process = Bun.spawn(["/bin/sh", launcher], {
			stdout: "pipe",
			stderr: "pipe",
		});

		const stderr = new Response(process.stderr).text();

		expect(await process.exited).toBe(1);
		expect(await stderr).toContain("did not become ready");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
