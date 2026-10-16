import { LocalRepositorySetup } from "./repository-setup-local";
import type { Accounts } from "../../accounts/lib/accounts";
import type { SavedAccount } from "../../accounts/lib/account-store";
import type { RepositoryRef } from "@1git/hosting/contracts";
import { MachineLocation } from "../../machines/machine-location";
import { Machines } from "../../machines/machines";
import { isRecord } from "../../machines/remote-protocol";

/** Explicit setup intent; selecting a destination alone never writes Git. */
export type RepositorySetupRequest =
	| {
			kind: "clone";
			path: string;
			remoteUrl: string;
			source?: { account: SavedAccount; repository: RepositoryRef };
	  }
	| { kind: "create"; path: string; branch: string };

/** Existing repositories require a separate Open action, never implicit reinitialization. */
export type RepositorySetupResult =
	| { ok: true; path: string }
	| { ok: false; message: string; openPath?: string };

/** Validates destinations and delegates setup to the existing Git boundary. Never deletes folders. */
export class RepositorySetup {
	private constructor() {}

	static folderName(remote: string): string {
		return LocalRepositorySetup.folderName(remote);
	}

	static async write(
		request: RepositorySetupRequest,
		signal: AbortSignal,
		accounts?: Accounts
	): Promise<RepositorySetupResult> {
		try {
			const remote = MachineLocation.parse(request.path);

			if (remote) {
				if (request.kind === "clone" && request.source)
					return {
						ok: false,
						message: "Use a repository URL and this machine's Git credentials.",
					};

				const result = await Machines.shared.request(
					request.path,
					request.kind === "clone"
						? { operation: "clone", remoteUrl: request.remoteUrl.trim() }
						: { operation: "initialize", branch: request.branch },
					signal
				);

				if (
					isRecord(result) &&
					result.ok === true &&
					typeof result.path === "string"
				)
					return {
						ok: true,
						path: MachineLocation.encode(remote.machineId, result.path),
					};

				if (
					isRecord(result) &&
					result.ok === false &&
					typeof result.message === "string"
				)
					return {
						ok: false,
						message: result.message,
						...(typeof result.openPath === "string"
							? {
									openPath: MachineLocation.encode(
										remote.machineId,
										result.openPath
									),
								}
							: {}),
					};

				throw new Error("Invalid remote repository setup response.");
			}

			return await LocalRepositorySetup.write(request, signal, accounts);
		} catch (cause) {
			return {
				ok: false,
				message:
					MachineLocation.isRemote(request.path) && cause instanceof Error
						? cause.message
						: "Could not prepare this folder. Check its location and permissions.",
			};
		}
	}
}
