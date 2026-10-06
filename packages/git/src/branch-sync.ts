import type { SyncBranchInput, SyncResult } from "./contracts.js";
import type { RepositoryContext } from "./internal.js";
import { loadBranches, loadRemotes, loadSnapshot } from "./queries.js";
import { invalidInput } from "./result.js";
import { validateHttpAuthentication } from "./http-authentication.js";

/** Single-branch UI sync; callers own serialization, credentials and cancellation. */
export class BranchSync {
	private constructor() {}

	static async run(
		context: RepositoryContext,
		input: SyncBranchInput
	): Promise<SyncResult> {
		const operation = input.kind === "pull" ? "pull" : "push";
		const { signal } = input;
		const snapshot = await loadSnapshot(context, false, signal);
		const { head } = snapshot;

		if (
			!head.oid ||
			!head.branch ||
			head.detached ||
			head.unborn ||
			head.oid !== input.expectedHead ||
			head.branch !== input.expectedBranch
		)
			throw invalidInput(
				operation,
				"The branch changed or has no commit. Refresh before synchronizing."
			);

		if (snapshot.operationState !== "normal")
			throw invalidInput(
				operation,
				"Finish the current Git operation before synchronizing.",
				"conflict"
			);

		if (
			input.kind === "pull" &&
			snapshot.files.some((file) => file.recordType !== "ignored")
		)
			throw invalidInput(
				operation,
				"Commit or stash your changes before pulling. Nothing has been changed.",
				"dirty-worktree"
			);

		const [branches, remotes] = await Promise.all([
			loadBranches(context, signal),
			loadRemotes(context, signal),
		]);

		const branch = branches.branches.find(
			(item) => item.type === "local" && item.name === head.branch
		);

		const remote = remotes.find((item) => item.name === input.remote);

		if (
			!branch ||
			branch.oid !== head.oid ||
			!remote ||
			!input.remoteRef.startsWith("refs/heads/")
		)
			throw invalidInput(
				operation,
				"The selected remote or branch is unavailable. Reopen the menu and retry."
			);

		if (input.kind === "publish") {
			if (
				branch.upstream ||
				branch.upstreamRemote ||
				input.remoteRef !== `refs/heads/${head.branch}`
			)
				throw invalidInput(
					operation,
					"Tracking changed. Reopen the menu before publishing this branch."
				);
		} else if (
			branch.upstreamRemote !== input.remote ||
			branch.upstreamRef !== input.remoteRef
		) {
			throw invalidInput(
				operation,
				"The upstream changed. Reopen the menu before synchronizing."
			);
		}

		if (input.kind === "pull" && branch.ahead > 0 && branch.behind > 0)
			throw invalidInput(
				operation,
				"Branches have diverged. Resolve the divergence before pulling; no merge or rebase was started.",
				"conflict"
			);

		if (input.kind !== "pull" && remote.pushUrls.length !== 1)
			throw invalidInput(
				operation,
				"This remote has multiple push destinations. Configure a single push URL before using this action."
			);

		if (input.httpAuthentication)
			validateHttpAuthentication(
				input.httpAuthentication,
				input.kind === "pull" ? remote.fetchUrls : remote.pushUrls,
				operation
			);

		await context.process.run({
			args: ["check-ref-format", input.remoteRef],
			cwd: context.repository.root,
			signal,
		});
		// Explicit flags/refspecs override repository defaults that could merge, stash, mirror or push other refs.
		const args =
			input.kind === "pull"
				? [
						"pull",
						"--ff-only",
						"--no-rebase",
						"--no-autostash",
						"--recurse-submodules=no",
						"--",
						remote.name,
						input.remoteRef,
					]
				: [
						"-c",
						`remote.${remote.name}.mirror=false`,
						"push",
						"--no-force",
						"--no-mirror",
						"--no-follow-tags",
						"--recurse-submodules=no",
						...(input.kind === "publish" ? ["--set-upstream"] : []),
						"--",
						remote.name,
						`${input.kind === "publish" ? branch.fullName : head.oid}:${input.remoteRef}`,
					];

		await context.process.run({
			args,
			cwd: context.repository.root,
			signal,
			httpAuthentication: input.httpAuthentication,
		});
		const updated = await loadSnapshot(context, false, signal);

		return {
			operation,
			remote: remote.name,
			branch: updated.head.branch,
			snapshot: updated,
		};
	}
}
