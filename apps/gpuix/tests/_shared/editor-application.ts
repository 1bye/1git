import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Metadata-only application fixture; no executable is created or launched. */
export async function editorApplication(
	directory: string,
	name: string
): Promise<string> {
	const application = join(directory, name);

	await mkdir(join(application, "Contents"), { recursive: true });
	await writeFile(
		join(application, "Contents", "Info.plist"),
		`<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleIdentifier</key><string>dev.1git.editor-fixture</string></dict></plist>`
	);

	return await realpath(application);
}
