import type { BranchInfo } from "@1git/git";
import type { SyncChoice } from "../repository-workspace/lib/repository-sync";

/** Uses the exact configured upstream destination for palette Pull and Push actions. */
export function repositoryPaletteSyncChoice(
	kind: "pull" | "push",
	branch: Pick<BranchInfo, "upstreamRemote" | "upstreamRef">
): SyncChoice | null {
	if (!branch.upstreamRemote || !branch.upstreamRef) return null;

	return {
		kind,
		remote: branch.upstreamRemote,
		remoteRef: branch.upstreamRef,
	};
}
