import type { ReactElement, ReactNode, Ref } from "react";
import { useState } from "react";
import {
	RepositoryDiffWorkspace,
	type RepositoryDiffWorkspaceProps,
} from "@/fixture/repository-workspace/components/repository-diff-workspace.js";
import { RepositoryFileLiquidSurface } from "@/fixture/repository-workspace/components/repository-file-liquid-surface.js";
import {
	RepositoryNavigationRail,
	type RepositoryNavigationRailProps,
} from "@/fixture/repository-workspace/components/repository-navigation-rail.js";

export type RepositoryWorkspaceProps = RepositoryDiffWorkspaceProps &
	Omit<
		RepositoryNavigationRailProps,
		"isRevisionDetailOpen" | "onRevisionDetailOpenChange"
	> & {
		readonly ref?: Ref<HTMLElement>;
		readonly titlebar: ReactNode;
	};

interface RevisionDetailState {
	readonly contextKey: string;
	readonly isOpen: boolean;
}

export function RepositoryWorkspace({
	ref,
	selectedFilePath,
	titlebar,
	...props
}: RepositoryWorkspaceProps): ReactElement {
	const revisionContextKey = `${props.activeSession.id}:${props.tab}`;
	const [revisionDetail, setRevisionDetail] = useState<RevisionDetailState>({
		contextKey: revisionContextKey,
		isOpen: false,
	});
	const isRevisionDetailOpen =
		revisionDetail.contextKey === revisionContextKey &&
		revisionDetail.isOpen &&
		props.tab !== "changes";
	const changeRevisionDetailOpen = (isOpen: boolean): void => {
		setRevisionDetail({ contextKey: revisionContextKey, isOpen });
	};

	return (
		<section
			className="relative isolate flex min-h-0 flex-1 overflow-hidden bg-transparent"
			data-name="RepositoryWorkspace"
			id="repository-workspace"
			ref={ref}
		>
			<RepositoryFileLiquidSurface
				railKind={props.tab === "changes" ? "changes" : "revision"}
				railState={
					props.tab === "changes" || isRevisionDetailOpen ? "open" : "closed"
				}
				selectedFilePath={selectedFilePath}
			/>
			<div className="flex min-w-0 flex-1 flex-col">
				{titlebar}
				<RepositoryDiffWorkspace
					{...props}
					selectedFilePath={selectedFilePath}
				/>
			</div>
			<RepositoryNavigationRail
				{...props}
				isRevisionDetailOpen={isRevisionDetailOpen}
				onRevisionDetailOpenChange={changeRevisionDetailOpen}
				selectedFilePath={selectedFilePath}
			/>
		</section>
	);
}
