/**
 * Covers: Sparkle install-on-quit/relaunch, stable signing migration, close veto, and tampered archives.
 * Real: production bridge/framework, signed local HTTP feeds, macOS installer.
 * Doubles: small Cocoa host instead of GPUI; temporary keys, no R2 or user accounts.
 * Requires: Apple Silicon macOS, packaged app, Xcode; root test:updates:macos.
 */
import { expect, it } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import { appDirectory } from "../../native/config";
import { sparkleDirectory } from "../../native/sparkle";
import { MacSigning } from "../../native/macos-signing";

for (const mode of [
	"quit",
	"restart",
	"tamper",
	"migration",
	"stable",
] as const) {
	it(`handles ${mode} with a temporary update key`, async () => {
		if (process.platform !== "darwin" || process.arch !== "arm64")
			throw new Error("Requires Apple Silicon macOS.");

		const directory = await mkdtemp(resolve(tmpdir(), "1git-sparkle-test-"));
		const identifier = `dev.1git.updatertest.${crypto.randomUUID()}`;
		const oldApp = resolve(directory, "installed/1git.app");
		const newApp = resolve(directory, "update/1git.app");
		const { privateKey, publicKey } = generateKeyPairSync("ed25519");
		const keyFile = resolve(directory, "test-key");

		await writeFile(
			keyFile,
			privateKey
				.export({ type: "pkcs8", format: "der" })
				.subarray(-32)
				.toString("base64"),
			{ mode: 0o600 }
		);
		const publicEDKey = publicKey
			.export({ type: "spki", format: "der" })
			.subarray(-32)
			.toString("base64");

		const run = async (args: string[]): Promise<string> => {
			const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
			const output = new Response(child.stdout).text();
			const errors = new Response(child.stderr).text();

			if ((await child.exited) !== 0)
				throw new Error(`${args[0]}: ${await errors}`);

			return await output;
		};

		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(request) {
				const path = new URL(request.url).pathname;

				if (path === "/appcast.xml")
					return new Response(Bun.file(resolve(directory, "appcast.xml")), {
						headers: { "Content-Type": "application/xml" },
					});

				if (path === "/update.zip")
					return new Response(Bun.file(resolve(directory, "update.zip")));

				return new Response(null, { status: 404 });
			},
		});

		const origin = `http://127.0.0.1:${server.port}`;

		const signing =
			mode === "quit" || mode === "restart"
				? new MacSigning(null)
				: await MacSigning.load({}, true);

		let child: ReturnType<typeof Bun.spawn> | undefined;

		try {
			for (const [app, version] of [
				[oldApp, "0.0.1"],
				[newApp, "0.0.2"],
			]) {
				if (!app || !version) throw new Error("Missing test bundle.");

				const contents = resolve(app, "Contents");

				await mkdir(resolve(contents, "MacOS"), { recursive: true });
				await mkdir(resolve(contents, "Resources"));
				await cp(
					resolve(appDirectory, "build/macos/1git.app/Contents/Frameworks"),
					resolve(contents, "Frameworks"),
					{ recursive: true, verbatimSymlinks: true }
				);
				// Only the actual production updater/framework are needed in this isolated host.
				await rm(resolve(contents, "Frameworks/gpuix-native.node"));
				await writeFile(
					resolve(contents, "Info.plist"),
					`<?xml version="1.0"?><plist version="1.0"><dict>
          <key>CFBundleExecutable</key><string>1git</string><key>CFBundleIdentifier</key><string>${identifier}</string>
          <key>CFBundleName</key><string>1git updater test</string><key>CFBundlePackageType</key><string>APPL</string>
          <key>CFBundleVersion</key><string>${version}</string><key>CFBundleShortVersionString</key><string>${version}</string>
          <key>LSMinimumSystemVersion</key><string>13.0</string><key>NSPrincipalClass</key><string>NSApplication</string>
          <key>SUFeedURL</key><string>${origin}/appcast.xml</string><key>SUPublicEDKey</key><string>${publicEDKey}</string>
          <key>SUEnableAutomaticChecks</key><true/><key>SUAutomaticallyUpdate</key><true/>
          <key>SUVerifyUpdateBeforeExtraction</key><true/><key>SURequireSignedFeed</key><true/>
          <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
          <key>OneGitTestOutput</key><string>${directory}</string><key>OneGitTestMode</key><string>${mode}</string>
          </dict></plist>`
				);
				await run([
					"xcrun",
					"clang",
					"-fobjc-arc",
					"-arch",
					"arm64",
					"-mmacosx-version-min=13.0",
					"-framework",
					"Cocoa",
					resolve(contents, "Frameworks/1git-updater.dylib"),
					"-Wl,-rpath,@executable_path/../Frameworks",
					resolve(appDirectory, "tests/_shared/updater-probe.m"),
					"-o",
					resolve(contents, "MacOS/1git"),
				]);
				const signer =
					mode === "migration" && version === "0.0.1"
						? new MacSigning(null)
						: signing;

				// Copied Developer ID helpers must match this disposable host's signer.
				// Otherwise XPC rejects the fixture before it can test installation.
				const framework = resolve(contents, "Frameworks/Sparkle.framework");

				for (const path of [
					"Versions/B/XPCServices/Downloader.xpc",
					"Versions/B/XPCServices/Installer.xpc",
					"Versions/B/Updater.app",
					"Versions/B/Autoupdate",
					"",
				])
					await signer.sign(
						resolve(framework, path),
						async (args) => {
							await run(args);
						},
						{
							preserveEntitlements:
								path === "Versions/B/XPCServices/Downloader.xpc",
						}
					);

				await signer.sign(
					resolve(contents, "Frameworks/1git-updater.dylib"),
					async (args) => {
						await run(args);
					}
				);
				await signer.sign(app, async (args) => {
					await run(args);
				});
				await run(["codesign", "--verify", "--deep", "--strict", app]);
			}

			const archive = resolve(directory, "update.zip");

			await run([
				"ditto",
				"-c",
				"-k",
				"--sequesterRsrc",
				"--keepParent",
				newApp,
				archive,
			]);
			const signature = (
				await run([
					resolve(sparkleDirectory, "bin/sign_update"),
					"--ed-key-file",
					keyFile,
					"-p",
					archive,
				])
			).trim();

			const length = Bun.file(archive).size;

			await writeFile(
				resolve(directory, "appcast.xml"),
				`<?xml version="1.0"?><rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>Local regression</title><item><title>0.0.2</title><sparkle:version>0.0.2</sparkle:version><sparkle:minimumSystemVersion>13.0</sparkle:minimumSystemVersion><enclosure url="${origin}/update.zip" length="${length}" type="application/octet-stream" sparkle:edSignature="${signature}"/></item></channel></rss>`
			);
			await run([
				resolve(sparkleDirectory, "bin/sign_update"),
				"--ed-key-file",
				keyFile,
				resolve(directory, "appcast.xml"),
			]);

			if (mode === "tamper") {
				const bytes = await readFile(archive);

				bytes[100] = (bytes[100] ?? 0) ^ 1;
				await writeFile(archive, bytes);
			}

			child = Bun.spawn([resolve(oldApp, "Contents/MacOS/1git")], {
				stdout: "ignore",
				stderr: Bun.file(resolve(directory, "stderr.log")),
			});
			const deadline = Date.now() + 55000;
			let installed = false;
			let status = "";

			while (Date.now() < deadline) {
				if (await Bun.file(resolve(directory, "status")).exists())
					status = await Bun.file(resolve(directory, "status")).text();

				const plist = await readFile(
					resolve(oldApp, "Contents/Info.plist"),
					"utf8"
				);

				installed = plist.includes("<string>0.0.2</string>");

				if (
					(mode === "tamper" && status.startsWith("error:")) ||
					(mode !== "tamper" && mode !== "restart" && installed) ||
					(mode === "restart" &&
						installed &&
						(await Bun.file(resolve(directory, "launched-version")).text()) ===
							"0.0.2")
				)
					break;

				await Bun.sleep(100);
			}

			if (mode === "tamper") {
				expect(status).toStartWith("error:");
				expect(installed).toBe(false);
				expect(await Bun.file(resolve(directory, "draft")).text()).toBe(
					"saved"
				);
			} else {
				expect(status).toBe("ready");
				expect(installed).toBe(true);
				expect(await Bun.file(resolve(directory, "veto")).text()).toBe(
					"protected"
				);
				expect(await Bun.file(resolve(directory, "draft")).text()).toBe(
					"saved"
				);
				await run(["codesign", "--verify", "--deep", "--strict", oldApp]);

				if (mode === "restart")
					expect(
						await Bun.file(resolve(directory, "launched-version")).text()
					).toBe("0.0.2");
			}
		} finally {
			child?.kill();

			if (child) await child.exited;

			server.stop(true);
			// Isolated per-test defaults; never the real app's preferences or signing key.
			await run(["defaults", "delete", identifier]).catch(() => undefined);
			await rm(resolve(homedir(), "Library/Caches", identifier), {
				recursive: true,
				force: true,
			});
			await rm(directory, { recursive: true, force: true });
		}
	}, 90000);
}
