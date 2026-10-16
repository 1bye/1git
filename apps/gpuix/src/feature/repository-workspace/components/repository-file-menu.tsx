import { MachineLocation } from "../../machines/machine-location";
import { useAppTheme } from "../../../styles/theme";
import { typography, spacing } from "@1git/design-tokens";
import { useRef, useState, type ReactNode } from "react";
import { useGpuixRequired, type EventPayload } from "@gpuix/react";
import { GitIgnore, type IgnoreRule } from "@1git/git";

import {
	RepositoryFileActions,
	type FileDiscardRequest,
	type FileIgnoreRequest,
} from "../lib/repository-file-actions";
import { NativeFileMenu, type NativeMenuItem } from "../lib/native-file-menu";
import type { WorkspaceEntry } from "../types";
import type { ExternalEditors } from "../../editor-settings/external-editors";
import type { FileHistoryScope } from "../lib/repository-history";

const finderApplication = "/System/Library/CoreServices/Finder.app";

interface FileMenuContext {
	root: string;
	disabled: boolean;
	mutationError?: string | null;
	open?: typeof RepositoryFileActions.open;
	editors?: ExternalEditors;
	selection?: (id: string) => readonly WorkspaceEntry[];
	history?: (file: FileHistoryScope) => void;
}

/** Working-copy mutations or read-only saved versions; revision menus never receive Git write actions. */
export type FileMenuActions = FileMenuContext &
	(
		| {
				kind?: "changes";
				head: string | null;
				branch: string | null;
				canDiscard: boolean;
				discard: (request: FileDiscardRequest) => Promise<string | null>;
				ignore?: (request: FileIgnoreRequest) => Promise<string | null>;
				include?: (ids: readonly string[], included: boolean) => void;
		  }
		| {
				kind: "revision";
				openRevision?: typeof RepositoryFileActions.openRevision;
		  }
	);

const nullObjectId = /^0+$/u;

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
				| "history"
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
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;

	const renderer = useGpuixRequired();
	const pending = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const remote = MachineLocation.isRemote(actions.root);
	const live = actions.kind === "revision" ? null : actions;
	const saved = actions.kind === "revision" ? entry.commitFile : undefined;
	const file = live ? entry.change : saved;

	const openMenu = async (event: EventPayload) => {
		if (!file || pending.current) return;

		pending.current = true;
		setError(null);

		try {
			const selected = actions.selection?.(entry.id) ?? [entry];

			const changes = selected.flatMap((item) =>
				item.change ? [item.change] : []
			);

			const files = live
				? changes
				: selected.flatMap((item) =>
						item.commitFile ? [item.commitFile] : []
					);

			if (!files.length) return;

			const paths = files.map((item) => item.path);
			const multiple = files.length > 1;

			// Let the row selection paint before AppKit starts its synchronous tracking loop.
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
			const disabled = actions.disabled;

			const canDiscard =
				live?.canDiscard &&
				files.length === selected.length &&
				RepositoryFileActions.canDiscard(changes);

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

			const menu: NativeMenuItem<FileMenuChoice>[] = [];

			if (live)
				menu.push(
					item(
						multiple
							? `Discard changes to ${files.length} files…`
							: "Discard Changes…",
						{ kind: "discard" },
						!!canDiscard
					)
				);

			if (!multiple && live && entry.change) {
				const canIgnore =
					!!live.ignore &&
					live.canDiscard &&
					entry.change.recordType !== "unmerged";

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

			if (menu.length) menu.push({ separator: true });

			menu.push(
				item(multiple ? "Copy Full Paths" : "Copy Full Path", {
					kind: "copy-full",
				}),
				item(multiple ? "Copy Relative Paths" : "Copy Relative Path", {
					kind: "copy",
				})
			);

			if (!multiple) {
				if (actions.history)
					menu.push(
						{ separator: true },
						item("View File History", { kind: "history" })
					);

				const exists = saved
					? !nullObjectId.test(saved.afterOid) ||
						!nullObjectId.test(saved.beforeOid)
					: entry.change?.worktreeStatus !== "deleted" && !remote;

				const version = saved
					? nullObjectId.test(saved.afterOid)
						? "Previous Version"
						: "Saved Version"
					: null;

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

				menu.push({ separator: true });

				if (live)
					menu.push(
						item(
							"Reveal in Finder",
							{ kind: "finder" },
							exists && !remote,
							finderApplication
						)
					);

				menu.push(
					item(
						`Open${version ? ` ${version}` : ""} in ${application?.name ?? "Editor"}`,
						{ kind: "editor" },
						exists,
						application?.available ? application.path : undefined
					),
					{
						label: `Open${version ? ` ${version}` : ""} With`,
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
					item(
						`Open${version ? ` ${version}` : ""} with Default App`,
						{ kind: "default" },
						exists
					)
				);
			}

			if (live)
				menu.push(
					{ separator: true },
					item(
						multiple
							? `Include ${files.length} files in commit`
							: "Include File in Commit",
						{ kind: "include" },
						!!live.include
					),
					item(
						multiple
							? `Exclude ${files.length} files from commit`
							: "Exclude File from Commit",
						{ kind: "exclude" },
						!!live.include
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
				if (!live) return;

				if (
					!NativeFileMenu.confirm(
						renderer,
						multiple ? `${files.length} files` : file.path
					)
				)
					return;

				setError(
					await live.discard({
						kind: "discard",
						paths,
						expectedHead: live.head,
						expectedBranch: live.branch,
					})
				);
			} else if (choice.kind === "ignore") {
				if (!live) return;

				if (
					!NativeFileMenu.confirmIgnore(
						renderer,
						GitIgnore.pattern(file.path, choice.rule)
					)
				)
					return;

				setError(
					(await live.ignore?.({
						kind: "ignore",
						path: file.path,
						rule: choice.rule,
						expectedHead: live.head,
						expectedBranch: live.branch,
					})) ?? null
				);
			} else if (choice.kind === "include" || choice.kind === "exclude") {
				live?.include?.(
					selected.map((item) => item.id),
					choice.kind === "include"
				);
			} else if (choice.kind === "history") {
				actions.history?.({
					path: file.originalPath && live ? file.originalPath : file.path,
					revision: saved?.commit,
				});
			} else {
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

				const kind = choice.kind === "other-editor" ? "editor" : choice.kind;

				if (
					saved &&
					actions.kind === "revision" &&
					(kind === "editor" || kind === "default")
				) {
					await (actions.openRevision ?? RepositoryFileActions.openRevision)(
						actions.root,
						saved,
						kind,
						application,
						actions.editors
					);
				} else if (kind === "editor" && application !== undefined) {
					await (actions.open ?? RepositoryFileActions.open)(
						actions.root,
						file.path,
						kind,
						application
					);
				} else {
					await (actions.open ?? RepositoryFileActions.open)(
						actions.root,
						multiple && (kind === "copy" || kind === "copy-full")
							? paths
							: file.path,
						kind
					);
				}
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
			{error && error !== actions.mutationError ? (
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
