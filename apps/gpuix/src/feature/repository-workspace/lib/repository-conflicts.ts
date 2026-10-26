import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";
import {
	type FileContent,
	type GitResult,
	type ResolveConflictInput,
} from "@1git/git";
import { GitRepository } from "../../machines/repository-access";
import { ExternalEditors } from "../../editor-settings/external-editors";
import { MachineLocation } from "../../machines/machine-location";

/** Indexed versions stay distinct from the editable working result, including during rebase. */
export interface ConflictSource {
	readonly text: string | null;
	readonly label: string;
	readonly revision?: string;
	readonly description?: string;
}

export interface ConflictPreview {
	readonly text: string;
	readonly hash: string;
	readonly ours?: ConflictSource;
	readonly theirs?: ConflictSource;
}

const supported = (value: FileContent): boolean =>
	value.encoding === "utf8" &&
	!value.content.includes("\0") &&
	value.sizeBytes <= 512 * 1024;

/** Conflict preview and explicitly requested resolution; never continues Git operations. */
export class RepositoryConflicts {
	private constructor() {}

	static async read(
		root: string,
		path: string,
		signal: AbortSignal
	): Promise<GitResult<ConflictPreview | null>> {
		const opened = await GitRepository.open({ path: root, signal });

		if (!opened.ok) return opened;

		const repository = opened.value;

		const [content, ours, theirs, snapshot] = await Promise.all([
			repository.getFileContent({ path, source: { kind: "working" }, signal }),
			repository.getFileContent({
				path,
				source: { kind: "object", objectId: `:2:${path}` },
				signal,
			}),
			repository.getFileContent({
				path,
				source: { kind: "object", objectId: `:3:${path}` },
				signal,
			}),
			repository.getSnapshot({ signal }),
		]);

		if (!content.ok) return content;

		if (!supported(content.value)) return { ok: true, value: null };

		const operation = snapshot.ok ? snapshot.value.operationState : undefined;

		const ref =
			operation === "rebase"
				? "REBASE_HEAD"
				: operation === "merge"
					? "MERGE_HEAD"
					: operation === "cherry-pick"
						? "CHERRY_PICK_HEAD"
						: operation === "revert"
							? "REVERT_HEAD"
							: null;

		const incoming = ref ? await repository.getCommit(ref, { signal }) : null;
		const branch = snapshot.ok ? snapshot.value.head.branch : null;

		const source = (
			result: GitResult<FileContent>,
			label: string,
			description: string
		): ConflictSource => ({
			text: result.ok && supported(result.value) ? result.value.content : null,
			label,
			revision: result.ok ? result.value.revision : undefined,
			description,
		});

		return {
			ok: true as const,
			value: {
				text: content.value.content,
				hash: createHash("sha256").update(content.value.content).digest("hex"),
				ours: source(
					ours,
					operation === "rebase"
						? "Upstream version"
						: `Current${branch ? ` · ${branch}` : " · HEAD"}`,
					operation === "rebase"
						? "The version being rebased onto"
						: "The current branch’s indexed version"
				),
				theirs: source(
					theirs,
					`${operation === "rebase" ? "Replayed commit" : "Incoming"}${incoming?.ok ? ` · ${incoming.value.oid.slice(0, 7)}` : ""}`,
					incoming?.ok ? incoming.value.summary : "The other indexed version"
				),
			},
		};
	}

	static async write(root: string, request: ResolveConflictInput) {
		const opened = await GitRepository.open({ path: root });

		if (!opened.ok) return opened;

		return await opened.value.resolveConflict(request);
	}

	/** Uses the app's external-editor preference, never a command from repository configuration. */
	static async openEditor(
		root: string,
		path: string,
		application?: string | null,
		editors = new ExternalEditors()
	): Promise<void> {
		if (MachineLocation.isRemote(root))
			throw new Error(
				"Open working files with an SSH-capable editor on the remote machine."
			);

		const canonicalRoot = await realpath(root);
		const absolute = resolve(canonicalRoot, path);
		const local = relative(canonicalRoot, absolute);

		if (
			!local ||
			local.startsWith("../") ||
			local === ".." ||
			(await realpath(absolute)) !== absolute ||
			!(await stat(absolute)).isFile()
		)
			throw new Error(
				"Only regular files inside this repository can be opened here."
			);

		if (application === undefined) await editors.open(absolute);
		else await editors.open(absolute, application);
	}
}
