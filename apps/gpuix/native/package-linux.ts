import {
	chmod,
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
import { appDirectory, nativeLibrary } from "./config";
import { copyImageRuntimeLinux } from "./package-resources";
import { version as developmentVersion } from "../package.json";
import { ReleaseVersion } from "./release-options";
import { remoteHelperTargets } from "../src/feature/machines/remote-protocol";

/**
 * Linux packaging: a self-contained tarball, not a .deb or AppImage yet.
 * Layout mirrors the macOS bundle's relative paths so packaged-main.ts
 * works unchanged: the compiled executable lives in bin/, the native
 * addon in Frameworks/, and the JS app plus remote helpers in Resources/.
 * No signing or Sparkle updater: on Linux there is no Sparkle, and
 * AppUpdater.start() already no-ops off macOS.
 *
 * Build the tarball on Ubuntu 20.04 (or in a 20.04 container) to keep
 * glibc 2.31 as the ceiling. A binary built on Ubuntu 24.04 (glibc 2.39)
 * will not run on 20.04.
 */
if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch)) {
	throw new Error("Linux packaging currently supports Linux x64/arm64 only.");
}

const arch = process.arch === "x64" ? "x64" : "arm64";

const run = async (command: string[]): Promise<void> => {
	const child = Bun.spawn(command, {
		cwd: appDirectory,
		stdout: "inherit",
		stderr: "inherit",
	});

	if ((await child.exited) !== 0)
		throw new Error(`Linux packaging failed: ${command.join(" ")}`);
};

const version = ReleaseVersion.parse(
	process.env.ONEGIT_RELEASE_VERSION ?? developmentVersion
);

const output = resolve(appDirectory, "build/linux");

await mkdir(output, { recursive: true });
const staging = await mkdtemp(resolve(output, ".package-"));
const root = resolve(staging, "1git");
const resources = resolve(root, "Resources");
const executable = resolve(root, "bin/1git");
const addon = resolve(root, "Frameworks/gpuix-native.node");
const archiveName = `1git-linux-${arch}.tar.gz`;
const archive = resolve(staging, archiveName);

try {
	await mkdir(resources, { recursive: true });
	await mkdir(resolve(root, "bin"));
	await mkdir(resolve(root, "Frameworks"));

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
		"--compile-autoload-package-json",
		"--no-compile-autoload-dotenv",
		"--no-compile-autoload-bunfig",
		"--outfile",
		executable,
	]);
	await chmod(executable, 0o755);
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
	await copyImageRuntimeLinux(resources, arch);
	// Linux tarball ships Linux remote helpers only: the darwin helpers
	// cannot be cross-built from Linux (no Apple SDK/linker here). A
	// Linux client can therefore deploy helpers to Linux remotes only
	// in this build; macOS remotes need the macOS build's helpers.
	const linuxHelperTargets = remoteHelperTargets.filter((target) =>
		target.startsWith("linux-")
	);

	await run([
		process.execPath,
		"run",
		"native/build-remote-helpers.ts",
		...linuxHelperTargets,
	]);
	await mkdir(resolve(resources, "remote-helpers"));

	for (const target of linuxHelperTargets) {
		for (const extension of ["gz", "json"]) {
			await copyFile(
				resolve(appDirectory, `build/remote-helpers/${target}.${extension}`),
				resolve(resources, `remote-helpers/${target}.${extension}`)
			);
		}
	}

	await writeFile(
		resolve(root, "1git.desktop"),
		`[Desktop Entry]
Type=Application
Name=1git
Comment=A native Git workspace
Exec=1git
Icon=1git
Categories=Development;RevisionControl;
Terminal=false
`
	);
	await writeFile(
		resolve(root, "README.txt"),
		`1git ${version} - Linux beta

Requirements: a Wayland or X11 session, Git, and xdg-utils. For SSH
host prompts, install zenity. For clipboard, install wl-clipboard
(Wayland) or xclip (X11). Bun, Rust and Xcode are not needed to
run this app.

glibc floor: this development build was made on Ubuntu 24.04 and
needs glibc 2.39 or newer, so it runs on Ubuntu 24.04+ but NOT on
20.04. A 20.04-compatible build must be built on Ubuntu 20.04
itself (see LINUX-PORT.md); that is still pending.

Install:
1. Extract this archive, e.g. to /opt/1git.
2. Run /opt/1git/bin/1git, or symlink it into /usr/local/bin/1git.
3. Optional: copy 1git.desktop to ~/.local/share/applications/ and
   set Exec to the full path of bin/1git.

No auto-updater is included in this Linux build. Accounts and
preferences are stored separately on your machine, not in this archive.
AI providers receive checked changes only when you choose to generate
a message.
`
	);

	await run(["tar", "-czf", archive, "-C", staging, "1git"]);
	const hash = createHash("sha256");

	for await (const chunk of Bun.file(archive).stream()) hash.update(chunk);

	await writeFile(
		resolve(staging, `${archiveName}.sha256`),
		`${hash.digest("hex")}  ${archiveName}\n`
	);

	await rm(resolve(output, "1git"), { recursive: true, force: true });
	await rename(root, resolve(output, "1git"));
	await rename(archive, resolve(output, archiveName));
	await rename(
		resolve(staging, `${archiveName}.sha256`),
		resolve(output, `${archiveName}.sha256`)
	);
	process.stdout.write(
		`Built ${resolve(output, "1git")}\nShare ${resolve(output, archiveName)}\n`
	);
} finally {
	await rm(staging, { recursive: true, force: true });
}
