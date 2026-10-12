import {
	copyFile,
	mkdir,
	mkdtemp,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { appDirectory, nativeLibrary } from "./config";
import { bundleInfoPlist, copyImageRuntime } from "./package-resources";
import { version } from "../package.json";

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

const output = resolve(appDirectory, "build/macos");

await mkdir(output, { recursive: true });
const staging = await mkdtemp(resolve(output, ".package-"));
const bundle = resolve(staging, "1git.app");
const contents = resolve(bundle, "Contents");
const resources = resolve(contents, "Resources");
const executable = resolve(contents, "MacOS/1git");
const addon = resolve(contents, "Frameworks/gpuix-native.node");
const destination = resolve(output, "1git.app");

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
	await copyImageRuntime(resources);

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
	await writeFile(resolve(contents, "Info.plist"), bundleInfoPlist(version));
	await run(["plutil", "-lint", resolve(contents, "Info.plist")]);

	// Sign nested native code before the containing bundle. This is a local ad-hoc
	// signature; distributing publicly still needs Developer ID and notarization.
	const nativeImages = new Bun.Glob("node_modules/@img/**/*.{node,dylib}");

	for await (const image of nativeImages.scan({
		cwd: resources,
		absolute: true,
	})) {
		await run(["codesign", "--force", "--sign", "-", image]);
	}

	await run(["codesign", "--force", "--sign", "-", addon]);
	await run(["codesign", "--force", "--sign", "-", bundle]);
	await run(["codesign", "--verify", "--deep", "--strict", bundle]);

	// Replace only the generated app after every build/signing step succeeds.
	await rm(destination, { recursive: true, force: true });
	await rename(bundle, destination);
	process.stdout.write(`Built ${destination}\n`);
} finally {
	await rm(staging, { recursive: true, force: true });
}
