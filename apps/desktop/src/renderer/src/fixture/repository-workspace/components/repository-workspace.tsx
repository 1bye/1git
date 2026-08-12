import type { ReactElement, ReactNode, Ref } from "react";
import {
	RepositoryDiffWorkspace,
	type RepositoryDiffWorkspaceProps,
} from "@/fixture/repository-workspace/components/repository-diff-workspace.js";
import { RepositoryFileLiquidSurface } from "@/fixture/repository-workspace/components/repository-file-liquid-surface.js";
import {
	RepositoryNavigationRail,
	type RepositoryNavigationRailProps,
} from "@/fixture/repository-workspace/components/repository-navigation-rail.js";

export type RepositoryWorkspaceProps = Omit<
	RepositoryDiffWorkspaceProps,
	"selectedStash"
> &
	RepositoryNavigationRailProps & {
		readonly ref?: Ref<HTMLElement>;
		readonly titlebar: ReactNode;
	};

export function RepositoryWorkspace({
	ref,
	selectedFilePath,
	titlebar,
	...props
}: RepositoryWorkspaceProps): ReactElement {
	const selectedStash =
		props.stashes.find((stash) => stash.oid === props.selectedStashOid) ?? null;

	return (
		<section
			className="relative isolate flex min-h-0 flex-1 overflow-hidden bg-transparent"
			data-name="RepositoryWorkspace"
			id="repository-workspace"
			ref={ref}
		>
			<RepositoryFileLiquidSurface selectedFilePath={selectedFilePath} />
			<div className="flex min-w-0 flex-1 flex-col">
				{titlebar}
				<RepositoryDiffWorkspace
					{...props}
					selectedFilePath={selectedFilePath}
					selectedStash={selectedStash}
				/>
			</div>
			<RepositoryNavigationRail
				{...props}
				selectedFilePath={selectedFilePath}
			/>
		</section>
	);
}
