import type { ReactElement, ReactNode } from "react";
import {
	RepositoryDiffWorkspace,
	type RepositoryDiffWorkspaceProps,
} from "@/fixture/repository-workspace/components/repository-diff-workspace.js";
import {
	RepositoryNavigationRail,
	type RepositoryNavigationRailProps,
} from "@/fixture/repository-workspace/components/repository-navigation-rail.js";

export type RepositoryWorkspaceProps = RepositoryDiffWorkspaceProps &
	RepositoryNavigationRailProps & {
		readonly titlebar: ReactNode;
	};

export function RepositoryWorkspace({
	titlebar,
	...props
}: RepositoryWorkspaceProps): ReactElement {
	return (
		<section
			className="flex min-h-0 flex-1 overflow-hidden bg-transparent"
			data-name="RepositoryWorkspace"
			id="repository-workspace"
		>
			<div className="flex min-w-0 flex-1 flex-col">
				{titlebar}
				<RepositoryDiffWorkspace {...props} />
			</div>
			<RepositoryNavigationRail {...props} />
		</section>
	);
}
