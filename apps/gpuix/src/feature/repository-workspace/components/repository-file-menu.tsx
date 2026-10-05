import { typography, spacing } from "@1git/design-tokens";
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
	selection?: (id: string) => readonly WorkspaceEntry[];
	include?: (ids: readonly string[], included: boolean) => void;
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
			const selected = actions.selection?.(entry.id) ?? [entry];

			const files = selected.flatMap((item) =>
				item.change ? [item.change] : []
			);

			if (!files.length) return;

			const paths = files.map((item) => item.path);
			const multiple = files.length > 1;

			// Let the row selection paint before AppKit starts its synchronous tracking loop.
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
			const disabled = actions.disabled;

			const canDiscard =
				actions.canDiscard &&
				files.length === selected.length &&
				files.every(
					(item) =>
						!item.originalPath &&
						!item.submodule.startsWith("S") &&
						item.recordType !== "unmerged" &&
						item.indexStatus !== "type-changed" &&
						item.worktreeStatus !== "type-changed"
				);

			const bounds = renderer.getElementBounds?.(event.elementId);

			const enabled = multiple
				? [
						!disabled && !!actions.include,
						!disabled && !!actions.include,
						!disabled,
						!disabled && canDiscard,
					]
				: [
						!disabled && file.worktreeStatus !== "deleted",
						!disabled && file.worktreeStatus !== "deleted",
						!disabled,
						!disabled && canDiscard,
						!disabled && !!actions.include,
						!disabled && !!actions.include,
					];

			const choice = NativeFileMenu.show(
				renderer,
				multiple
					? [
							`Include ${files.length} files in commit`,
							`Exclude ${files.length} files from commit`,
							"Copy relative paths",
							`Discard changes to ${files.length} files…`,
						]
					: [
							"Open in editor",
							"Reveal in Finder",
							"Copy relative path",
							"Discard changes…",
							"Include file in commit",
							"Exclude file from commit",
						],
				enabled,
				event.x ?? bounds?.x ?? 0,
				event.y ?? (bounds ? bounds.y + bounds.height : 0)
			);

			if (choice < 0 || !enabled[choice]) return;

			if (choice === 3) {
				if (
					!NativeFileMenu.confirm(
						renderer,
						multiple ? `${files.length} files` : file.path
					)
				)
					return;

				setError(
					await actions.discard({
						kind: "discard",
						paths,
						expectedHead: actions.head,
						expectedBranch: actions.branch,
					})
				);
			} else if ((multiple && choice < 2) || choice >= 4) {
				actions.include?.(
					selected.map((item) => item.id),
					choice === 0 || choice === 4
				);
			} else {
				const kind = (["editor", "finder", "copy"] as const)[choice];

				if (kind)
					await (actions.open ?? RepositoryFileActions.open)(
						actions.root,
						kind === "copy" ? paths.join("\n") : file.path,
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
					style={{
						...typography.xs,
						color: appTokens.colors.danger,
						padding: spacing[1.5],
					}}
				>
					{error}
				</text>
			) : null}
		</>
	);
}
