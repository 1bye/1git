/**
 * Covers: ad-hoc credential migration and two changed builds retaining native Keychain access.
 * Real: pinned release signer, codesign, Security.framework and an isolated disposable Keychain.
 * Doubles: tiny native hosts and synthetic ChatGPT credential; reconnect is explicit, never automatic.
 * Requires: Apple Silicon macOS, Xcode and setup:signing:macos; no user credentials or publishing.
 */
import { expect, it } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { MacSigning, signingCommand } from "../../native/macos-signing";
import { appDirectory } from "../../native/config";

it("requires explicit migration once, then reads from two successive signed builds with all authentication UI disabled", async () => {
	const directory = await mkdtemp(resolve(tmpdir(), "1git-signing-test-"));
	const keychain = resolve(directory, "synthetic.keychain-db");
	const signing = await MacSigning.load({}, true);
	const identifier = `dev.1git.signingtest.${crypto.randomUUID()}`;
	const service = `1git-hosting-v1:${"f".repeat(64)}`;
	const paths: string[] = [];
	const requirements: string[] = [];

	const run = async (args: string[]): Promise<void> => {
		await signingCommand(args);
	};

	let created = false;

	try {
		await signing.verify();
		await run([
			"/usr/bin/security",
			"create-keychain",
			"-p",
			"synthetic-test-only",
			keychain,
		]);
		created = true;
		await run([
			"/usr/bin/security",
			"unlock-keychain",
			"-p",
			"synthetic-test-only",
			keychain,
		]);

		for (const [index, version] of ["0.0.9", "0.0.10", "0.0.11"].entries()) {
			const bundle = resolve(directory, version, "1git.app");
			const contents = resolve(bundle, "Contents");
			const executable = resolve(contents, "MacOS/1git");

			await mkdir(resolve(contents, "MacOS"), { recursive: true });
			await writeFile(
				resolve(contents, "Info.plist"),
				`<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identifier}</string><key>CFBundleExecutable</key><string>1git</string><key>CFBundleVersion</key><string>${version}</string></dict></plist>`
			);
			await run([
				"xcrun",
				"clang",
				"-fobjc-arc",
				"-Wno-deprecated-declarations",
				"-framework",
				"Foundation",
				"-framework",
				"Security",
				resolve(appDirectory, "tests/_shared/signing-keychain-probe.m"),
				"-o",
				executable,
			]);

			if (index === 0) await new MacSigning(null).sign(bundle, run);
			else await signing.sign(bundle, run);

			await run([
				"/usr/bin/codesign",
				"--verify",
				"--deep",
				"--strict",
				bundle,
			]);
			const child = Bun.spawn(["/usr/bin/codesign", "-d", "-r-", bundle], {
				stdout: "pipe",
				stderr: "pipe",
			});

			const [stdout, stderr, code] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);

			const output = `${stdout}\n${stderr}`;

			expect(code).toBe(0);
			requirements.push(
				output.split("designated => ")[1]?.split("\n")[0]?.trim() ?? ""
			);
			paths.push(executable);
		}

		const [old, first, second] = paths;

		if (!old || !first || !second) throw new Error("Missing signed test host.");

		const credential = async (executable: string, action: string) =>
			JSON.parse(
				await signingCommand([executable, keychain, service, action])
			) as { status: number; value: string };

		expect((await credential(old, "create")).status).toBe(0);
		expect((await credential(old, "read")).value).toBe(
			"synthetic-chatgpt-session"
		);
		// Existing ad-hoc ACLs cannot be bypassed. Reconnect deliberately replaces only the synthetic entry.
		expect((await credential(first, "read")).status).not.toBe(0);
		expect((await credential(old, "delete")).status).toBe(0);
		expect((await credential(first, "create")).status).toBe(0);
		expect((await credential(old, "read")).status).not.toBe(0);

		for (const executable of [first, second, first]) {
			expect(await credential(executable, "read")).toEqual({
				status: 0,
				value: "synthetic-chatgpt-session",
			});
		}

		expect(requirements[0]).toContain("cdhash");
		expect(requirements[1]).toBe(requirements[2]);
		expect(requirements[1]).not.toContain("cdhash");
		expect(requirements[1]).toContain(signing.fingerprint.toLowerCase());
		// Replacement at an identical install path must also retain access, as Sparkle does.
		await cp(resolve(second, "../../.."), resolve(first, "../../.."), {
			recursive: true,
			verbatimSymlinks: true,
		});
		await run([
			"/usr/bin/codesign",
			"--verify",
			"--deep",
			"--strict",
			resolve(first, "../../.."),
		]);
		expect(await credential(first, "read")).toEqual({
			status: 0,
			value: "synthetic-chatgpt-session",
		});
	} finally {
		if (created) await run(["/usr/bin/security", "delete-keychain", keychain]);

		await rm(directory, { recursive: true, force: true });
	}
}, 30000);
