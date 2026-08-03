import type { ReactElement } from "react";
import {
	AdaptiveRepositoryWorkspace,
	type AdaptiveRepositoryWorkspaceProps,
} from "@/fixture/repository-workspace/components/adaptive-repository-workspace.js";

export type RepositoryWorkspaceProps = AdaptiveRepositoryWorkspaceProps;

export function RepositoryWorkspace(
	props: RepositoryWorkspaceProps
): ReactElement {
	return <AdaptiveRepositoryWorkspace {...props} />;
}
