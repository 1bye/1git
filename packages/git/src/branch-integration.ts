import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "./runtime.js";
import { join } from "node:path";
import type {
	BranchIntegrationInput,
	FinishOperationInput,
	RepositorySnapshot,
} from "./contracts.js";
import type { RepositoryContext } from "./internal.js";
import { loadBranches, loadSnapshot } from "./queries.js";
import { invalidInput } from "./result.js";
import { requireText } from "./validation.js";

/** Reviewed branch integration; squash uses Git's own pending message so recovery survives restart. */
export class BranchIntegration {
	private constructor() {}

	static async run(
		context: RepositoryContext,
		input: BranchIntegrationInput
	): Promise<RepositorySnapshot> {
		const { kind } = input;

		const read = async () => {
			const [snapshot, branches] = await Promise.all([
				loadSnapshot(context),
				loadBranches(context),
			]);

			const target = branches.branches.find(
				(branch) => branch.fullName === input.branch
			);

			if (
				!input.expectedHead ||
				!input.expectedBranch ||
				snapshot.head.detached ||
				snapshot.head.oid !== input.expectedHead ||
				snapshot.head.branch !== input.expectedBranch ||
				!target ||
				target.oid !== input.expectedTarget ||
				(target.type === "local" && target.name === input.expectedBranch)
			)
				throw invalidInput(
					kind,
					"A branch tip changed. Refresh and review both branches again."
				);

			if (snapshot.operationState !== "normal" || snapshot.files.length)
				throw invalidInput(
					kind,
					"Commit or stash your changes and finish the current Git operation first. Nothing has been discarded."
				);

			return snapshot;
		};

		await read();
		const run = async (args: readonly string[], stdin?: string) =>
			await context.process.run({ args, cwd: context.repository.root, stdin });

		const message =
			kind === "squash-merge"
				? requireText(input.message ?? "", "Squash commit message", kind)
				: null;

		if (message && !message.split("\n", 1)[0]?.trim())
			throw invalidInput(kind, "A first-line summary is required.");

		if (kind === "rebase") {
			const range = `${input.expectedTarget}..${input.expectedHead}`;

			const [all, unpublished, merges] = await Promise.all([
				run(["rev-list", "--count", range]),
				run(["rev-list", "--count", range, "--not", "--remotes"]),
				run(["rev-list", "--count", "--merges", range]),
			]);

			if (all.stdout.toString().trim() !== unpublished.stdout.toString().trim())
				throw invalidInput(
					kind,
					"Rebase would rewrite published commits according to known remote branches. Merge instead, or fetch and review the branch again."
				);

			if (merges.stdout.toString().trim() !== "0")
				throw invalidInput(
					kind,
					"This branch contains merge commits. Use Merge or an external Git tool to preserve that history."
				);

			await read();
			await run(
				["update-ref", "-m", "1git: retain rebased branch", "--stdin"],
				`start\nverify refs/heads/${input.expectedBranch} ${input.expectedHead}\ncreate refs/1git/rebase/${randomUUID()} ${input.expectedHead}\nprepare\ncommit\n`
			);
			await run([
				"rebase",
				"--no-autostash",
				"--no-update-refs",
				"--no-fork-point",
				input.expectedTarget,
			]);
		} else {
			await read();

			try {
				await run([
					"merge",
					"--squash",
					"--no-autostash",
					input.expectedTarget,
				]);
			} finally {
				// Git writes SQUASH_MSG even on conflicts; retain the explicitly reviewed message for Continue.
				const after = await loadSnapshot(context);

				if (
					after.operationState === "squash-merge" &&
					after.head.oid === input.expectedHead &&
					after.head.branch === input.expectedBranch
				)
					await writeFile(
						join(context.repository.gitDirectory, "SQUASH_MSG"),
						`${message}\n`
					);
			}

			const after = await loadSnapshot(context);

			if (
				after.head.oid !== input.expectedHead ||
				after.head.branch !== input.expectedBranch
			)
				throw invalidInput(
					kind,
					"The branch changed during squash merge. Inspect Changes before continuing."
				);

			if (!after.files.length) {
				await rm(join(context.repository.gitDirectory, "SQUASH_MSG"), {
					force: true,
				});

				return await loadSnapshot(context);
			}

			await run(["commit", "-F", "-"], `${message}\n`);
		}

		return await loadSnapshot(context);
	}

	/** Continue commits only existing staged resolutions; abort returns to the unchanged pre-squash tip. */
	static async finishSquash(
		context: RepositoryContext,
		input: FinishOperationInput
	): Promise<void> {
		const original = (
			await readFile(join(context.repository.gitDirectory, "ORIG_HEAD"), "utf8")
		).trim();

		if (original !== input.expectedHead)
			throw invalidInput(
				`${input.kind}-squash-merge`,
				"The branch moved since squash merge started. Inspect History before continuing or aborting."
			);

		await context.process.run({
			cwd: context.repository.root,
			args:
				input.kind === "continue"
					? ["commit", "--no-edit"]
					: ["reset", "--merge", original],
		});

		await rm(join(context.repository.gitDirectory, "SQUASH_MSG"), {
			force: true,
		});
	}
}
