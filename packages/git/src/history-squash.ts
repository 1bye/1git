import { randomUUID } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
	SquashCommitsInput,
	SquashCommitsResult,
	SquashPlan,
} from "./contracts.js";
import type { RepositoryContext } from "./internal.js";
import { loadCommit, loadHistory, loadSnapshot } from "./queries.js";
import { invalidInput } from "./result.js";
import { requireText } from "./validation.js";
import { GitCommandFailure } from "./process/git-process.js";

const exactOid = /^(?:[a-f\d]{40}|[a-f\d]{64})$/i;
const maxRewriteCommits = 1000;

const commitConfigKeys = [
	"user.name",
	"user.email",
	"user.signingkey",
	"commit.gpgsign",
	"gpg.format",
	"gpg.program",
	"gpg.ssh.program",
	"gpg.openpgp.program",
	"gpg.x509.program",
] as const;

/** Builds a reviewed linear rewrite in a disposable detached worktree, then installs its exact tip atomically. */
export class HistorySquash {
	private constructor() {}

	static async review(
		context: RepositoryContext,
		input: SquashCommitsInput
	): Promise<SquashPlan> {
		if (context.repository.isShallow)
			throw invalidInput(
				"squash-commits",
				"Fetch the full history before squashing a shallow repository."
			);

		if (
			input.commits.length < 2 ||
			new Set(input.commits).size !== input.commits.length ||
			!input.commits.every((oid) => exactOid.test(oid)) ||
			!exactOid.test(input.expectedHead)
		)
			throw invalidInput(
				"squash-commits",
				"Select at least two consecutive commits from History."
			);

		const snapshot = await loadSnapshot(context, false, input.signal);

		if (
			!input.expectedBranch ||
			snapshot.head.detached ||
			snapshot.head.branch !== input.expectedBranch ||
			snapshot.head.oid !== input.expectedHead
		)
			throw invalidInput(
				"squash-commits",
				"The branch changed. Refresh and select the commits again."
			);

		if (snapshot.operationState !== "normal" || snapshot.files.length)
			throw invalidInput(
				"squash-commits",
				"Commit or stash your changes and finish the current Git operation first. Nothing has been discarded."
			);

		const oldestOid = input.commits.at(-1);

		if (!oldestOid)
			throw invalidInput("squash-commits", "Select a commit range.");

		const oldest = await loadCommit(context, oldestOid, input.signal);
		const parent = oldest.parentOids[0];

		const [history, published, tree] = await Promise.all([
			loadHistory(context, {
				revision: parent
					? `${parent}..${input.expectedHead}`
					: input.expectedHead,
				limit: maxRewriteCommits,
				signal: input.signal,
			}),
			context.process.run({
				args: [
					"for-each-ref",
					`--contains=${oldestOid}`,
					"--format=%(refname)",
					"refs/remotes/",
				],
				cwd: context.repository.root,
				signal: input.signal,
			}),
			context.process.run({
				args: ["ls-tree", "-r", input.expectedHead],
				cwd: context.repository.root,
				signal: input.signal,
			}),
		]);

		if (published.stdout.toString().trim())
			throw invalidInput(
				"squash-commits",
				"These commits are published according to known remote branches. Fetch first if another tool may have pushed; only unpublished history can be squashed."
			);

		if (history.hasMore || history.commits.length > maxRewriteCommits)
			throw invalidInput(
				"squash-commits",
				"This rewrite is too large. Use an external Git tool."
			);

		if (
			tree.stdout
				.toString()
				.split("\n")
				.some((line) => line.startsWith("160000 "))
		)
			throw invalidInput(
				"squash-commits",
				"Repositories with submodules require an external Git tool for history squashing."
			);

		const affected = history.commits;

		const offset = affected.findIndex(
			(commit) => commit.oid === input.commits[0]
		);

		const selected = affected.slice(offset, offset + input.commits.length);

		if (
			offset < 0 ||
			affected[0]?.oid !== input.expectedHead ||
			affected.at(-1)?.oid !== oldestOid ||
			selected.length !== input.commits.length ||
			selected.some((commit, index) => commit.oid !== input.commits[index])
		)
			throw invalidInput(
				"squash-commits",
				"Select consecutive commits on the current branch, newest first."
			);

		if (
			affected.some(
				(commit, index) =>
					commit.parentOids.length > 1 ||
					(index + 1 < affected.length &&
						commit.parentOids[0] !== affected[index + 1]?.oid)
			)
		)
			throw invalidInput(
				"squash-commits",
				"This rewrite contains merge commits or non-linear history. Use an external Git tool."
			);

		return { commits: selected, replay: affected.slice(0, offset) };
	}

	private static async configuration(
		context: RepositoryContext,
		signal?: AbortSignal
	): Promise<string[]> {
		const read = async (key: string, path = false): Promise<string | null> => {
			try {
				const output = await context.process.run({
					args: ["config", ...(path ? ["--path"] : []), "--get", key],
					cwd: context.repository.root,
					signal,
				});

				return output.stdout.toString().replace(/\r?\n$/, "");
			} catch (cause) {
				if (cause instanceof GitCommandFailure && cause.exitCode === 1)
					return null;

				throw cause;
			}
		};

		const [values, hooks] = await Promise.all([
			Promise.all(commitConfigKeys.map((key) => read(key))),
			read("core.hooksPath", true),
		]);

		const args = [
			"-c",
			`core.hooksPath=${hooks === null ? join(context.repository.commonDirectory, "hooks") : resolve(context.repository.root, hooks)}`,
		];

		for (const [index, key] of commitConfigKeys.entries()) {
			const value = values[index];

			if (value !== null && value !== undefined)
				args.push("-c", `${key}=${value}`);
		}

		return args;
	}

