import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { createPublicKey, verify } from "node:crypto";
import { basename, resolve } from "node:path";
import { appDirectory } from "./config";
import {
	prepareSparkle,
	sparkleDirectory,
	sparkleSigningAccount,
	updateConfiguration,
} from "./sparkle";

// Local release preparation only: R2/Alchemy publishing is deliberately separate.
const run = async (args: string[]): Promise<string> => {
	const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
	const output = new Response(child.stdout).text();
	const errors = new Response(child.stderr).text();

	if ((await child.exited) !== 0)
		throw new Error(`${args[0]} failed: ${await errors}`);

	return await output;
};

/** Builds and signs local artifacts, refusing a key that cannot update this app. */
export async function prepareUpdates(
	bundle: string,
	output: string,
	keyFile?: string
): Promise<PreparedUpdate> {
	await prepareSparkle();
	const plist = resolve(bundle, "Contents/Info.plist");

	const property = async (name: string): Promise<string> =>
		(await run(["plutil", "-extract", name, "raw", "-o", "-", plist])).trim();

	const publicKey = await property("SUPublicEDKey");

	const configuration = updateConfiguration(
		await property("SUFeedURL"),
		publicKey
	);

	if (!configuration)
		throw new Error("Release preparation requires a configured update feed.");

	const feedURL = new URL(configuration.feedURL);
	const version = await property("CFBundleVersion");

	if (!/^\d+\.\d+\.\d+$/u.test(version))
		throw new Error(
			"Release preparation requires a numeric major.minor.patch version."
		);

	await mkdir(output, { recursive: true });
	const staging = await mkdtemp(resolve(output, ".prepare-"));
	const archiveName = `1git-${version}-macos-arm64.zip`;
	const archive = resolve(staging, archiveName);

	const signing = keyFile
		? ["--ed-key-file", keyFile]
		: ["--account", sparkleSigningAccount];

	try {
		await run(["codesign", "--verify", "--deep", "--strict", bundle]);
		await run([
			"ditto",
			"-c",
			"-k",
			"--sequesterRsrc",
			"--keepParent",
			bundle,
			archive,
		]);
		const signature = (
			await run([
				resolve(sparkleDirectory, "bin/sign_update"),
				...signing,
				"-p",
				archive,
			])
		).trim();

		const key = createPublicKey({
			key: Buffer.concat([
				Buffer.from("302a300506032b6570032100", "hex"),
				Buffer.from(publicKey, "base64"),
			]),
			format: "der",
			type: "spki",
		});

		if (
			!verify(
				null,
				await readFile(archive),
				key,
				Buffer.from(signature, "base64")
			)
		)
			throw new Error(
				"Signing key does not match the public key embedded in the app."
			);

		const feedName = basename(feedURL.pathname);

		if (!feedName.endsWith(".xml")) throw new Error("Use an .xml appcast URL.");

		await run([
			resolve(sparkleDirectory, "bin/generate_appcast"),
			...signing,
			"--maximum-deltas",
			"0",
			"--download-url-prefix",
			new URL("./", feedURL).href,
			"-o",
			resolve(staging, feedName),
			staging,
		]);
		await rename(archive, resolve(output, archiveName));
		await rename(resolve(staging, feedName), resolve(output, feedName));
		process.stdout.write(
			`Prepared signed update and feed in ${output}. Nothing uploaded.\n`
		);

		return {
			version,
			archivePath: resolve(output, archiveName),
			feedPath: resolve(output, feedName),
			feedURL: configuration.feedURL,
			publicKey,
		};
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

/** Signed local artifacts and the public configuration embedded in their app. */
export interface PreparedUpdate {
	version: string;
	archivePath: string;
	feedPath: string;
	feedURL: string;
	publicKey: string;
}

if (import.meta.main) {
	await prepareUpdates(
		resolve(appDirectory, "build/macos/1git.app"),
		resolve(appDirectory, "build/updates"),
		process.env.ONEGIT_UPDATE_KEY_FILE
	);
}
