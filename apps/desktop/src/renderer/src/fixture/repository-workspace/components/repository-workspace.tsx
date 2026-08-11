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
import { RepositoryRevisionFileRail } from "@/fixture/repository-workspace/components/repository-revision-rail.js";

export type RepositoryWorkspaceProps = RepositoryDiffWorkspaceProps &
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
				<div className="flex min-h-0 min-w-0 flex-1">
					<RepositoryDiffWorkspace
						{...props}
						selectedFilePath={selectedFilePath}
					/>
					<RepositoryRevisionFileRail
						diffs={props.diffs}
						isPending={props.pendingAction !== null}
						onApplyStash={props.onApplyStash}
						onDropStash={props.onDropStash}
						onPopStash={props.onPopStash}
						onSelectFile={props.onSelectRevisionFile}
						selectedFilePath={selectedFilePath}
						selectedStash={selectedStash}
						tab={props.tab}
					/>
				</div>
			</div>
			<RepositoryNavigationRail
				{...props}
				selectedFilePath={selectedFilePath}
			/>
		</section>
	);
}
