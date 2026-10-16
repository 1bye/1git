/**
 * Covers: app-only release ZIP, signed HTTPS feed, and wrong signing-key rejection.
 * Real: copied packaged app and Sparkle's archive/feed signing tools.
 * Doubles: temporary key/HTTPS domain; no Keychain, R2 requests, or uploads.
 * Requires: Apple Silicon macOS, packaged app; root test:updates:macos.
 */
import { expect, it } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { appDirectory } from "../../native/config";
import { sparkleDirectory } from "../../native/sparkle";
import { prepareUpdates } from "../../native/prepare-updates";
import { bundleInfoPlist } from "../../native/package-resources";

it("prepares signed artifacts locally and leaves them unchanged on a wrong key", async () => {
	const directory = await mkdtemp(
		resolve(tmpdir(), "1git-update-preparation-")
	);

	const bundle = resolve(directory, "1git.app");
	const output = resolve(directory, "updates");

	const run = async (args: string[]): Promise<string> => {
		const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
		const stdout = new Response(child.stdout).text();
		const stderr = new Response(child.stderr).text();

		if ((await child.exited) !== 0) throw new Error(await stderr);

		return await stdout;
	};

	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	const keyFile = resolve(directory, "key");

	await writeFile(
		keyFile,
		privateKey
			.export({ type: "pkcs8", format: "der" })
			.subarray(-32)
			.toString("base64"),
		{ mode: 0o600 }
	);

	try {
		await cp(resolve(appDirectory, "build/macos/1git.app"), bundle, {
			recursive: true,
			verbatimSymlinks: true,
		});
		const plist = resolve(bundle, "Contents/Info.plist");

		// Own all public metadata, independent of the last packaged version or its real feed/key.
		await writeFile(
			plist,
			bundleInfoPlist("0.0.1", {
				feedURL: "https://updates.example.com/appcast.xml",
				publicKey: publicKey
					.export({ type: "spki", format: "der" })
					.subarray(-32)
					.toString("base64"),
			})
		);
		await run(["codesign", "--force", "--sign", "-", bundle]);
		await prepareUpdates(bundle, output, keyFile);
		const feed = await Bun.file(resolve(output, "appcast.xml")).text();

		expect(feed).toContain(
			"https://updates.example.com/1git-0.0.1-macos-arm64.zip"
		);
		expect(feed).toContain("sparkle:edSignature");
		await run([
			resolve(sparkleDirectory, "bin/sign_update"),
			"--verify",
			"--ed-key-file",
			keyFile,
			resolve(output, "appcast.xml"),
		]);
		const entries = await run([
			"unzip",
			"-Z1",
			resolve(output, "1git-0.0.1-macos-arm64.zip"),
		]);

		expect(entries).toContain("1git.app/Contents/Info.plist");
		expect(entries).not.toContain("README.txt");
		const wrongKey = generateKeyPairSync("ed25519").privateKey;
		const wrongFile = resolve(directory, "wrong-key");

		await writeFile(
			wrongFile,
			wrongKey
				.export({ type: "pkcs8", format: "der" })
				.subarray(-32)
				.toString("base64"),
			{ mode: 0o600 }
		);
		await expect(prepareUpdates(bundle, output, wrongFile)).rejects.toThrow(
			"does not match"
		);
		expect(await Bun.file(resolve(output, "appcast.xml")).text()).toBe(feed);
		expect((await readdir(output)).sort()).toEqual([
			"1git-0.0.1-macos-arm64.zip",
			"appcast.xml",
		]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}, 30000);
