import type { FileChange, FileStatus } from "@1git/git";
import { cn } from "@1git/ui/lib/utils";
import type { ReactElement } from "react";
import { getFileChangeStatus } from "@/feature/workspace/lib/workspace-model.js";

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

const STATUS_SYMBOLS: Readonly<Record<FileStatus, string>> = {
	added: "+",
	copied: "→",
	deleted: "−",
	ignored: "·",
	modified: "•",
	renamed: "→",
	"type-changed": "•",
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
	return (
		<span
			aria-hidden
			className={cn(
				"inline-flex size-4 shrink-0 items-center justify-center rounded-[3px] border-[1.5px] font-mono font-semibold text-[11px] leading-none",
				STATUS_CLASS_NAMES[status],
				className
			)}
			title={status}
		>
			{STATUS_SYMBOLS[status]}
		</span>
	);
}
