import type { GitResult } from "@1git/git";
import { MachineLocation } from "../../machines/machine-location";
import { Machines } from "../../machines/machines";
import { isRecord } from "../../machines/remote-protocol";
import {
	LocalRepositoryWorktrees,
	type WorktreeRequest,
	type WorktreeRemoval,
} from "./repository-worktrees-local";
export type {
	WorktreeChoice,
	WorktreeRequest,
	WorktreeRemoval,
} from "./repository-worktrees-local";

/** Routes guarded worktree setup to the filesystem that owns the repository. */
export class RepositoryWorktrees {
	private constructor() {}

	static branchNameError(name: string): string | null {
		return LocalRepositoryWorktrees.branchNameError(name);
	}

	static async remove(
		root: string,
		request: WorktreeRemoval
	): Promise<GitResult<string>> {
		return await LocalRepositoryWorktrees.remove(root, request);
	}

	static async create(
		root: string,
		request: WorktreeRequest
	): Promise<GitResult<string>> {
		const fail = (message: string): GitResult<never> => ({
			ok: false,
			error: {
				code: "conflict",
				operation: "create-worktree",
				retryable: false,
				message,
			},
		});

		try {
			const remote = MachineLocation.parse(root);

			if (remote) {
				const destination = MachineLocation.parse(request.path);

				if (destination?.machineId !== remote.machineId)
					return fail("Choose a destination on the same SSH machine.");

				const result = await Machines.shared.request(root, {
					operation: "create-worktree",
					input: { ...request, path: destination.path },
				});

				if (
					isRecord(result) &&
					result.ok === true &&
					typeof result.value === "string"
				)
					return {
						ok: true,
						value: MachineLocation.encode(remote.machineId, result.value),
					};

				if (
					isRecord(result) &&
					result.ok === false &&
					isRecord(result.error) &&
					typeof result.error.message === "string"
				)
					return fail(result.error.message);

				return fail("Invalid remote worktree response.");
			}
		} catch (cause) {
			return fail(
				cause instanceof Error
					? cause.message
					: "Could not create the remote worktree."
			);
		}

		if (MachineLocation.isRemote(request.path))
			return fail("Choose a local destination for this repository.");

		return await LocalRepositoryWorktrees.create(root, request);
	}
}
