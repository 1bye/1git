import { join } from "node:path";
import { copyFile, open, readFile, rename, rm, writeFile } from "./runtime.js";
import type { RepositoryContext } from "./internal.js";
import { GitCommandFailure } from "./process/git-process.js";
import { loadStashes } from "./queries.js";
import { invalidInput } from "./result.js";

const objectId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

const reflogHeader =
	/^([a-f0-9]{40}|[a-f0-9]{64}) ([a-f0-9]{40}|[a-f0-9]{64}) /u;

/** Deletes the reviewed stash entry while Git's shared stash-ref lock excludes other writers. */
export class StashDeletion {
	static async run(
		context: RepositoryContext,
		expectedOid: string
	): Promise<void> {
		if (!objectId.test(expectedOid))
			throw invalidInput("drop-stash", "Choose an exact saved stash.");

		try {
			const format = await context.process.run({
				args: ["config", "--local", "--get", "extensions.refStorage"],
				cwd: context.repository.root,
			});

			if (format.stdout.toString("utf8").trim() !== "files")
				throw invalidInput(
					"drop-stash",
					"Safe stash deletion is unavailable for this Git reference format. Delete it using Git outside the app."
				);
		} catch (cause) {
			if (!(cause instanceof GitCommandFailure && cause.exitCode === 1))
				throw cause;
		}

		const ref = join(context.repository.commonDirectory, "refs/stash");
		const log = join(context.repository.commonDirectory, "logs/refs/stash");
		const refLock = `${ref}.lock`;
		const logLock = `${log}.lock`;

		const lock = await open(refLock, "wx").catch((cause: unknown) => {
			if (cause instanceof Error && "code" in cause && cause.code === "EEXIST")
				throw invalidInput(
					"drop-stash",
					"Another Git process is changing Stashes. Refresh and try again.",
					"repository-locked"
				);

			throw cause;
		});

		let logHandle: Awaited<ReturnType<typeof open>> | undefined;
		let logInstalled = false;
		let retainRefLock = false;
		let ownsRefLock = true;
		let ownsLogLock = false;

		try {
			try {
				await context.process.run({
					args: ["symbolic-ref", "-q", "refs/stash"],
					cwd: context.repository.root,
				});

				throw invalidInput(
					"drop-stash",
					"Safe deletion requires an ordinary stash reference. Inspect it using Git outside the app."
				);
			} catch (cause) {
				if (!(cause instanceof GitCommandFailure && cause.exitCode === 1))
					throw cause;
			}

			const stashes = await loadStashes(context);

			if (stashes.filter((stash) => stash.oid === expectedOid).length !== 1)
				throw invalidInput(
					"drop-stash",
					"This stash changed or is unavailable. Refresh and select it again."
				);

			const source = await readFile(log);
			const records: { bytes: Buffer; oid: string; width: number }[] = [];
			let start = 0;

			while (start < source.length) {
				const end = source.indexOf(10, start);
				const bytes = source.subarray(start, end);

				const header = reflogHeader.exec(
					bytes.subarray(0, 130).toString("ascii")
				);

				if (
					end < 0 ||
					!header ||
					header[1]!.length !== expectedOid.length ||
					header[2]!.length !== expectedOid.length
				)
					throw invalidInput(
						"drop-stash",
						"The stash reflog is invalid. Inspect it using Git outside the app."
					);

				records.push({ bytes, oid: header[2]!, width: header[1]!.length });
				start = end + 1;
			}

			if (records.filter((record) => record.oid === expectedOid).length !== 1)
				throw invalidInput(
					"drop-stash",
					"This stash changed. Refresh and select it again."
				);

			const oldTip = records.at(-1)!.oid;

			const current = await context.process.run({
				args: ["rev-parse", "--verify", "refs/stash"],
				cwd: context.repository.root,
			});

			if (current.stdout.toString("utf8").trim() !== oldTip)
				throw invalidInput(
					"drop-stash",
					"The stash reference and reflog disagree. Inspect Stashes using Git."
				);

			const remaining = records.filter((record) => record.oid !== expectedOid);
			let previous = "0".repeat(oldTip.length);
			const lines: Buffer[] = [];

			for (const record of remaining) {
				// Preserve message/identity bytes, including non-UTF-8 text; rewrite only the old object ID.
				lines.push(
					Buffer.from(previous),
					record.bytes.subarray(record.width),
					Buffer.from("\n")
				);
				previous = record.oid;
			}

			logHandle = await open(logLock, "wx");
			ownsLogLock = true;
			await copyFile(log, logLock);
			await writeFile(logLock, Buffer.concat(lines));
			await logHandle.sync();

			if (remaining.length) {
				try {
					await copyFile(ref, refLock);
				} catch (cause) {
					if (
						!(
							cause instanceof Error &&
							"code" in cause &&
							cause.code === "ENOENT"
						)
					)
						throw cause;
				}

				await writeFile(refLock, `${previous}\n`);
				await lock.sync();
			}

			await rename(logLock, log);
			ownsLogLock = false;
			logInstalled = true;

			if (remaining.length) {
				retainRefLock = true;
				await rename(refLock, ref);
				ownsRefLock = false;
				retainRefLock = false;
			} else {
				// Git removes packed and loose refs together. The expected tip protects a concurrently pushed stash.
				await rm(refLock);
				ownsRefLock = false;

				try {
					await context.process.run({
						args: ["update-ref", "--no-deref", "-d", "refs/stash", oldTip],
						cwd: context.repository.root,
					});
				} catch (cause) {
					if (!(await loadStashes(context)).length) throw cause;
				}
			}
		} catch (cause) {
			if (logInstalled)
				throw invalidInput(
					"drop-stash",
					`The selected stash entry was removed, but reference cleanup could not be confirmed. Inspect Stashes${retainRefLock ? ` and ${refLock}` : ""} before continuing.`
				);

			throw cause;
		} finally {
			await logHandle?.close();
			await lock.close();

			if (ownsLogLock) await rm(logLock, { force: true });

			if (ownsRefLock && !retainRefLock) await rm(refLock, { force: true });
		}
	}
}
