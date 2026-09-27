import { useRef, useState, type ReactNode } from "react";
import { useGpuixRequired, type EventPayload } from "@gpuix/react";
import { appTokens } from "../../../styles/tokens";
import {
	RepositoryFileActions,
	type FileDiscardRequest,
} from "../lib/repository-file-actions";
import { NativeFileMenu } from "../lib/native-file-menu";
import type { WorkspaceEntry } from "../types";

/** Live Changes actions, supplied by the window-owned mutation boundary. */
export interface FileMenuActions {
	root: string;
	head: string | null;
	branch: string | null;
	disabled: boolean;
	canDiscard: boolean;
	discard: (request: FileDiscardRequest) => Promise<string | null>;
	open?: typeof RepositoryFileActions.open;
}

/** AppKit context menu only: no on-screen trigger or custom floating surface. */
export function RepositoryFileMenu({
	entry,
	actions,
	children,
}: {
	entry: WorkspaceEntry;
	actions: FileMenuActions;
	children: (openMenu: (event: EventPayload) => void) => ReactNode;
}) {
	const renderer = useGpuixRequired();
	const pending = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const file = entry.change;

	const openMenu = async (event: EventPayload) => {
		if (!file || pending.current) return;

		pending.current = true;
		setError(null);

		try {
			const disabled = actions.disabled;
			const canDiscard =
				actions.canDiscard &&
				!file.originalPath &&
				!file.submodule.startsWith("S") &&
				file.recordType !== "unmerged" &&
				file.indexStatus !== "type-changed" &&
				file.worktreeStatus !== "type-changed";
			const bounds = renderer.getElementBounds?.(event.elementId);
			const enabled = [
				!disabled && file.worktreeStatus !== "deleted",
				!disabled && file.worktreeStatus !== "deleted",
				!disabled,
				!disabled && canDiscard,
			];

			const choice = NativeFileMenu.show(
				renderer,
				[
					"Open in editor",
					"Reveal in Finder",
					"Copy relative path",
					"Discard changes…",
				],
				enabled,
				event.x ?? bounds?.x ?? 0,
				event.y ?? (bounds ? bounds.y + bounds.height : 0)
			);

			if (choice < 0 || !enabled[choice]) return;

			if (choice === 3) {
				if (!NativeFileMenu.confirm(renderer, file.path)) return;

				setError(
					await actions.discard({
						kind: "discard",
						path: file.path,
						expectedHead: actions.head,
						expectedBranch: actions.branch,
					})
				);
			} else {
				const kind = (["editor", "finder", "copy"] as const)[choice];

				if (kind)
					await (actions.open ?? RepositoryFileActions.open)(
						actions.root,
						file.path,
						kind
					);
			}
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "File action failed. Refresh before retrying."
			);
		} finally {
			pending.current = false;
		}
	};

	return (
		<>
			{children((event) => {
				void openMenu(event);
			})}
			{error ? (
				<text
					role="alert"
					style={{ fontSize: 10, color: appTokens.colors.danger, padding: 6 }}
				>
					{error}
				</text>
			) : null}
		</>
	);
}
