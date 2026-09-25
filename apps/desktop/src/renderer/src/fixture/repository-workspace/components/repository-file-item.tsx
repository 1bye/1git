import { cn } from "@1git/ui/lib/utils";
import type { ReactElement } from "react";

import { OverflowingLabel } from "@/fixture/overflowing-label/components/overflowing-label.js";
import { splitRepositoryFilePath } from "@/fixture/repository-workspace/lib/repository-navigation.js";

interface RepositoryFilePathProps {
	readonly className?: string;
	readonly deferUntilVisible?: boolean;
	readonly path: string;
}

export function RepositoryFilePath({
	className,
	deferUntilVisible = true,
	path,
}: RepositoryFilePathProps): ReactElement {
	const parts = splitRepositoryFilePath(path);

	return (
		<OverflowingLabel
			className={cn("min-w-0 flex-1 text-[11px]", className)}
			deferUntilVisible={deferUntilVisible}
			direction="end-to-start"
			title={path}
		>
			{parts.directory ? (
				<span className="text-editor-muted/75">{parts.directory}</span>
			) : null}
			<span className="font-medium text-editor-ink">{parts.name}</span>
		</OverflowingLabel>
	);
}

interface RepositoryFileStatsProps {
	readonly addedLines: number | null | undefined;
	readonly className?: string;
	readonly deletedLines: number | null | undefined;
	readonly unavailableLabel?: string;
}

export function RepositoryFileStats({
	addedLines,
	className,
	deletedLines,
	unavailableLabel,
}: RepositoryFileStatsProps): ReactElement | null {
	const addedLabel = addedLines ?? unavailableLabel;
	const deletedLabel = deletedLines ?? unavailableLabel;
	if (addedLabel === undefined && deletedLabel === undefined) {
		return null;
	}

	return (
		<span
			className={cn(
				"grid w-[9ch] shrink-0 grid-cols-2 items-center font-medium font-mono text-[9px] tabular-nums",
				className
			)}
		>
			<span className="text-right text-[#1a7f37]">
				{addedLabel === undefined ? null : `+${addedLabel}`}
			</span>
			<span className="text-right text-[#cf222e]">
				{deletedLabel === undefined ? null : `−${deletedLabel}`}
			</span>
		</span>
	);
}
