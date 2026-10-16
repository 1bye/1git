/**
 * Covers: archive/helper integrity and foreground launch through macOS Launch Services.
 * Real: extracted signed app, native frames, and GPUIX's stdio automation protocol.
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
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
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
		expect(await readFile(resolve(directory, "README.txt"), "utf8")).toContain(
			"not Developer ID signed or notarized"
		);
		await run(["codesign", "--verify", "--deep", "--strict", bundle]);
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
		let painted: string[] = [];

		while (!painted.includes("Welcome to 1git") && Date.now() < deadline) {
			painted = methods.getPaintedText.result.parse(
				await request("getPaintedText", {})
			).text;
			await Bun.sleep(50);
		}

		expect(
			painted,
			await Bun.file(resolve(directory, "stderr.log")).text()
		).toContain("Welcome to 1git");
		expect(painted).toContain("Continue");
		expect(painted).not.toContain("Uncaught runtime errors:");
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
