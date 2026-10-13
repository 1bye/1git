import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { UpdateConfiguration } from "./sparkle";

const require = createRequire(import.meta.url);
const sharpRequire = createRequire(require.resolve("sharp"));

// Sharp is external to the JS bundle: its addon resolves libvips relative to its
// installed package. Keep the pinned Apple Silicon runtime and its JS dependencies.
const imagePackages = [
	"sharp",
	"@img/sharp-darwin-arm64",
	"@img/sharp-libvips-darwin-arm64",
	"@img/colour",
	"detect-libc",
	"semver",
] as const;

export const copyImageRuntime = async (resources: string): Promise<void> => {
	for (const name of imagePackages) {
		const manifest = sharpRequire.resolve(`${name}/package.json`);
		const destination = resolve(resources, "node_modules", name);

		await mkdir(dirname(destination), { recursive: true });
		await cp(dirname(manifest), destination, {
			recursive: true,
			dereference: true,
		});
	}
};

export const bundleInfoPlist = (
	version: string,
	updates?: UpdateConfiguration
): string => {
	if (!/^\d+\.\d+\.\d+$/u.test(version)) {
		throw new Error(
			"macOS packaging requires a numeric major.minor.patch version."
		);
	}

	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key><string>1git</string>
	<key>CFBundleIdentifier</key><string>dev.1git.gpuix</string>
	<key>CFBundleName</key><string>1git</string>
	<key>CFBundleDisplayName</key><string>1git</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>${version}</string>
	<key>CFBundleVersion</key><string>${version}</string>
	<key>CFBundleIconName</key><string>1git</string>
	<key>CFBundleIconFile</key><string>1git.icns</string>
	<key>LSMinimumSystemVersion</key><string>13.0</string>
	<key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
	<key>NSHighResolutionCapable</key><true/>
	<key>NSPrincipalClass</key><string>NSApplication</string>
${
	updates
		? `\t<key>SUFeedURL</key><string>${updates.feedURL.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</string>
\t<key>SUPublicEDKey</key><string>${updates.publicKey}</string>
\t<key>SUEnableAutomaticChecks</key><true/>
\t<key>SUAutomaticallyUpdate</key><false/>
\t<key>SUVerifyUpdateBeforeExtraction</key><true/>
\t<key>SURequireSignedFeed</key><true/>
\t<key>SUEnableSystemProfiling</key><false/>
`
		: ""
}
</dict>
</plist>
`;
};
