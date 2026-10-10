import { randomUUID } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
	SquashCommitsInput,
	ReorderCommitsInput,
	HistoryRewriteResult,
	HistoryRewritePlan,
} from "./contracts.js";
import type { RepositoryContext } from "./internal.js";
import { loadCommit, loadHistory, loadSnapshot } from "./queries.js";
import { invalidInput, toGitError } from "./result.js";
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
export class HistoryRewrite {
	private constructor() {}

	static async review(
		context: RepositoryContext,
		input: SquashCommitsInput | ReorderCommitsInput
	): Promise<HistoryRewritePlan> {
		const reorder = "order" in input;
		const operation = reorder ? "reorder-commits" : "squash-commits";
		const selectedOids = new Set(input.commits);

		if (context.repository.isShallow)
			throw invalidInput(
				operation,
				"Fetch the full history before rewriting a shallow repository."
			);

		if (
			input.commits.length < 2 ||
			selectedOids.size !== input.commits.length ||
			!input.commits.every((oid) => exactOid.test(oid)) ||
			!exactOid.test(input.expectedHead)
		)
			throw invalidInput(
				operation,
				"Select at least two consecutive commits from History."
			);

		if (
			reorder &&
			(input.order.length !== input.commits.length ||
				new Set(input.order).size !== input.order.length ||
				input.order.some((oid) => !selectedOids.has(oid)))
		)
			throw invalidInput(
				operation,
				"The new order must contain each selected commit exactly once."
			);

		const snapshot = await loadSnapshot(context, false, input.signal);

		if (
			!input.expectedBranch ||
			snapshot.head.detached ||
			snapshot.head.branch !== input.expectedBranch ||
			snapshot.head.oid !== input.expectedHead
		)
			throw invalidInput(
				operation,
				"The branch changed. Refresh and select the commits again."
			);

		if (snapshot.operationState !== "normal" || snapshot.files.length)
			throw invalidInput(
				operation,
				"Commit or stash your changes and finish the current Git operation first. Nothing has been discarded."
			);

		const oldestOid = input.commits.at(-1);

		if (!oldestOid) throw invalidInput(operation, "Select a commit range.");

		const oldest = await loadCommit(context, oldestOid, input.signal);
		const parent = oldest.parentOids[0];

		if (reorder && !parent && input.order[0] !== oldest.oid)
			throw invalidInput(
				operation,
				"The root commit must stay first. Reorder the commits after it instead."
			);

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
				operation,
				"These commits are published according to known remote branches. Fetch first if another tool may have pushed; only unpublished history can be rewritten."
			);

		if (history.hasMore || history.commits.length > maxRewriteCommits)
			throw invalidInput(
				operation,
				"This rewrite is too large. Use an external Git tool."
			);

		if (
			tree.stdout
				.toString()
				.split("\n")
				.some((line) => line.startsWith("160000 "))
		)
			throw invalidInput(
				operation,
				"Repositories with submodules require an external Git tool for history rewriting."
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
				operation,
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
				operation,
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
		input: SquashCommitsInput | ReorderCommitsInput
	): Promise<HistoryRewriteResult> {
		const reorder = "order" in input;
		const action = reorder ? "reorder" : "squash";
		const label = reorder ? "Reorder" : "Squash";
		const operation = reorder ? "reorder-commits" : "squash-commits";
		const plan = await HistoryRewrite.review(context, input);

		const message = reorder
			? null
			: requireText(input.message, "Squash commit message", operation);

		if (message !== null && !message.split("\n", 1)[0]?.trim())
			throw invalidInput(operation, "A first-line summary is required.");

		if (
			reorder &&
			input.order.every(
				(oid, index) => oid === input.commits[input.commits.length - index - 1]
			)
		)
			throw invalidInput(operation, "Choose a different commit order first.");

		const oldest = plan.commits.at(-1);
		const newest = plan.commits[0];

		if (!oldest || !newest)
			throw invalidInput(operation, "Select a commit range.");

		const lockPath = join(context.repository.gitDirectory, "index.lock");

		const lock = await open(lockPath, "wx").catch((cause: unknown) => {
			if (
				cause &&
				typeof cause === "object" &&
				"code" in cause &&
				cause.code === "EEXIST"
			)
				throw invalidInput(
					operation,
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
		const recoveryRef = `refs/1git/${action}/${randomUUID()}`;

		try {
			await lock.close();

			const config = await HistoryRewrite.configuration(context, input.signal);

			directory = await mkdtemp(join(tmpdir(), `1git-${action}-`));
			const scratch = join(directory, "worktree");

			worktree = scratch;
			await context.process.run({
				args: [
					"worktree",
					"add",
					"--detach",
					"--",
					scratch,
					reorder ? (oldest.parentOids[0] ?? oldest.oid) : oldest.oid,
				],
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

			if (!reorder) {
				await run(["read-tree", "--reset", "-u", newest.oid]);
				await run(
					["commit", "--amend", "--allow-empty", "-F", "-"],
					`${message}\n`
				);
			}

			// A selected root stays as the base; every other selected commit is replayed in the chosen order.
			const selected = reorder
				? oldest.parentOids.length
					? input.order
					: input.order.slice(1)
				: [];

			const replay = [
				...selected,
				...[...plan.replay].reverse().map((commit) => commit.oid),
			];

			// Replaying later commits keeps their messages/authors without touching the user's branch or files.
			for (const commit of replay)
				await run([
					"cherry-pick",
					"--allow-empty",
					"--keep-redundant-commits",
					commit,
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
					operation,
					`Hooks or replay changed the resulting files. ${label} was not installed; your branch and working files are unchanged.`
				);

			await HistoryRewrite.review(context, input);
			// Retain the old tip and move only the reviewed branch in a single compare-and-swap transaction.
			await context.process.run({
				args: ["update-ref", "-m", `1git: ${action} commits`, "--stdin"],
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
				warning = `Temporary ${action} worktree cleanup failed: ${worktree}. Inspect History before retrying.`;
			} finally {
				try {
					await rm(lockPath, { force: true });
				} catch {
					warning = `${label} cleanup could not release ${lockPath}. Inspect History and the lock before continuing. ${warning ?? ""}`;
				}
			}
		}

		if (failure) {
			if (warning)
				throw invalidInput(operation, `${label} did not complete. ${warning}`);

			if (reorder && toGitError(operation, failure.cause).code === "conflict")
				throw invalidInput(
					operation,
					"Reordering caused a replay conflict. Your branch and working files are unchanged. Choose another order or use an external Git tool.",
					"conflict"
				);

			throw failure.cause;
		}

		if (!oid)
			throw invalidInput(
				operation,
				`${label} outcome is uncertain. Refresh History before retrying.`
			);

		let snapshot: HistoryRewriteResult["snapshot"] = null;

		try {
			snapshot = await loadSnapshot(context);

			if (
				snapshot.head.oid !== oid ||
				snapshot.head.branch !== input.expectedBranch
			)
				warning = `${label} completed, but the branch changed externally. Refresh and inspect History. Originals: ${recoveryRef}. ${warning ?? ""}`;
		} catch {
			warning = `${label} completed; refresh failed. Refresh History before continuing. Originals: ${recoveryRef}. ${warning ?? ""}`;
		}

		return { oid, recoveryRef, snapshot, warning };
	}
}
