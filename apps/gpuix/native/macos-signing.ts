import { X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { appDirectory } from "./config";

/** Public certificate pin only; the matching private key stays in the release Mac's Keychain. */
export const macSigningConfiguration = resolve(
	import.meta.dir,
	"macos-signing.json"
);

/** One persistent signer for the app and nested code, independent of Sparkle's Ed25519 key. */
export class MacSigning {
	constructor(readonly certificate: X509Certificate | null) {}

	static async load(
		env: NodeJS.ProcessEnv = process.env,
		required = false
	): Promise<MacSigning> {
		if (env.ONEGIT_MACOS_ADHOC === "1") {
			if (required)
				throw new Error("Published releases cannot use ad-hoc signing.");

			return new MacSigning(null);
		}

		const path = env.ONEGIT_MACOS_SIGNING_CONFIG ?? macSigningConfiguration;
		let raw: string;

		try {
			raw = await readFile(path, "utf8");
		} catch (error) {
			if (
				error instanceof Error &&
				"code" in error &&
				error.code === "ENOENT" &&
				!env.ONEGIT_MACOS_SIGNING_CONFIG &&
				!required
			)
				return new MacSigning(null);

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
		return this.certificate?.fingerprint.replaceAll(":", "") ?? "-";
	}

	async sign(
		path: string,
		run: (args: string[]) => Promise<void>
	): Promise<void> {
		await run([
			"/usr/bin/codesign",
			"--force",
			"--sign",
			this.fingerprint,
			"--timestamp=none",
			path,
		]);
	}

	/** Missing or untrusted identities fail before packaging; private-key access is still enforced by codesign. */
	async verify(): Promise<void> {
		if (!this.certificate) return;

		const identities = await signingCommand([
			"/usr/bin/security",
			"find-identity",
			"-v",
			"-p",
			"codesigning",
		]);

		if (!identities.includes(this.fingerprint))
			throw new Error(
				"The pinned macOS signing identity is unavailable. Unlock its Keychain or rerun setup:signing:macos to finish local code-signing trust. No ad-hoc fallback is allowed."
			);
	}
}

/** Captured tool boundary: never print command arguments, which may contain a temporary import password. */
export async function signingCommand(
	args: string[],
	env = process.env
): Promise<string> {
	const child = Bun.spawn(args, {
		cwd: appDirectory,
		env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		timeout: 120000,
	});

	const [output, errors, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);

	if (code !== 0) throw new Error(`${args[0]} failed: ${errors.trim()}`);

	return output;
}
