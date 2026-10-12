import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
	appDirectory,
	accountsPatchPath,
	accountsPlatformPatchPath,
	activationPatchPath,
	closePatchPath,
	closePlatformPatchPath,
	contextMenuPatchPath,
	contextMenuPlatformPatchPath,
	contextMenuItemsPatchPath,
	contextMenuItemsPlatformPatchPath,
	contextMenuOwnerPatchPath,
	contextMenuOwnerPlatformPatchPath,
	contextMenuIconsPatchPath,
	contextMenuIconsPlatformPatchPath,
	checkboxPatchPath,
	diffPatchPath,
	diffContextPatchPath,
	diffSplitPatchPath,
	diffSplitLayoutPatchPath,
	diffInclusionPatchPath,
	diffSyntaxPatchPath,
	diffInclusionThemePatchPath,
	diffRailsPatchPath,
	textareaViewportPatchPath,
	buildIdPath,
	nativeBuildId,
	nativeDirectory,
	nativeLibrary,
	nativeRevision,
	patchPath,
	testSessionPatchPath,
	testSessionPlatformPatchPath,
	liveFramePlatformPatchPath,
	elementBoundsPatchPath,
	anchoredCenterPatchPath,
	sidebarVibrancyPlatformPatchPath,
	roundedOverflowPlatformPatchPath,
	windowAppearancePatchPath,
	windowAppearancePlatformPatchPath,
} from "./config";

if (process.platform !== "darwin" || process.arch !== "arm64") {
	throw new Error(
		"The local GPUIX build currently supports Apple Silicon macOS only."
	);
}

const source = resolve(appDirectory, ".cache/native-source");

const run = async (cmd: string[], cwd = source): Promise<void> => {
	const child = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });

	if ((await child.exited) !== 0)
		throw new Error(`Native build failed: ${cmd.join(" ")}`);
};

if (
	existsSync(nativeLibrary) &&
	existsSync(buildIdPath) &&
	(await readFile(buildIdPath, "utf8")) === nativeBuildId
) {
	process.stdout.write("Local GPUIX native build is up to date.\n");
} else {
	await mkdir(nativeDirectory, { recursive: true });

	if (!existsSync(source)) {
		await run(
			[
				"git",
				"clone",
				"--filter=blob:none",
				"--no-checkout",
				"https://github.com/remorses/gpuix.git",
				source,
			],
			appDirectory
		);
		await run(["git", "checkout", "--detach", nativeRevision]);
	}

	const head = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: source });
	const revision = (await new Response(head.stdout).text()).trim();

	if ((await head.exited) !== 0 || revision !== nativeRevision) {
		throw new Error(
			`Unexpected checkout at ${source}; move it aside and rebuild.`
		);
	}

	await run(["git", "submodule", "update", "--init", "--depth", "1", "zed"]);

	const patches = [
		patchPath,
		checkboxPatchPath,
		diffPatchPath,
		diffContextPatchPath,
		diffSplitPatchPath,
		diffSplitLayoutPatchPath,
		diffInclusionPatchPath,
		activationPatchPath,
		closePatchPath,
		closePlatformPatchPath,
		contextMenuPatchPath,
		contextMenuPlatformPatchPath,
		contextMenuItemsPatchPath,
		contextMenuItemsPlatformPatchPath,
		contextMenuOwnerPatchPath,
		contextMenuOwnerPlatformPatchPath,
		testSessionPatchPath,
		testSessionPlatformPatchPath,
		liveFramePlatformPatchPath,
		elementBoundsPatchPath,
		anchoredCenterPatchPath,
		accountsPatchPath,
		accountsPlatformPatchPath,
		sidebarVibrancyPlatformPatchPath,
		contextMenuIconsPatchPath,
		contextMenuIconsPlatformPatchPath,
		roundedOverflowPlatformPatchPath,
		windowAppearancePatchPath,
		windowAppearancePlatformPatchPath,
		diffSyntaxPatchPath,
		diffInclusionThemePatchPath,
		diffRailsPatchPath,
		textareaViewportPatchPath,
	];

	// Later patches can change an earlier patch's context. Unwind known patches
	// in reverse order before applying the pinned stack, preserving unrelated edits.
	for (const patch of patches.toReversed()) {
		const patchDirectory =
			patch === closePlatformPatchPath ||
			patch === contextMenuPlatformPatchPath ||
			patch === contextMenuItemsPlatformPatchPath ||
			patch === contextMenuOwnerPlatformPatchPath ||
			patch === testSessionPlatformPatchPath ||
			patch === liveFramePlatformPatchPath ||
			patch === accountsPlatformPatchPath ||
			patch === sidebarVibrancyPlatformPatchPath ||
			patch === contextMenuIconsPlatformPatchPath ||
			patch === roundedOverflowPlatformPatchPath ||
			patch === windowAppearancePlatformPatchPath
				? resolve(source, "zed")
				: source;

		const applied = Bun.spawn(["git", "apply", "--reverse", "--check", patch], {
			cwd: patchDirectory,
			stdout: "ignore",
			stderr: "ignore",
		});

		if ((await applied.exited) === 0)
			await run(["git", "apply", "--reverse", patch], patchDirectory);
	}

	for (const patch of patches) {
		const patchDirectory =
			patch === closePlatformPatchPath ||
			patch === contextMenuPlatformPatchPath ||
			patch === contextMenuItemsPlatformPatchPath ||
			patch === contextMenuOwnerPlatformPatchPath ||
			patch === testSessionPlatformPatchPath ||
			patch === liveFramePlatformPatchPath ||
			patch === accountsPlatformPatchPath ||
			patch === sidebarVibrancyPlatformPatchPath ||
			patch === contextMenuIconsPlatformPatchPath ||
			patch === roundedOverflowPlatformPatchPath ||
			patch === windowAppearancePlatformPatchPath
				? resolve(source, "zed")
				: source;

		const patched = Bun.spawn(["git", "apply", "--reverse", "--check", patch], {
			cwd: patchDirectory,
			stdout: "ignore",
			stderr: "ignore",
		});

		if ((await patched.exited) !== 0) {
			await run(["git", "apply", "--check", patch], patchDirectory);
			await run(["git", "apply", patch], patchDirectory);
		}
	}

	// Build only the addon; keep using the matching published JS runtime and loader.
	await run(
		[
			"cargo",
			"build",
			"--release",
			"--locked",
			"--lib",
			...(process.argv.includes("--runtime-shaders")
				? ["--features", "gpui_platform/runtime_shaders"]
				: []),
			"--target-dir",
			resolve(source, "packages/native/target"),
		],
		resolve(source, "packages/native")
	);
	await copyFile(
		resolve(source, "packages/native/target/release/libgpuix_native.dylib"),
		`${nativeLibrary}.tmp`
	);
	await rename(`${nativeLibrary}.tmp`, nativeLibrary);
	await writeFile(buildIdPath, nativeBuildId);
	process.stdout.write(`Built local GPUIX addon: ${nativeLibrary}\n`);
}
