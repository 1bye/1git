import { X509Certificate, randomBytes } from "node:crypto";
import {
	copyFile,
	mkdtemp,
	open,
	readFile,
	rm,
	writeFile,
	type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
	MacSigning,
	macSigningConfiguration,
	signingCommand,
} from "./macos-signing";

/** Explicit, idempotent provisioning. Stores no private material in the checkout or app. */
export async function setupSigning(): Promise<void> {
	if (process.platform !== "darwin")
		throw new Error("macOS signing setup requires macOS.");

	const lockPath = `${macSigningConfiguration}.setup.lock`;
	const directory = await mkdtemp(resolve(tmpdir(), "1git-signing-setup-"));
	const certificatePath = resolve(directory, "certificate.pem");
	const privatePath = resolve(directory, "private.pem");
	const archive = resolve(directory, "identity.p12");
	let lock: FileHandle | undefined;

	try {
		lock = await open(lockPath, "wx", 0o600);
		let signing = await MacSigning.load({});

		if (!signing.certificate) {
			if (
				!(await signingCommand(["openssl", "version"])).startsWith("OpenSSL 3.")
			)
				throw new Error(
					"Initial signing setup requires OpenSSL 3 on PATH (for example, Homebrew openssl@3). No identity was created."
				);

			const existing = await signingCommand([
				"/usr/bin/security",
				"find-certificate",
				"-a",
				"-c",
				"1git Local Release Signing",
				"-p",
			]);

			if (existing.trim())
				throw new Error(
					"A 1git signing certificate already exists without its public pin. Restore native/macos-signing.json instead of creating a replacement identity."
				);

			await writeFile(privatePath, "", { mode: 0o600, flag: "wx" });
			await writeFile(archive, "", { mode: 0o600, flag: "wx" });
			await signingCommand([
				"openssl",
				"req",
				"-new",
				"-x509",
				"-newkey",
				"rsa:3072",
				"-nodes",
				"-subj",
				"/CN=1git Local Release Signing",
				"-addext",
				"basicConstraints=critical,CA:FALSE",
				"-addext",
				"extendedKeyUsage=critical,codeSigning",
				"-addext",
				"keyUsage=critical,digitalSignature",
				"-days",
				"3650",
				"-keyout",
				privatePath,
				"-out",
				certificatePath,
			]);
			const certificate = new X509Certificate(await readFile(certificatePath));
			const password = randomBytes(32).toString("hex");

			await signingCommand(
				[
					"openssl",
					"pkcs12",
					"-export",
					"-legacy",
					"-inkey",
					privatePath,
					"-in",
					certificatePath,
					"-out",
					archive,
					"-passout",
					"env:ONEGIT_SIGNING_IMPORT_PASSWORD",
				],
				{ ...process.env, ONEGIT_SIGNING_IMPORT_PASSWORD: password }
			);
			const keychain = (
				await signingCommand([
					"/usr/bin/security",
					"default-keychain",
					"-d",
					"user",
				])
			)
				.trim()
				.replace(/^"|"$/gu, "");

			// Import only this identity; codesign is the sole application granted private-key access.
			await signingCommand([
				"/usr/bin/security",
				"import",
				archive,
				"-k",
				keychain,
				"-P",
				password,
				"-T",
				"/usr/bin/codesign",
			]);
			signing = new MacSigning(certificate);
			await writeFile(
				macSigningConfiguration,
				`${JSON.stringify({ fingerprint: signing.fingerprint, certificate: certificate.toString() }, null, 2)}\n`,
				{ flag: "wx" }
			);
		}

		if (!signing.certificate) throw new Error("Missing signing certificate.");

		try {
			await signing.verify();
		} catch {
			await writeFile(certificatePath, signing.certificate.toString());
			// Release-Mac user trust for code signing only, not TLS or system-wide trust; users need not install it.
			await signingCommand([
				"/usr/bin/security",
				"add-trusted-cert",
				"-r",
				"trustRoot",
				"-p",
				"codeSign",
				certificatePath,
			]);
		}

		await signing.verify();
		const probe = resolve(directory, "signing-check");

		await copyFile("/usr/bin/true", probe);
		await signing.sign(probe, async (args) => {
			await signingCommand(args);
		});
		await signingCommand(["/usr/bin/codesign", "--verify", "--strict", probe]);
		process.stdout.write(
			`Stable macOS signer ready: ${signing.fingerprint}\nPrivate key: your default Keychain. Public certificate pin: ${macSigningConfiguration}\nBack up the signing identity securely. Sparkle keys and published updates were not changed.\n`
		);
	} finally {
		try {
			await rm(directory, { recursive: true, force: true });
		} finally {
			if (lock) {
				await lock.close();
				await rm(lockPath);
			}
		}
	}
}

if (import.meta.main) {
	try {
		const args = process.argv.slice(2);

		if (args.length === 1 && (args[0] === "--help" || args[0] === "-h"))
			process.stdout.write(
				"Usage: bun run setup:signing:macos\nExplicitly provisions or reuses the pinned 1git self-signed identity. No publishing or Sparkle key changes.\n"
			);
		else if (args.length)
			throw new Error("Unknown signing setup option. Use --help.");
		else await setupSigning();
	} catch (error) {
		process.stderr.write(
			`Signing setup failed: ${error instanceof Error ? error.message : "unknown error"}\n`
		);
		process.exitCode = 1;
	}
}
