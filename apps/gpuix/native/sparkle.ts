import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { appDirectory } from "./config";

/** Pinned upstream distribution, including its installer and signing tools. */
export const sparkleDirectory = resolve(appDirectory, ".cache/sparkle");

/** The same Keychain identity is used for public-key lookup and release signing. */
export const sparkleSigningAccount = "dev.1git.gpuix";
const sparkleVersion = "2.10.0";

const archiveHash =
	"c2bf58aa8387266ac179357b1415d6f2635f044da8be41042af32425dae6da0c";

/** Downloads only the verified public framework; never provisions or publishes. */
export async function prepareSparkle(): Promise<void> {
	const archive = resolve(sparkleDirectory, `Sparkle-${sparkleVersion}.tar.xz`);

	await mkdir(sparkleDirectory, { recursive: true });

	if (!(await Bun.file(archive).exists())) {
		const response = await fetch(
			`https://github.com/sparkle-project/Sparkle/releases/download/${sparkleVersion}/Sparkle-${sparkleVersion}.tar.xz`
		);

		if (!response.ok)
			throw new Error(`Sparkle download failed (${response.status}).`);

		const temporary = `${archive}.download`;

		await Bun.write(temporary, response);
		await rename(temporary, archive);
	}

	const hash = createHash("sha256");

	for await (const bytes of Bun.file(archive).stream()) hash.update(bytes);

	if (hash.digest("hex") !== archiveHash)
		throw new Error(
			"Sparkle archive checksum mismatch; refusing to load native code."
		);

	if (
		!(await Bun.file(
			resolve(sparkleDirectory, "Sparkle.framework/Versions/B/Sparkle")
		).exists())
	) {
		const child = Bun.spawn(
			[
				"tar",
				"-xf",
				archive,
				"-C",
				sparkleDirectory,
				"./Sparkle.framework",
				"./bin",
				"./LICENSE",
			],
			{ stdout: "inherit", stderr: "inherit" }
		);

		if ((await child.exited) !== 0)
			throw new Error("Could not extract Sparkle.");
	}
}

/** Embeds a self-contained framework and a main-thread AppKit bridge. */
export async function embedSparkle(
	contents: string,
	run: (command: string[]) => Promise<void>,
	sign: (path: string) => Promise<void>
): Promise<void> {
	await prepareSparkle();
	const frameworks = resolve(contents, "Frameworks");
	const framework = resolve(frameworks, "Sparkle.framework");

	await cp(resolve(sparkleDirectory, "Sparkle.framework"), framework, {
		recursive: true,
		dereference: false,
		verbatimSymlinks: true,
	});
	await copyFile(
		resolve(sparkleDirectory, "LICENSE"),
		resolve(contents, "Resources/Sparkle-LICENSE.txt")
	);
	await run([
		"xcrun",
		"clang",
		"-dynamiclib",
		"-fobjc-arc",
		"-arch",
		"arm64",
		"-mmacosx-version-min=13.0",
		"-F",
		sparkleDirectory,
		"-framework",
		"Cocoa",
		"-framework",
		"Sparkle",
		"-Wl,-rpath,@loader_path",
		"-Wl,-install_name,@rpath/1git-updater.dylib",
		resolve(appDirectory, "native/updater.m"),
		"-o",
		resolve(frameworks, "1git-updater.dylib"),
	]);

	// Sparkle's nested helpers must be signed before the outer framework and app.
	for (const path of [
		"Versions/B/XPCServices/Downloader.xpc",
		"Versions/B/XPCServices/Installer.xpc",
		"Versions/B/Updater.app",
		"Versions/B/Autoupdate",
		"",
	])
		await sign(resolve(framework, path));

	await sign(resolve(frameworks, "1git-updater.dylib"));
}

/** HTTPS feed + public Ed25519 key baked into the signed app, never credentials. */
export interface UpdateConfiguration {
	feedURL: string;
	publicKey: string;
}

/** Read-only lookup: -p never generates, imports, rotates, or exports a private key. */
const existingSparklePublicKey = async (): Promise<string> => {
	await prepareSparkle();

	try {
		const child = Bun.spawn(
			[
				resolve(sparkleDirectory, "bin/generate_keys"),
				"--account",
				sparkleSigningAccount,
				"-p",
			],
			{ stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 30000 }
		);

		const [output, , exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);

		if (exitCode !== 0) throw new Error("Sparkle Keychain lookup failed.");

		return output.trim();
	} catch (cause) {
		throw new Error(
			`Could not read the existing Sparkle public key from Keychain (${sparkleSigningAccount}). Unlock/allow Keychain access, or create the key once with apps/gpuix/.cache/sparkle/bin/generate_keys --account ${sparkleSigningAccount}. No key was created or changed.`,
			{ cause }
		);
	}
};

/** Release-only fallback; ordinary packaging remains unconfigured by default. */
export async function releaseUpdateConfiguration(
	feedURL: string,
	env: NodeJS.ProcessEnv,
	readExistingKey: () => Promise<string> = existingSparklePublicKey
): Promise<UpdateConfiguration> {
	let publicKey = env.ONEGIT_UPDATE_PUBLIC_KEY;

	if (publicKey === undefined) {
		if (env.ONEGIT_UPDATE_KEY_FILE)
			throw new Error(
				"Provide ONEGIT_UPDATE_PUBLIC_KEY when using ONEGIT_UPDATE_KEY_FILE; Keychain fallback is disabled for file-based signing."
			);

		publicKey = (await readExistingKey()).trim();
	}

	if (!publicKey)
		throw new Error(
			"The release public key is empty. Set ONEGIT_UPDATE_PUBLIC_KEY to a valid public key, or unset it to use Keychain."
		);

	const configuration = updateConfiguration(feedURL, publicKey);

	if (!configuration)
		throw new Error("Release requires a configured update feed.");

	return configuration;
}

/** Missing configuration deliberately leaves all network update checks disabled. */
export function updateConfiguration(
	feedURL?: string,
	publicKey?: string
): UpdateConfiguration | undefined {
	if (!feedURL && !publicKey) return undefined;

	if (!feedURL || !publicKey)
		throw new Error(
			"Provide both ONEGIT_UPDATE_FEED_URL and ONEGIT_UPDATE_PUBLIC_KEY."
		);

	const url = new URL(feedURL);

	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		throw new Error(
			"The update feed must be an HTTPS URL without credentials, query, or fragment."
		);

	if (
		!/^[A-Za-z0-9+/]{43}=$/u.test(publicKey) ||
		Buffer.from(publicKey, "base64").length !== 32
	)
		throw new Error(
			"The update public key must be a base64 Ed25519 public key."
		);

	return { feedURL: url.href, publicKey };
}
