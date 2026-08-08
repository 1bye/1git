import type { ReactElement, ReactNode } from "react";
import {
	AdaptiveRepositoryWorkspace,
	type AdaptiveRepositoryWorkspaceProps,
} from "@/fixture/repository-workspace/components/adaptive-repository-workspace.js";
import {
	RepositoryNavigationRail,
	type RepositoryNavigationRailProps,
} from "@/fixture/repository-workspace/components/repository-navigation-rail.js";

export type RepositoryWorkspaceProps = AdaptiveRepositoryWorkspaceProps &
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
				<AdaptiveRepositoryWorkspace {...props} />
			</div>
			<RepositoryNavigationRail {...props} />
		</section>
	);
}
