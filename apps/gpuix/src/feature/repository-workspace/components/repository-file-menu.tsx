import { typography, spacing } from "@1git/design-tokens";
import { useRef, useState, type ReactNode } from "react";
import { useGpuixRequired, type EventPayload } from "@gpuix/react";
import { GitIgnore, type IgnoreRule } from "@1git/git";
import { appTokens } from "../../../styles/tokens";
import {
	RepositoryFileActions,
	type FileDiscardRequest,
	type FileIgnoreRequest,
} from "../lib/repository-file-actions";
import { NativeFileMenu, type NativeMenuItem } from "../lib/native-file-menu";
import type { WorkspaceEntry } from "../types";
import type { ExternalEditors } from "../../editor-settings/external-editors";

const finderApplication = "/System/Library/CoreServices/Finder.app";

/** Live Changes actions, supplied by the window-owned mutation boundary. */
export interface FileMenuActions {
	root: string;
	head: string | null;
	branch: string | null;
	disabled: boolean;
	canDiscard: boolean;
	discard: (request: FileDiscardRequest) => Promise<string | null>;
	ignore?: (request: FileIgnoreRequest) => Promise<string | null>;
	open?: typeof RepositoryFileActions.open;
	editors?: ExternalEditors;
	selection?: (id: string) => readonly WorkspaceEntry[];
	include?: (ids: readonly string[], included: boolean) => void;
}

type FileMenuChoice =
	| { kind: "ignore"; rule: IgnoreRule }
	| { kind: "editor"; application?: string | null }
	| { kind: "other-editor" }
	| {
			kind:
				| "discard"
				| "include"
				| "exclude"
				| "finder"
				| "default"
				| "copy"
				| "copy-full";
	  };

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

			const item = (
				label: string,
				value: FileMenuChoice,
				available = true,
				iconPath?: string
			): NativeMenuItem<FileMenuChoice> => ({
				label,
				value,
				enabled: !disabled && available,
				iconPath,
			});

			const menu: NativeMenuItem<FileMenuChoice>[] = [
				item(
					multiple
						? `Discard changes to ${files.length} files…`
						: "Discard Changes…",
					{ kind: "discard" },
					canDiscard
				),
			];

			if (!multiple) {
				const canIgnore =
					!!actions.ignore &&
					actions.canDiscard &&
					file.recordType !== "unmerged";

				const folders = GitIgnore.folders(file.path);
				const extension = GitIgnore.extension(file.path);

				menu.push(
					{ separator: true },
					item(
						"Ignore File (Add to .gitignore)",
						{ kind: "ignore", rule: { kind: "file" } },
						canIgnore
					),
					{
						label: "Ignore Folder (Add to .gitignore)",
						enabled: !disabled && canIgnore && folders.length > 0,
						children: folders.map((path) => ({
							label: `/${path}`,
							enabled: true,
							value: { kind: "ignore", rule: { kind: "folder", path } },
						})),
					}
				);

				if (extension)
					menu.push(
						item(
							`Ignore All ${extension} Files (Add to .gitignore)`,
							{ kind: "ignore", rule: { kind: "extension" } },
							canIgnore
						)
					);
			}

			menu.push(
				{ separator: true },
				item(multiple ? "Copy Full Paths" : "Copy Full Path", {
					kind: "copy-full",
				}),
				item(multiple ? "Copy Relative Paths" : "Copy Relative Path", {
					kind: "copy",
				})
			);

			if (!multiple) {
				const exists = file.worktreeStatus !== "deleted";
				let editors: ReturnType<ExternalEditors["menu"]> | undefined;

				try {
					editors = actions.editors?.menu(file.path);
				} catch (cause) {
					// A damaged editor preference must not hide unrelated file actions.
					setError(
						cause instanceof Error
							? cause.message
							: "Could not load editor defaults."
					);
				}

				const application = editors?.applications.find(
					(app) => app.path === editors.selected
				);

				menu.push(
					{ separator: true },
					item(
						"Reveal in Finder",
						{ kind: "finder" },
						exists,
						finderApplication
					),
					item(
						application ? `Open in ${application.name}` : "Open in Editor",
						{ kind: "editor" },
						exists,
						application?.available ? application.path : undefined
					),
					{
						label: "Open With",
						enabled: !disabled && exists,
						children: [
							{
								label: `System default${editors?.selected === null ? " (Default)" : ""}`,
								enabled: true,
								value: { kind: "editor", application: null },
							},
							...(editors?.applications ?? []).map((app) => ({
								label: `${app.name}${app.path === editors?.selected ? " (Default)" : ""}${app.available ? "" : " — Unavailable"}`,
								enabled: app.available,
								iconPath: app.available ? app.path : undefined,
								value: { kind: "editor" as const, application: app.path },
							})),
							{
								label: "Other application…",
								enabled: true,
								value: { kind: "other-editor" },
							},
						],
					},
					item("Open with Default App", { kind: "default" }, exists)
				);
			}

			menu.push(
				{ separator: true },
				item(
					multiple
						? `Include ${files.length} files in commit`
						: "Include File in Commit",
					{ kind: "include" },
					!!actions.include
				),
				item(
					multiple
						? `Exclude ${files.length} files from commit`
						: "Exclude File from Commit",
					{ kind: "exclude" },
					!!actions.include
				)
			);
			const choice = NativeFileMenu.showItems(
				renderer,
				menu,
				event.x ?? bounds?.x ?? 0,
				event.y ?? (bounds ? bounds.y + bounds.height : 0)
			);

			if (!choice) return;

			if (choice.kind === "discard") {
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
			} else if (choice.kind === "ignore") {
				if (
					!NativeFileMenu.confirmIgnore(
						renderer,
						GitIgnore.pattern(file.path, choice.rule)
					)
				)
					return;

				setError(
					(await actions.ignore?.({
						kind: "ignore",
						path: file.path,
						rule: choice.rule,
						expectedHead: actions.head,
						expectedBranch: actions.branch,
					})) ?? null
				);
			} else if (choice.kind === "include" || choice.kind === "exclude") {
				actions.include?.(
					selected.map((item) => item.id),
					choice.kind === "include"
				);
			} else if (
				choice.kind === "other-editor" ||
				(choice.kind === "editor" && choice.application !== undefined)
			) {
				let application =
					choice.kind === "editor" ? choice.application : undefined;

				if (choice.kind === "other-editor") {
					if (!renderer.promptForPaths)
						throw new Error("Application selection is unavailable.");

					const picked = await renderer.promptForPaths({
						files: true,
						directories: false,
						multiple: false,
						prompt: "Choose editor application",
					});

					if (!picked?.[0]) return;

					application = picked[0];
				}

				await (actions.open ?? RepositoryFileActions.open)(
					actions.root,
					file.path,
					"editor",
					application
				);
			} else {
				await (actions.open ?? RepositoryFileActions.open)(
					actions.root,
					multiple && (choice.kind === "copy" || choice.kind === "copy-full")
						? paths
						: file.path,
					choice.kind
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
