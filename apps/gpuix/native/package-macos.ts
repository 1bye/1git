import {
	copyFile,
	cp,
	mkdir,
	mkdtemp,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { appDirectory, nativeLibrary } from "./config";
import { bundleInfoPlist, copyImageRuntime } from "./package-resources";
import { version as developmentVersion } from "../package.json";
import { embedSparkle, updateConfiguration } from "./sparkle";
import { ReleaseVersion } from "./release-options";
import { MacSigning } from "./macos-signing";
import { remoteHelperTargets } from "../src/feature/machines/remote-protocol";
import { launcherScript } from "../src/launcher/launcher-script";

if (process.platform !== "darwin" || process.arch !== "arm64") {
	throw new Error("macOS packaging currently supports Apple Silicon only.");
}

const { values } = parseArgs({
	args: process.argv.slice(2),
	strict: true,
	allowPositionals: false,
	options: { "dry-run": { type: "boolean", default: false } },
});

const run = async (command: string[]): Promise<void> => {
	const child = Bun.spawn(command, {
		cwd: appDirectory,
		stdout: "inherit",
		stderr: "inherit",
	});

	if ((await child.exited) !== 0) {
		throw new Error(`macOS packaging failed: ${command.join(" ")}`);
	}
};

const updates = updateConfiguration(
	process.env.ONEGIT_UPDATE_FEED_URL,
	process.env.ONEGIT_UPDATE_PUBLIC_KEY
);

const version = ReleaseVersion.parse(
	process.env.ONEGIT_RELEASE_VERSION ?? developmentVersion
);

const signing = await MacSigning.load();

await signing.verify();
const sign = async (
	path: string,
	preserveEntitlements = false
): Promise<void> => await signing.sign(path, run, { preserveEntitlements });

const output = resolve(appDirectory, "build/macos");

await mkdir(output, { recursive: true });
const staging = await mkdtemp(resolve(output, ".package-"));
const release = resolve(staging, "release");
const bundle = resolve(release, "1git.app");
const contents = resolve(bundle, "Contents");
const resources = resolve(contents, "Resources");
const executable = resolve(contents, "MacOS/1git");
const addon = resolve(contents, "Frameworks/gpuix-native.node");
const destination = resolve(output, "1git.app");
const archiveName = "1git-macos-arm64.zip";
const archive = resolve(staging, archiveName);

try {
	await mkdir(resources, { recursive: true });
	await mkdir(resolve(contents, "MacOS"));
	await mkdir(resolve(contents, "Frameworks"));
	await writeFile(resolve(resources, "1git-launcher"), launcherScript, {
		mode: 0o755,
	});

	await run([
		process.execPath,
		"build",
		"src/main.tsx",
		"--target=bun",
		"--production",
		"--define",
		`process.env.ONEGIT_APP_VERSION=${JSON.stringify(version)}`,
		"--external=sharp",
		"--outfile",
		resolve(resources, "app.js"),
	]);

	await run([
		process.execPath,
		"build",
		"native/packaged-main.ts",
		"--compile",
		// The on-disk Sharp runtime needs package.json exports during resolution.
		"--compile-autoload-package-json",
		"--no-compile-autoload-dotenv",
		"--no-compile-autoload-bunfig",
		"--outfile",
		executable,
	]);
	await copyFile(nativeLibrary, addon);
	await copyFile(
		resolve(appDirectory, "../../LICENSE"),
		resolve(resources, "1git-LICENSE.txt")
	);
	await copyFile(
		resolve(appDirectory, "../../THIRD_PARTY_NOTICES.md"),
		resolve(resources, "THIRD_PARTY_NOTICES.md")
	);
	await cp(resolve(appDirectory, "LICENSES"), resolve(resources, "LICENSES"), {
		recursive: true,
	});
	await copyFile(
		resolve(
			appDirectory,
			"src/feature/repository-appearance/pattern-artwork.LICENSE"
		),
		resolve(resources, "RepositoryPatterns.LICENSE")
	);
	await copyImageRuntime(resources);
	await run([process.execPath, "run", "native/build-remote-helpers.ts"]);
	await mkdir(resolve(resources, "remote-helpers"));

	for (const target of remoteHelperTargets) {
		for (const extension of ["gz", "json"]) {
			await copyFile(
				resolve(appDirectory, `build/remote-helpers/${target}.${extension}`),
				resolve(resources, `remote-helpers/${target}.${extension}`)
			);
		}
	}

	await embedSparkle(contents, run, sign);

	// Compile the Icon Composer source, retaining modern appearances and an ICNS
	// fallback. Never rewrite the designer-owned .icon bundle or flatten its layers.
	await run([
		"xcrun",
		"actool",
		"--compile",
		resources,
		"--platform",
		"macosx",
		"--minimum-deployment-target",
		"13.0",
		"--app-icon",
		"1git",
		"--output-partial-info-plist",
		resolve(staging, "icon-info.plist"),
		"--output-format",
		"human-readable-text",
		resolve(appDirectory, "../../docs/branding/macos-icon/1git.icon"),
	]);
	await writeFile(
		resolve(contents, "Info.plist"),
		bundleInfoPlist(version, updates)
	);
	await run(["plutil", "-lint", resolve(contents, "Info.plist")]);

	// Apply the selected mode to nested code before its container; default ad-hoc signing needs no identity.
	const nativeImages = new Bun.Glob("node_modules/@img/**/*.{node,dylib}");

	for await (const image of nativeImages.scan({
		cwd: resources,
		absolute: true,
	})) {
		await sign(image);
	}

	await sign(addon);
	await signing.sign(bundle, run, {
		entitlements: resolve(import.meta.dir, "macos.entitlements"),
	});
	await run(["codesign", "--verify", "--deep", "--strict", bundle]);

	if (!values["dry-run"])
		await signing.notarize(bundle, resolve(staging, "notarization.zip"));

	const gatekeeperInformation = `macOS may block the first launch. Only if you trust the source, after trying
to open the app, use System Settings > Privacy & Security > Open Anyway.
Some managed Macs do not permit this exception. Do not disable Gatekeeper.
Apple's instructions: https://support.apple.com/en-us/102445`;

	let securityInformation = `This beta is ${signing.certificate ? "self-signed with a stable identity" : "ad-hoc signed"}, not Developer ID signed or notarized by Apple.
${gatekeeperInformation}`;

	if (signing.developerID) {
		securityInformation = `This app is Developer ID signed but has not been notarized by Apple.
${gatekeeperInformation}`;

		if (signing.developerID.notaryProfile)
			securityInformation =
				"This app is Developer ID signed and notarized by Apple, with a stapled ticket.";

		if (values["dry-run"])
			securityInformation =
				"This local dry-run is Developer ID signed but NOT notarized. Do not distribute it.";
	}

	await writeFile(
		resolve(release, "README.txt"),
		`1git ${version} - Apple Silicon beta

Requirements: Apple Silicon Mac, macOS 13 or later, and Git available.
Apple's Command Line Tools provide Git. Bun, Rust and full Xcode are not
needed to run this app.

Install:
1. Extract this ZIP.
2. Move 1git.app into Applications.
3. Open 1git.app.

${securityInformation}

Accounts and preferences are stored separately on your Mac, not in this ZIP.
AI providers receive checked changes only when you choose to generate a message.
`
	);
	await run(["ditto", "-c", "-k", "--sequesterRsrc", release, archive]);
	const hash = createHash("sha256");

	for await (const chunk of Bun.file(archive).stream()) hash.update(chunk);

	await writeFile(
		resolve(staging, `${archiveName}.sha256`),
		`${hash.digest("hex")}  ${archiveName}\n`
	);

	// Replace generated outputs only after signing, notarization (when enabled), and archiving succeed.
	await rm(destination, { recursive: true, force: true });
	await rename(bundle, destination);
	await rename(archive, resolve(output, archiveName));
	await rename(
		resolve(staging, `${archiveName}.sha256`),
		resolve(output, `${archiveName}.sha256`)
	);
	process.stdout.write(
		`Built ${destination}\nShare ${resolve(output, archiveName)}\n`
	);
} finally {
	await rm(staging, { recursive: true, force: true });
}
