/**
 * Covers: archive/helper integrity and foreground launch through macOS Launch Services.
 * Real: extracted signed app, native tree/image, and GPUIX's stdio automation protocol.
 * Doubles: fresh isolated session/accounts; no hosting or AI provider requests.
 * Requires: Apple Silicon macOS graphics access; run root test:package:macos.
 */
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
	isRecord,
	remoteHelperTargets,
} from "../../src/feature/machines/remote-protocol";
import { expect, it } from "bun:test";
import { closeSync, constants, openSync, writeSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import sharp from "sharp";
import {
	createSseDecoder,
	encodeSse,
	methods,
	parseRequest,
	type AutomationResponse,
	type MethodName,
	type ParamsOf,
} from "@gpuix/native/automation";
import { appDirectory } from "../../native/config";

const stopOwnedApp = (pid: number): void => {
	try {
		process.kill(pid);
	} catch (error) {
		if (
			!(error instanceof Error && "code" in error && error.code === "ESRCH")
		) {
			throw error;
		}
	}
};

it("opens the extracted ZIP without a terminal or checkout-dependent resources", async () => {
	if (process.platform !== "darwin" || process.arch !== "arm64") {
		throw new Error("This launch test requires Apple Silicon macOS.");
	}

	const directory = await mkdtemp(resolve(tmpdir(), "1git-release-launch-"));
	const output = resolve(appDirectory, "build/macos");
	const bundle = resolve(directory, "1git.app");
	const executable = resolve(bundle, "Contents/MacOS/1git");
	const input = resolve(directory, "automation.fifo");
	const stdout = resolve(directory, "stdout.log");
	let pipe: number | undefined;
	let pid: number | undefined;

	const run = async (command: string[], cwd = directory): Promise<string> => {
		const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
		const result = new Response(child.stdout).text();
		const errors = new Response(child.stderr).text();

		if ((await child.exited) !== 0) {
			throw new Error(`${command[0]} failed: ${await errors}`);
		}

		return await result;
	};

	try {
		await run(
			["shasum", "-a", "256", "-c", "1git-macos-arm64.zip.sha256"],
			output
		);
		await run([
			"ditto",
			"-x",
			"-k",
			resolve(output, "1git-macos-arm64.zip"),
			directory,
		]);
		const readme = await readFile(resolve(directory, "README.txt"), "utf8");

		const developerIDSigned = readme.includes(
			"This app is Developer ID signed"
		);

		const notarized = readme.includes(
			"Developer ID signed and notarized by Apple"
		);

		expect(readme).toMatch(
			/not Developer ID signed or notarized|Developer ID signed (?:and notarized|but has not been notarized) by Apple/u
		);
		await run(["codesign", "--verify", "--deep", "--strict", bundle]);

		if (notarized) {
			await run(["xcrun", "stapler", "validate", bundle]);
			await run(["/usr/sbin/spctl", "--assess", "--type", "execute", bundle]);
		}

		const helperDirectory = resolve(
			bundle,
			"Contents/Resources/remote-helpers"
		);

		expect((await readdir(helperDirectory)).sort()).toEqual(
			remoteHelperTargets
				.flatMap((target) => [`${target}.gz`, `${target}.json`])
				.sort()
		);

		for (const target of remoteHelperTargets) {
			const compressed = await readFile(
				resolve(helperDirectory, `${target}.gz`)
			);

			const metadata: unknown = JSON.parse(
				await readFile(resolve(helperDirectory, `${target}.json`), "utf8")
			);

			expect(isRecord(metadata) && metadata.compressedSha256).toBe(
				createHash("sha256").update(compressed).digest("hex")
			);
			expect(isRecord(metadata) && metadata.sha256).toBe(
				createHash("sha256").update(gunzipSync(compressed)).digest("hex")
			);

			if (developerIDSigned && target.startsWith("darwin-")) {
				const helper = resolve(directory, target);

				await writeFile(helper, gunzipSync(compressed), { mode: 0o755 });
				await run(["codesign", "--verify", "--strict", helper]);
			}
		}

		await run(["mkfifo", input]);
		pipe = openSync(input, constants.O_RDWR);

		await run([
			"/usr/bin/open",
			"-n",
			bundle,
			"--stdin",
			input,
			"--stdout",
			stdout,
			"--stderr",
			resolve(directory, "stderr.log"),
			"--env",
			`GPUIX_SESSION_PATH=${resolve(directory, "session.json")}`,
			"--env",
			`GPUIX_ACCOUNTS_PATH=${resolve(directory, "accounts.json")}`,
			"--env",
			"GPUIX_PREVIEW=0",
			"--env",
			"GPUIX_BACKGROUND=0",
		]);

		const responses = new Map<number, AutomationResponse>();

		const decoder = createSseDecoder((message) => {
			if ("id" in message && !("method" in message))
				responses.set(message.id, message);
		});

		const textDecoder = new TextDecoder();
		let offset = 0;
		let nextId = 0;

		const request = async (
			method: MethodName,
			params: ParamsOf<MethodName>
		): Promise<unknown> => {
			if (pipe === undefined) throw new Error("Automation pipe is closed.");

			const id = ++nextId;

			writeSync(pipe, encodeSse(parseRequest({ id, method, params })));
			const deadline = Date.now() + 10000;

			while (!responses.has(id)) {
				if (Date.now() > deadline) {
					throw new Error(
						`App launch timed out for ${method}: ${await Bun.file(resolve(directory, "stderr.log")).text()}`
					);
				}

				if (await Bun.file(stdout).exists()) {
					const bytes = await readFile(stdout);

					decoder.feed(
						textDecoder.decode(bytes.subarray(offset), { stream: true })
					);
					offset = bytes.length;
				}

				await Bun.sleep(50);
			}

			const response = responses.get(id);

			if (!response) throw new Error("Missing automation response.");

			if ("error" in response) throw new Error(response.error.message);

			return response.result;
		};

		const initialized = methods.initialize.result.parse(
			await request("initialize", {
				protocolVersion: 1,
				client: "1git-release-launch-test",
			})
		);

		pid = initialized.pid;
		expect(pid).toBeGreaterThan(1);

		const deadline = Date.now() + 10000;
		let text: string[] = [];

		while (!text.includes("Welcome to 1git") && Date.now() < deadline) {
			text = methods.getAllText.result.parse(
				await request("getAllText", {})
			).text;
			await Bun.sleep(50);
		}

		expect(
			text,
			await Bun.file(resolve(directory, "stderr.log")).text()
		).toContain("Welcome to 1git");
		expect(text).toContain("Continue");
		expect(text).not.toContain("Uncaught runtime errors:");
		// The last-frame text log can be empty when GPUI reuses cached drawing.
		const screenshot = resolve(directory, "launch.png");
		let rendered = false;

		do {
			await request("screenshot", { path: screenshot });
			const pixels = await sharp(screenshot).stats();

			rendered = pixels.channels.slice(0, 3).some(({ stdev }) => stdev > 2);

			if (!rendered) await Bun.sleep(50);
		} while (!rendered && Date.now() < deadline);

		expect(rendered, "The native window must render beyond a blank frame").toBe(
			true
		);
	} finally {
		// If initialization failed, locate only this test's unique extracted executable.
		if (pid === undefined) {
			const escaped = executable.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

			const child = Bun.spawn(["pgrep", "-f", `^${escaped}([[:space:]]|$)`], {
				stdout: "pipe",
			});

			const matches = await new Response(child.stdout).text();

			await child.exited;
			pid = Number(matches.trim());
		}

		try {
			if (pid !== undefined && Number.isSafeInteger(pid) && pid > 1)
				stopOwnedApp(pid);
		} finally {
			if (pipe !== undefined) closeSync(pipe);

			await rm(directory, { recursive: true, force: true });
		}
	}
}, 30000);
