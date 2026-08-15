import type { ReactElement } from "react";
import type { RepositoryDiffFileEntry } from "@/fixture/repository-workspace/lib/repository-diff-files.js";
import type { RepositoryDiffPreviewKind } from "@/fixture/repository-workspace/lib/repository-diff-preview.js";
import type { RepositorySessionId } from "../../../../../shared/repository-session.js";
import { RepositoryImageDiff } from "./repository-image-diff.js";

interface RepositoryCodeViewPreviewProps {
	readonly entry: RepositoryDiffFileEntry;
	readonly onOpenFile: (path: string) => Promise<void>;
	readonly previewKind: Exclude<RepositoryDiffPreviewKind, "text">;
	readonly sessionId: RepositorySessionId;
}

const previewMessage = (
	entry: RepositoryDiffFileEntry,
	previewKind: Exclude<RepositoryDiffPreviewKind, "image" | "text">
): string => {
	if (previewKind === "large") {
		return "This diff is too large to preview safely.";
	}
	if (previewKind === "binary") {
		return "Binary files cannot be displayed as text.";
	}
	if (previewKind === "rename") {
		return `Renamed from ${entry.file?.prevName ?? "the previous path"}.`;
	}
	if (previewKind === "ignored-whitespace") {
		return "No changes remain when whitespace is ignored.";
	}
	return "No text preview is available for this file.";
};

export function RepositoryCodeViewPreview({
	entry,
	onOpenFile,
	previewKind,
	sessionId,
}: RepositoryCodeViewPreviewProps): ReactElement {
	if (previewKind === "image") {
		return (
			<RepositoryImageDiff
				entry={entry}
				onOpenFile={onOpenFile}
				sessionId={sessionId}
			/>
		);
	}

	return (
		<div className="px-4 py-8 text-center">
			<p className="text-editor-faint text-xss">
				{previewMessage(entry, previewKind)}
			</p>
			{previewKind === "ignored-whitespace" ? null : (
				<button
					className="mt-2 rounded-lg px-2.5 py-1.5 font-medium text-editor-muted text-xss outline-none hover:bg-hover hover:text-editor-ink focus-visible:ring-2 focus-visible:ring-brand/20"
					onClick={() => onOpenFile(entry.path)}
					type="button"
				>
					Open in Zed
				</button>
			)}
		</div>
	);
}
