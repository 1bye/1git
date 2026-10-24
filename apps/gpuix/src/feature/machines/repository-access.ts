import {
	GitRepository as LocalRepository,
	type GitResult,
	type OpenRepositoryInput,
} from "@1git/git";
import { MachineLocation } from "./machine-location";
import { Machines } from "./machines";
import { isRecord, remoteGitMethods } from "./remote-protocol";
import { ShellEnvironment } from "../../shell-environment";

/** Preserves the shared public Git contract at the validated, versioned SSH boundary. */
export type GitRepository = LocalRepository;

const failure = (cause: unknown): GitResult<never> => ({
	ok: false,
	error: {
		code: "command-failed",
		operation: "open-repository",
		retryable: false,
		message:
			cause instanceof Error
				? cause.message
				: "Remote repository operation failed.",
	},
});

/** Converts only absolute storage paths; Git file paths, patches, config and commit messages stay byte-for-byte unchanged. */
function qualify(value: unknown, id: string): unknown {
	if (Array.isArray(value)) return value.map((item) => qualify(item, id));

	if (!isRecord(value)) return value;

	const info =
		typeof value.root === "string" &&
		typeof value.gitDirectory === "string" &&
		typeof value.commonDirectory === "string";

	const worktree = "headOid" in value && "prunable" in value && "path" in value;

	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => {
			if (
				typeof item === "string" &&
				item.startsWith("/") &&
				((info && ["root", "gitDirectory", "commonDirectory"].includes(key)) ||
					(worktree && key === "path") ||
					key === "worktreePath" ||
					key === "recoveryDirectory")
			)
				return [key, MachineLocation.encode(id, item)];

			return [key, qualify(item, id)];
		})
	);
}

function wire(value: unknown, id: string, key?: string): unknown {
	if (
		typeof value === "string" &&
		key &&
		["path", "paths", "directory"].includes(key) &&
		MachineLocation.isRemote(value)
	) {
		const remote = MachineLocation.parse(value);

		if (remote?.machineId !== id)
			throw new Error("Repository paths must belong to the same machine.");

		return remote.path;
	}

	if (Array.isArray(value)) return value.map((item) => wire(item, id, key));

	if (!isRecord(value)) return value;

	return Object.fromEntries(
		Object.entries(value)
			.filter(
				([key, item]) =>
					key !== "signal" &&
					key !== "onProgress" &&
					key !== "httpAuthentication" &&
					typeof item !== "function"
			)
			.map(([key, item]) => [key, wire(item, id, key)])
	);
}

/** Routes all existing UI Git operations to local Git or a saved SSH machine. No remote path reaches local Git. */
export const GitRepository = {
	async initialize(
		input: Parameters<typeof LocalRepository.initialize>[0]
	): ReturnType<typeof LocalRepository.initialize> {
		if (MachineLocation.isRemote(input.path))
			return failure(
				new Error(
					"Create repositories on the SSH machine, then open them here."
				)
			);

		await ShellEnvironment.shared.prepare();

		return await LocalRepository.initialize(input);
	},
	async clone(
		input: Parameters<typeof LocalRepository.clone>[0]
	): ReturnType<typeof LocalRepository.clone> {
		if (MachineLocation.isRemote(input.path))
			return failure(
				new Error("Clone repositories on the SSH machine, then open them here.")
			);

		await ShellEnvironment.shared.prepare();

		return await LocalRepository.clone(input);
	},
	async open(input: OpenRepositoryInput): Promise<GitResult<LocalRepository>> {
		if (!MachineLocation.isRemote(input.path)) {
			await ShellEnvironment.shared.prepare();

			return await LocalRepository.open(input);
		}

		try {
			const remote = MachineLocation.parse(input.path);

			if (!remote) throw new Error("Invalid remote repository.");

			const info = await Machines.shared.request(
				input.path,
				{ operation: "open", maxOutputBytes: input.runtime?.maxOutputBytes },
				input.signal
			);

			if (
				!isRecord(info) ||
				typeof info.root !== "string" ||
				!info.root.startsWith("/") ||
				typeof info.gitDirectory !== "string" ||
				!info.gitDirectory.startsWith("/") ||
				typeof info.commonDirectory !== "string" ||
				!info.commonDirectory.startsWith("/") ||
				typeof info.isBare !== "boolean" ||
				typeof info.isShallow !== "boolean"
			)
				throw new Error("Invalid remote repository metadata.");

			// The proxy implements exactly the allowlisted public methods of GitRepository; private local process state never crosses SSH.
			const repository = new Proxy(
				{ info: qualify(info, remote.machineId) },
				{
					get(target, property) {
						if (property === "info") return target.info;

						if (!remoteGitMethods.some((method) => method === property))
							return undefined;

						return async (...args: unknown[]): Promise<unknown> => {
							try {
								const options = args.find(
									(arg) =>
										isRecord(arg) && ("signal" in arg || "onProgress" in arg)
								);

								const signal =
									isRecord(options) && options.signal instanceof AbortSignal
										? options.signal
										: undefined;

								const observer =
									isRecord(options) && typeof options.onProgress === "function"
										? options.onProgress
										: undefined;

								const result = await Machines.shared.request(
									input.path,
									{
										operation: "call",
										method: property,
										args: wire(args, remote.machineId),
										maxOutputBytes: input.runtime?.maxOutputBytes,
									},
									signal,
									observer ? (value) => observer(value) : undefined
								);

								if (
									!isRecord(result) ||
									typeof result.ok !== "boolean" ||
									(result.ok && !("value" in result)) ||
									(!result.ok && !isRecord(result.error))
								)
									throw new Error("Invalid remote Git result.");

								return qualify(result, remote.machineId);
							} catch (cause) {
								return failure(cause);
							}
						};
					},
				}
			) as LocalRepository;

			return { ok: true, value: repository };
		} catch (cause) {
			return failure(cause);
		}
	},
};

/** Qualifies application-level recovery metadata returned by the helper. */
export const qualifyRemoteResult = qualify;
