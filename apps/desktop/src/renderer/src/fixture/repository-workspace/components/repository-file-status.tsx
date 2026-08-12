import type { FileChange, FileStatus } from "@1git/git";
import { cn } from "@1git/ui/lib/utils";
import type { ReactElement } from "react";
import {
	getFileChangeStatus,
	isFilePartiallyStaged,
} from "@/feature/workspace/lib/workspace-model.js";

const STATUS_CLASS_NAMES: Readonly<Record<FileStatus, string>> = {
	added: "border-[#1a7f37] text-[#1a7f37]",
	copied: "border-[#0969da] text-[#0969da]",
	deleted: "border-[#cf222e] text-[#cf222e]",
	ignored: "border-editor-faint text-editor-faint",
	modified: "border-[#9a7600] text-[#9a7600]",
	renamed: "border-[#0969da] text-[#0969da]",
	"type-changed": "border-[#9a7600] text-[#9a7600]",
	unmerged: "border-[#bc4c00] text-[#bc4c00]",
	unmodified: "border-editor-faint text-editor-faint",
	untracked: "border-[#1a7f37] text-[#1a7f37]",
};

const STATUS_SYMBOLS: Readonly<Record<FileStatus, string | null>> = {
	added: "+",
	copied: "→",
	deleted: "−",
	ignored: null,
	modified: null,
	renamed: "→",
	"type-changed": null,
	unmerged: "!",
	unmodified: "−",
	untracked: "+",
};

interface RepositoryFileStatusProps {
	readonly className?: string;
	readonly file: FileChange;
}

export function RepositoryFileStatus({
	className,
	file,
}: RepositoryFileStatusProps): ReactElement {
	const status = getFileChangeStatus(file);
	const isPartiallyStaged = isFilePartiallyStaged(file);
	return (
		<span
			aria-hidden
			className={cn(
				"relative inline-flex size-3 shrink-0 items-center justify-center rounded-[2px] border font-mono font-semibold text-[9px] leading-none",
				STATUS_CLASS_NAMES[status],
				className
			)}
			data-name="RepositoryFileStatus"
			data-status={status}
			title={isPartiallyStaged ? `${status}, partially staged` : status}
		>
			{STATUS_SYMBOLS[status] ?? (
				<span className="block size-1 rounded-full bg-current" />
			)}
			{isPartiallyStaged ? (
				<span className="absolute -right-0.5 -bottom-0.5 size-1 rounded-full bg-brand ring-1 ring-editor-surface" />
			) : null}
		</span>
	);
}
