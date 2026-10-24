import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MacSigning, signingCommand } from "./macos-signing";

import { remoteHelperTargets as helperTargets } from "../src/feature/machines/remote-protocol";

const directory = resolve(import.meta.dir, "../build/remote-helpers");
const requested = process.argv.slice(2);
const targets = requested.length ? requested : helperTargets;

const signing = process.env.ONEGIT_MACOS_SIGNING_IDENTITY
	? await MacSigning.load()
	: undefined;

await signing?.verify();

await mkdir(directory, { recursive: true });

const rustTargets: Record<(typeof helperTargets)[number], string> = {
	"darwin-arm64": "aarch64-apple-darwin",
	"darwin-x64": "x86_64-apple-darwin",
	"linux-arm64": "aarch64-unknown-linux-musl",
	"linux-arm64-musl": "aarch64-unknown-linux-musl",
	"linux-x64": "x86_64-unknown-linux-musl",
	"linux-x64-musl": "x86_64-unknown-linux-musl",
};

const compiled = new Map<string, Uint8Array>();

for (const target of targets) {
	const known = helperTargets.find((name) => name === target);

	if (!known) throw new Error("Unsupported remote helper target.");

	const rustTarget = rustTargets[known];
	let bytes = compiled.get(rustTarget);

	if (!bytes) {
		const output = resolve(import.meta.dir, "../build/rust-helper");

		const child = Bun.spawn(
			[
				"cargo",
				"build",
				"--locked",
				"--release",
				"--manifest-path",
				resolve(import.meta.dir, "remote-helper/Cargo.toml"),
				"--target-dir",
				output,
				"--target",
				rustTarget,
			],
			{
				env: {
					...process.env,
					...(rustTarget.endsWith("linux-musl")
						? { RUSTFLAGS: "-C linker=rust-lld -C target-feature=+crt-static" }
						: {}),
					MACOSX_DEPLOYMENT_TARGET: "13.0",
				},
				stdout: "inherit",
				stderr: "inherit",
			}
		);

		if ((await child.exited) !== 0)
			throw new Error(
				`Could not build the ${target} Rust SSH helper. Install its Rust target with rustup target add ${rustTarget}.`
			);

		const executable = resolve(
			output,
			rustTarget,
			"release/onegit-remote-helper"
		);

		// Sign macOS payloads before compression so the shipped helper hashes cover their signatures.
		if (signing && known.startsWith("darwin-"))
			await signing.sign(executable, async (args) => {
				await signingCommand(args);
			});

		bytes = await Bun.file(executable).bytes();
		compiled.set(rustTarget, bytes);
	}

	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const compressed = gzipSync(bytes);

	const temporary = resolve(
		directory,
		`.helper-${target}-${crypto.randomUUID()}`
	);

	try {
		await writeFile(`${temporary}.gz`, compressed, { mode: 0o600 });
		await writeFile(
			`${temporary}.json`,
			JSON.stringify({
				sha256,
				compressedSha256: createHash("sha256").update(compressed).digest("hex"),
			})
		);
		await rename(`${temporary}.gz`, resolve(directory, `${target}.gz`));
		await rename(`${temporary}.json`, resolve(directory, `${target}.json`));
	} finally {
		await rm(`${temporary}.gz`, { force: true });
		await rm(`${temporary}.json`, { force: true });
	}
}
