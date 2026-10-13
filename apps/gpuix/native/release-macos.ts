import { resolve } from "node:path";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { appDirectory } from "./config";
import { prepareUpdates } from "./prepare-updates";
import { releaseOptions } from "./release-options";
import { ReleasePublisher } from "./release-publisher";
import { R2ReleaseStorage } from "./release-storage";
import { ReleaseStack, publishWithProfile } from "@1git/releases/publishing";
import { releaseUpdateConfiguration } from "./sparkle";
import {
	SignedPublisherRequests,
	SparkleUploadSigner,
} from "./publisher-request";

const usage =
	"Usage: bun run release:macos -- --version 0.0.2 [--stage prod] [--profile name] [--dry-run]\nUses the personal Alchemy profile by default, saved stack outputs and the existing Sparkle Keychain key unless overridden; never deploys infrastructure. Dry-run builds/signs locally without loading Cloudflare credentials or accessing R2.\n";

/** Builds a versioned release without modifying package defaults, then publishes unless dry-run. */
export async function releaseMacOS(
	args: string[],
	env: NodeJS.ProcessEnv = process.env
): Promise<void> {
	const options = releaseOptions(args);

	if (options.help) {
		process.stdout.write(usage);

		return;
	}

	if (process.platform !== "darwin" || process.arch !== "arm64")
		throw new Error(
			"macOS releases require Apple Silicon macOS and full Xcode."
		);

	const target = await new ReleaseStack(
		resolve(appDirectory, "../releases/.alchemy")
	).load(options.stage);

	const updates = await releaseUpdateConfiguration(target.feedURL, env);

	// Publisher credentials are never passed to the app bundler or icon compiler.
	const buildEnv = Object.fromEntries(
		Object.entries(env).filter(
			([key]) =>
				!key.startsWith("ONEGIT_R2_") &&
				!key.startsWith("CLOUDFLARE_") &&
				!key.startsWith("ALCHEMY_")
		)
	);

	const build = Bun.spawn([process.execPath, "native/package-macos.ts"], {
		cwd: appDirectory,
		env: {
			...buildEnv,
			ONEGIT_UPDATE_FEED_URL: target.feedURL,
			ONEGIT_UPDATE_PUBLIC_KEY: updates.publicKey,
			ONEGIT_RELEASE_VERSION: options.version,
		},
		stdout: "inherit",
		stderr: "inherit",
	});

	if ((await build.exited) !== 0)
		throw new Error("Release build failed. Nothing uploaded.");

	const output = resolve(appDirectory, "build/updates");

	await mkdir(output, { recursive: true });
	const releaseDirectory = await mkdtemp(
		resolve(output, `${options.version}-`)
	);

	const snapshotDirectory = await mkdtemp(
		resolve(appDirectory, "build/.release-")
	);

	try {
		const snapshot = resolve(snapshotDirectory, "1git.app");

		await cp(resolve(appDirectory, "build/macos/1git.app"), snapshot, {
			recursive: true,
			verbatimSymlinks: true,
		});
		const artifacts = await prepareUpdates(
			snapshot,
			releaseDirectory,
			env.ONEGIT_UPDATE_KEY_FILE
		);

		if (artifacts.version !== options.version)
			throw new Error(
				"Built bundle does not match the requested release version. Nothing uploaded."
			);

		if (options.dryRun) {
			process.stdout.write(
				`Dry-run complete for ${options.version}. No R2 access; remote version not checked.\n`
			);

			return;
		}

		if (!target.publisherURL || target.publicKey !== updates.publicKey)
			throw new Error(
				"Deploy the signed publisher with the matching Sparkle public key first. No release uploaded."
			);

		const signer = new SparkleUploadSigner(
			updates.publicKey,
			env.ONEGIT_UPDATE_KEY_FILE
		);

		const publisher = new SignedPublisherRequests(
			target.publisherURL,
			(bytes) => signer.sign(bytes)
		);

		await publishWithProfile(
			target,
			options.profile ?? env.ALCHEMY_PROFILE ?? "personal",
			async (request) => {
				await new ReleasePublisher(new R2ReleaseStorage(request)).publish(
					artifacts
				);
			},
			(key, method, request) => publisher.send(key, method, request)
		);
		process.stdout.write(
			`Published ${options.version}: ZIP verified before signed feed at ${artifacts.feedURL}\n`
		);
	} finally {
		await rm(snapshotDirectory, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	try {
		await releaseMacOS(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(
			`Release failed: ${error instanceof Error ? error.message : "unknown error"}\n`
		);
		process.exitCode = 1;
	}
}
