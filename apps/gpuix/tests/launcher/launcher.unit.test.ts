/**
 * Covers: local path parsing and validation for launcher arguments and frames.
 * Real: path normalization and JSON parsing only.
 * Doubles: none.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { mkdir, realpath } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	parseLauncherArguments,
	parseLauncherRequest,
} from "../../src/launcher/launcher-protocol";

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