	static async run(
		context: RepositoryContext,
		input: SquashCommitsInput
	): Promise<SquashCommitsResult> {
		const plan = await HistorySquash.review(context, input);

		const message = requireText(
			input.message,
			"Squash commit message",
			"squash-commits"
		);

		if (!message.split("\n", 1)[0]?.trim())
			throw invalidInput("squash-commits", "A first-line summary is required.");

		const oldest = plan.commits.at(-1);
		const newest = plan.commits[0];

		if (!oldest || !newest)
			throw invalidInput("squash-commits", "Select a commit range.");

		const lockPath = join(context.repository.gitDirectory, "index.lock");

		const lock = await open(lockPath, "wx").catch((cause: unknown) => {
			if (
				cause &&
				typeof cause === "object" &&
				"code" in cause &&
				cause.code === "EEXIST"
			)
				throw invalidInput(
					"squash-commits",
					"Another Git process has locked the index.",
					"repository-locked"
				);

			throw cause;
		});

		let directory: string | undefined;
		let worktree: string | undefined;
		let oid: string | undefined;
		let warning: string | null = null;
		let failure: { cause: unknown } | undefined;
		const recoveryRef = `refs/1git/squash/${randomUUID()}`;

		try {
			await lock.close();

			const config = await HistorySquash.configuration(context, input.signal);

			directory = await mkdtemp(join(tmpdir(), "1git-squash-"));
			const scratch = join(directory, "worktree");

			worktree = scratch;
			await context.process.run({
				args: ["worktree", "add", "--detach", "--", scratch, oldest.oid],
				cwd: context.repository.root,
				signal: input.signal,
			});
			const run = async (args: readonly string[], stdin?: string) =>
				await context.process.run({
					args: [...config, ...args],
					cwd: scratch,
					signal: input.signal,
					stdin,
				});

			await run(["read-tree", "--reset", "-u", newest.oid]);
			await run(
				["commit", "--amend", "--allow-empty", "-F", "-"],
				`${message}\n`
			);

			// Replaying later commits keeps their messages/authors without touching the user's branch or files.
			for (const commit of [...plan.replay].reverse())
				await run([
					"cherry-pick",
					"--allow-empty",
					"--keep-redundant-commits",
					commit.oid,
				]);

			const built = (await run(["rev-parse", "HEAD"])).stdout.toString().trim();

			const finalTree = (await run(["rev-parse", "HEAD^{tree}"])).stdout
				.toString()
				.trim();

			const originalTree = (
				await context.process.run({
					args: ["rev-parse", `${input.expectedHead}^{tree}`],
					cwd: context.repository.root,
					signal: input.signal,
				})
			).stdout
				.toString()
				.trim();

			if (!exactOid.test(built) || finalTree !== originalTree)
				throw invalidInput(
					"squash-commits",
					"Hooks or replay changed the resulting files. Squash was not installed; your branch and working files are unchanged."
				);

			await HistorySquash.review(context, input);
			// Retain the old tip and move only the reviewed branch in a single compare-and-swap transaction.
			await context.process.run({
				args: ["update-ref", "-m", "1git: squash commits", "--stdin"],
				cwd: context.repository.root,
				stdin: `start\ncreate ${recoveryRef} ${input.expectedHead}\nupdate refs/heads/${input.expectedBranch} ${built} ${input.expectedHead}\nprepare\ncommit\n`,
			});
			oid = built;
		} catch (cause) {
			failure = { cause };
		} finally {
			try {
				if (worktree)
					await context.process.run({
						args: ["worktree", "remove", "--force", "--", worktree],
						cwd: context.repository.root,
					});

				if (directory) await rm(directory, { recursive: true, force: true });
			} catch {
				warning = `Temporary squash worktree cleanup failed: ${worktree}. Inspect History before retrying.`;
			} finally {
				try {
					await rm(lockPath, { force: true });
				} catch {
					warning = `Squash cleanup could not release ${lockPath}. Inspect History and the lock before continuing. ${warning ?? ""}`;
				}
			}
		}

		if (failure) {
			if (warning)
				throw invalidInput(
					"squash-commits",
					`Squash did not complete. ${warning}`
				);

			throw failure.cause;
		}

		if (!oid)
			throw invalidInput(
				"squash-commits",
				"Squash outcome is uncertain. Refresh History before retrying."
			);

		let snapshot: SquashCommitsResult["snapshot"] = null;

		try {
			snapshot = await loadSnapshot(context);

			if (
				snapshot.head.oid !== oid ||
				snapshot.head.branch !== input.expectedBranch
			)
				warning = `Squash completed, but the branch changed externally. Refresh and inspect History. Originals: ${recoveryRef}. ${warning ?? ""}`;
		} catch {
			warning = `Squash completed; refresh failed. Refresh History before continuing. Originals: ${recoveryRef}. ${warning ?? ""}`;
		}

		return { oid, recoveryRef, snapshot, warning };
	}
}
