import {
	copyFile,
	mkdir,
	mkdtemp,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { appDirectory, nativeLibrary } from "./config";
import { bundleInfoPlist, copyImageRuntime } from "./package-resources";
import { version as developmentVersion } from "../package.json";
import { embedSparkle, updateConfiguration } from "./sparkle";
import { ReleaseVersion } from "./release-options";
import { MacSigning } from "./macos-signing";

if (process.platform !== "darwin" || process.arch !== "arm64") {
	throw new Error("macOS packaging currently supports Apple Silicon only.");
}

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
const sign = async (path: string): Promise<void> =>
	await signing.sign(path, run);

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

	await run([
		process.execPath,
		"build",
		"src/main.tsx",
		"--target=bun",
		"--production",
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
		resolve(
			appDirectory,
			"src/feature/repository-appearance/pattern-artwork.LICENSE"
		),
		resolve(resources, "RepositoryPatterns.LICENSE")
	);
	await copyImageRuntime(resources);
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

	// One pinned identity signs nested code before its container; never regenerate it during a build.
	const nativeImages = new Bun.Glob("node_modules/@img/**/*.{node,dylib}");

	for await (const image of nativeImages.scan({
		cwd: resources,
		absolute: true,
	})) {
		await sign(image);
	}

	await sign(addon);
	await sign(bundle);
	await run(["codesign", "--verify", "--deep", "--strict", bundle]);
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

This beta is ${signing.certificate ? "self-signed with a stable identity" : "ad-hoc signed"}, not Developer ID signed or notarized by Apple.
macOS may block the first launch. Only if you trust the source, after trying
to open the app, use System Settings > Privacy & Security > Open Anyway.
Some managed Macs do not permit this exception. Do not disable Gatekeeper.
Apple's instructions: https://support.apple.com/en-us/102445

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

	// Replace only the generated app after every build/signing step succeeds.
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
