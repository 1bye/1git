/**
 * Covers: root release CLI version forwarding, real build/signing, and offline dry-run.
 * Real: Turbo, Xcode, packaged app metadata, Sparkle signing tools.
 * Doubles: saved test stack output, disposable key and missing profile; no R2 access.
 * Requires: Apple Silicon macOS and Xcode; root test:release:macos.
 */
import { expect, it } from "bun:test";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
	cp,
	mkdir,
	mkdtemp,
	readdir,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { appDirectory } from "../../native/config";

it("builds a signed versioned release without accessing R2 or changing development defaults", async () => {
	if (process.platform !== "darwin" || process.arch !== "arm64")
		throw new Error("Requires Apple Silicon macOS.");

	const directory = await mkdtemp(resolve(tmpdir(), "1git-release-command-"));
	const outputs = ["macos", "updates"];
	const previous = new Set<string>();
	let outputsTouched = false;
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
	const manifest = await Bun.file(resolve(appDirectory, "package.json")).text();
	const fakeSecret = "synthetic-publisher-secret-must-not-enter-app";
	const stage = `test-${randomUUID()}`;

	const stateDirectory = resolve(
		appDirectory,
		"../releases/.alchemy/state/1git-releases",
		stage
	);

	const updateOutput = resolve(appDirectory, "build/updates");

	const initialReleases = new Set(
		existsSync(updateOutput) ? await readdir(updateOutput) : []
	);

	try {
		await mkdir(stateDirectory, { recursive: true });
		await writeFile(
			resolve(stateDirectory, "__stack_output__.json"),
			JSON.stringify({
				accountId: "a".repeat(32),
				bucketName: "test-updates",
				jurisdiction: "default",
				workerURL: "https://updates.example.com/",
			})
		);

		for (const name of outputs) {
			const path = resolve(appDirectory, "build", name);

			if (existsSync(path)) {
				previous.add(name);
				await cp(path, resolve(directory, name), {
					recursive: true,
					verbatimSymlinks: true,
				});
			}
		}

		const env = Object.fromEntries(
			Object.entries(process.env).filter(
				([name]) =>
					!name.startsWith("ONEGIT_") &&
					!name.startsWith("CLOUDFLARE_") &&
					!name.startsWith("ALCHEMY_")
			)
		);

		outputsTouched = true;
		const child = Bun.spawn(
			[
				process.execPath,
				"run",
				"release:macos",
				"--",
				"--version",
				"0.0.2",
				"--dry-run",
				"--stage",
				stage,
				"--profile",
				"missing-profile-must-not-be-read",
			],
			{
				cwd: resolve(appDirectory, "../.."),
				env: {
					...env,
					ONEGIT_UPDATE_FEED_URL: "https://ignored.example.com/appcast.xml",
					ONEGIT_UPDATE_PUBLIC_KEY: publicKey
						.export({ type: "spki", format: "der" })
						.subarray(-32)
						.toString("base64"),
					ONEGIT_UPDATE_KEY_FILE: keyFile,
					ONEGIT_R2_ACCOUNT_ID: "invalid",
					ONEGIT_R2_SECRET_ACCESS_KEY: fakeSecret,
					ALCHEMY_HOME: resolve(directory, "missing-alchemy-home"),
				},
				stdout: "pipe",
				stderr: "pipe",
			}
		);

		const stdout = new Response(child.stdout).text();
		const stderr = new Response(child.stderr).text();
		const result = await child.exited;

		if (result !== 0) throw new Error(`${await stdout}\n${await stderr}`);

		expect(await stdout).toContain("Dry-run complete for 0.0.2. No R2 access");
		expect(
			await Bun.file(
				resolve(appDirectory, "build/macos/1git.app/Contents/Info.plist")
			).text()
		).toContain("<key>CFBundleVersion</key><string>0.0.2</string>");
		expect(
			await Bun.file(
				resolve(appDirectory, "build/macos/1git.app/Contents/Info.plist")
			).text()
		).toContain("https://updates.example.com/appcast.xml");
		expect(existsSync(resolve(directory, "missing-alchemy-home"))).toBe(false);
		expect(
			await Bun.file(
				resolve(appDirectory, "build/macos/1git.app/Contents/Resources/app.js")
			).text()
		).not.toContain(fakeSecret);
		const releases = await readdir(resolve(appDirectory, "build/updates"));

		const release = releases.find(
			(name) => name.startsWith("0.0.2-") && !initialReleases.has(name)
		);

		if (!release) throw new Error("Missing isolated release directory.");

		const artifacts = resolve(appDirectory, "build/updates", release);

		expect(
			await Bun.file(resolve(artifacts, "1git-0.0.2-macos-arm64.zip")).exists()
		).toBe(true);
		expect(await Bun.file(resolve(artifacts, "appcast.xml")).text()).toContain(
			"sparkle:edSignature"
		);
		expect(await Bun.file(resolve(appDirectory, "package.json")).text()).toBe(
			manifest
		);
	} finally {
		await rm(stateDirectory, { recursive: true, force: true });

		// Restore only the generated output directories backed up by this test.
		for (const name of outputsTouched ? outputs : []) {
			const output = resolve(appDirectory, "build", name);

			await rm(output, { recursive: true, force: true });

			if (previous.has(name)) await rename(resolve(directory, name), output);
		}

		await rm(directory, { recursive: true, force: true });
	}
}, 90000);
