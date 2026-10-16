import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { remoteHelperTargets as helperTargets } from "../src/feature/machines/remote-protocol";

const directory = resolve(import.meta.dir, "../build/remote-helpers");
const requested = process.argv.slice(2);
const targets = requested.length ? requested : helperTargets;

await mkdir(directory, { recursive: true });

for (const target of targets) {
	if (!helperTargets.some((known) => known === target))
		throw new Error("Unsupported remote helper target.");

	const output = resolve(directory, `.helper-${target}-${crypto.randomUUID()}`);

	try {
		const child = Bun.spawn(
			[
				process.execPath,
				"build",
				resolve(import.meta.dir, "../src/feature/machines/remote-helper.ts"),
				"--compile",
				`--target=bun-${target}`,
				"--minify",
				"--no-compile-autoload-dotenv",
				"--no-compile-autoload-bunfig",
				"--outfile",
				output,
			],
			{ stdout: "inherit", stderr: "inherit" }
		);

		if ((await child.exited) !== 0)
			throw new Error(`Could not build the ${target} SSH helper.`);

		const bytes = await Bun.file(output).bytes();
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		const compressed = gzipSync(bytes);
		const archive = `${output}.gz`;

		await writeFile(archive, compressed, { mode: 0o600 });
		await rename(archive, resolve(directory, `${target}.gz`));
		await writeFile(
			`${output}.json`,
			JSON.stringify({
				sha256,
				compressedSha256: createHash("sha256").update(compressed).digest("hex"),
			})
		);
		await rename(`${output}.json`, resolve(directory, `${target}.json`));
	} finally {
		await rm(output, { force: true });
		await rm(`${output}.gz`, { force: true });
		await rm(`${output}.json`, { force: true });
	}
}
