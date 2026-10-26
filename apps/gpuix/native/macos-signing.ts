import { X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { appDirectory } from "./config";

/** Public certificate pin only; the matching private key stays in the release Mac's Keychain. */
export const macSigningConfiguration = resolve(
	import.meta.dir,
	"macos-signing.json"
);

interface DeveloperIDConfiguration {
	fingerprint: string;
	teamID: string;
	notaryProfile?: string;
}

/** Executable entitlements are separate from the metadata retained on Sparkle's downloader. */
export interface MacSigningOptions {
	entitlements?: string;
	preserveEntitlements?: boolean;
}

/** Ad-hoc signing by default; explicit identities are separate from Sparkle's Ed25519 key. */
export class MacSigning {
	constructor(
		readonly certificate: X509Certificate | null,
		readonly developerID?: DeveloperIDConfiguration
	) {}

	static async load(
		env: NodeJS.ProcessEnv = process.env,
		required = false
	): Promise<MacSigning> {
		const identity = env.ONEGIT_MACOS_SIGNING_IDENTITY;
		const teamID = env.ONEGIT_MACOS_TEAM_ID;
		const notaryProfile = env.ONEGIT_MACOS_NOTARY_PROFILE || undefined;

		if (
			identity !== undefined ||
			teamID !== undefined ||
			notaryProfile !== undefined
		) {
			if (
				env.ONEGIT_MACOS_ADHOC === "1" ||
				env.ONEGIT_MACOS_SIGNING_CONFIG !== undefined
			)
				throw new Error(
					"Developer ID signing cannot be combined with ad-hoc mode or a self-signed certificate pin."
				);

			if (
				!identity ||
				!/^[A-Fa-f0-9]{40}$/u.test(identity) ||
				!teamID ||
				!/^[A-Z0-9]{10}$/u.test(teamID) ||
				(notaryProfile !== undefined &&
					!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(notaryProfile))
			)
				throw new Error(
					"Developer ID signing requires ONEGIT_MACOS_SIGNING_IDENTITY (40-character certificate fingerprint) and ONEGIT_MACOS_TEAM_ID (10-character Apple team ID). Optional ONEGIT_MACOS_NOTARY_PROFILE enables notarization and must use letters, numbers, dots, underscores or hyphens."
				);

			return new MacSigning(null, {
				fingerprint: identity.toUpperCase(),
				teamID,
				...(notaryProfile ? { notaryProfile } : {}),
			});
		}

		if (
			env.ONEGIT_MACOS_ADHOC === "1" ||
			(!required && env.ONEGIT_MACOS_SIGNING_CONFIG === undefined)
		)
			return new MacSigning(null);

		const path = env.ONEGIT_MACOS_SIGNING_CONFIG ?? macSigningConfiguration;
		let raw: string;

		try {
			raw = await readFile(path, "utf8");
		} catch (error) {
			throw new Error(
				"Stable macOS signing is not configured. Run setup:signing:macos; no identity was generated or changed.",
				{ cause: error }
			);
		}

		const input: unknown = JSON.parse(raw);

		if (
			!input ||
			typeof input !== "object" ||
			!("certificate" in input) ||
			typeof input.certificate !== "string" ||
			!("fingerprint" in input) ||
			typeof input.fingerprint !== "string"
		)
			throw new Error("Invalid macOS signing certificate pin.");

		const certificate = new X509Certificate(input.certificate);
		const fingerprint = certificate.fingerprint.replaceAll(":", "");

		if (
			fingerprint !== input.fingerprint ||
			!certificate.verify(certificate.publicKey) ||
			!certificate.keyUsage?.includes("1.3.6.1.5.5.7.3.3") ||
			Date.parse(certificate.validFrom) > Date.now() ||
			Date.parse(certificate.validTo) <= Date.now()
		)
			throw new Error(
				"The pinned self-signed code-signing certificate is invalid or expired. Refusing to change signing identity."
			);

		return new MacSigning(certificate);
	}

	get fingerprint(): string {
		return (
			this.developerID?.fingerprint ??
			this.certificate?.fingerprint.replaceAll(":", "") ??
			"-"
		);
	}

	/** Signs inside-out; only the main Bun executable receives its runtime entitlements. */
	async sign(
		path: string,
		run: (args: string[]) => Promise<void>,
		options: MacSigningOptions = {}
	): Promise<void> {
		await run([
			"/usr/bin/codesign",
			"--force",
			"--sign",
			this.fingerprint,
			...(this.developerID
				? ["--timestamp", "--options", "runtime"]
				: ["--timestamp=none"]),
			...(this.developerID && options.entitlements
				? ["--entitlements", options.entitlements]
				: []),
			...(options.preserveEntitlements
				? ["--preserve-metadata=entitlements"]
				: []),
			path,
		]);
	}

	/** Missing or untrusted identities fail before packaging; private-key access is still enforced by codesign. */
	async verify(
		command: (args: string[]) => Promise<string> = signingCommand
	): Promise<void> {
		if (this.fingerprint === "-") return;

		const identities = await command([
			"/usr/bin/security",
			"find-identity",
			"-v",
			"-p",
			"codesigning",
		]);

		if (this.developerID) {
			const { teamID } = this.developerID;

			const identity = identities.split("\n").some((line) => {
				const match = /^\s*\d+\)\s+([A-F0-9]{40})\s+"(.+)"\s*$/u.exec(line);

				return (
					match?.[1] === this.fingerprint &&
					match[2]?.startsWith("Developer ID Application: ") &&
					match[2].endsWith(` (${teamID})`)
				);
			});

			if (!identity)
				throw new Error(
					`Developer ID Application identity ${this.fingerprint} for team ${this.developerID.teamID} is unavailable. Create/import its certificate and private key in Xcode > Settings > Accounts > Manage Certificates, and unlock its Keychain. No other account or self-signed fallback will be used.`
				);

			return;
		}

		if (!identities.includes(this.fingerprint))
			throw new Error(
				"The pinned macOS signing identity is unavailable. Unlock its Keychain or rerun setup:signing:macos to finish local code-signing trust. No ad-hoc fallback is allowed."
			);
	}

	/** With a configured profile, submits a temporary ZIP and validates the stapled app; otherwise leaves signing-only releases untouched. */
	async notarize(
		bundle: string,
		archive: string,
		command: (args: string[], timeoutMs?: number) => Promise<string> = (
			args,
			timeoutMs
		) => signingCommand(args, process.env, timeoutMs)
	): Promise<void> {
		if (!this.developerID?.notaryProfile) return;

		const { notaryProfile } = this.developerID;

		await command([
			"/usr/bin/ditto",
			"-c",
			"-k",
			"--sequesterRsrc",
			"--keepParent",
			bundle,
			archive,
		]);
		process.stdout.write(
			"Submitting Developer ID signed app to Apple for notarization…\n"
		);
		const output = await command(
			[
				"xcrun",
				"notarytool",
				"submit",
				archive,
				"--keychain-profile",
				notaryProfile,
				"--wait",
				"--timeout",
				"30m",
				"--output-format",
				"json",
			],
			31 * 60_000
		);

		let result: unknown;

		try {
			result = JSON.parse(output);
		} catch (cause) {
			throw new Error(
				"Apple notarization returned invalid JSON. No release artifacts replaced.",
				{ cause }
			);
		}

		if (
			!result ||
			typeof result !== "object" ||
			!("status" in result) ||
			result.status !== "Accepted"
		) {
			const id =
				result &&
				typeof result === "object" &&
				"id" in result &&
				typeof result.id === "string" &&
				/^[A-Fa-f0-9-]{36}$/u.test(result.id)
					? result.id
					: "SUBMISSION_ID";

			throw new Error(
				`Apple did not accept notarization. Inspect xcrun notarytool log ${id} --keychain-profile ${notaryProfile}. No release artifacts replaced.`
			);
		}

		await command(["xcrun", "stapler", "staple", bundle]);
		await command(["xcrun", "stapler", "validate", bundle]);
		await command([
			"/usr/bin/codesign",
			"--verify",
			"--deep",
			"--strict",
			bundle,
		]);
		await command([
			"/usr/sbin/spctl",
			"--assess",
			"--type",
			"execute",
			"--verbose=2",
			bundle,
		]);
	}
}

/** Captured tool boundary: never print command arguments, which may contain a temporary import password. */
export async function signingCommand(
	args: string[],
	env = process.env,
	timeoutMs = 120000
): Promise<string> {
	const child = Bun.spawn(args, {
		cwd: appDirectory,
		env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		timeout: timeoutMs,
	});

	const [output, errors, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);

	if (code !== 0) throw new Error(`${args[0]} failed: ${errors.trim()}`);

	return output;
}
