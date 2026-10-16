import {
	GitIdentity,
	type GitIdentityValues,
	type GitResult,
	type RemoteInfo,
} from "@1git/git";
import { GitRepository } from "../machines/repository-access";

/** Settings read from Git rather than duplicated in the app's session document. */
export interface GitSettingsData {
	readonly commonDirectory?: string;
	readonly identity: GitIdentityValues;
	readonly custom: boolean;
	readonly remotes: readonly RemoteInfo[];
	readonly identityReadOnlyReason?: string;
}

/** Explicit config-only writes; no implicit fetching, pushing, or credential changes. */
export type GitSettingsRequest =
	| {
			readonly kind: "identity";
			readonly identity: GitIdentityValues;
			readonly custom: boolean;
	  }
	| { readonly kind: "add-remote"; readonly name: string; readonly url: string }
	| {
			readonly kind: "edit-remote";
			readonly name: string;
			readonly url: string;
	  }
	| { readonly kind: "remove-remote"; readonly name: string };

/** Git settings boundary used by both app defaults and repository settings. */
export class GitSettingsModel {
	private constructor() {}

	static async read(
		root: string | null,
		signal: AbortSignal
	): Promise<GitResult<GitSettingsData>> {
		if (!root) {
			const result = await new GitIdentity().read(signal);

			return result.ok
				? {
						ok: true,
						value: { identity: result.value, custom: true, remotes: [] },
					}
				: result;
		}

		const opened = await GitRepository.open({ path: root, signal });

		if (!opened.ok) return opened;

		const [name, email, localName, localEmail, remotes] = await Promise.all([
			opened.value.getConfig({ key: "user.name", scope: "effective", signal }),
			opened.value.getConfig({ key: "user.email", scope: "effective", signal }),
			opened.value.getConfig({ key: "user.name", scope: "local", signal }),
			opened.value.getConfig({ key: "user.email", scope: "local", signal }),
			opened.value.getRemotes({ signal }),
		]);

		if (!name.ok) return name;

		if (!email.ok) return email;

		if (!localName.ok) return localName;

		if (!localEmail.ok) return localEmail;

		if (!remotes.ok) return remotes;

		const extension = await opened.value.getConfig({
			key: "extensions.worktreeConfig",
			scope: "local",
			signal,
		});

		if (!extension.ok) return extension;

		let identityReadOnlyReason: string | undefined;

		if (
			["true", "yes", "on", "1", ""].includes(
				extension.value.value?.toLowerCase() ?? "false"
			)
		) {
			const [worktreeName, worktreeEmail] = await Promise.all([
				opened.value.getConfig({ key: "user.name", scope: "worktree", signal }),
				opened.value.getConfig({
					key: "user.email",
					scope: "worktree",
					signal,
				}),
			]);

			if (!worktreeName.ok) return worktreeName;

			if (!worktreeEmail.ok) return worktreeEmail;

			if (
				worktreeName.value.value !== null ||
				worktreeEmail.value.value !== null
			)
				identityReadOnlyReason =
					"This worktree has its own Git identity. Edit it in Git directly; repository defaults cannot override it.";
		}

		return {
			ok: true,
			value: {
				commonDirectory: opened.value.info.commonDirectory,
				identity: { name: name.value.value, email: email.value.value },
				custom:
					localName.value.value !== null || localEmail.value.value !== null,
				remotes: remotes.value,
				identityReadOnlyReason,
			},
		};
	}

	static async write(
		root: string | null,
		request: GitSettingsRequest
	): Promise<GitResult<GitSettingsData>> {
		if (request.kind === "identity" && (request.custom || !root)) {
			try {
				GitIdentity.validate(request.identity);
			} catch {
				return {
					ok: false,
					error: {
						code: "invalid-input",
						operation: "set-config",
						retryable: false,
						message: "Enter a name and a valid commit email address.",
					},
				};
			}
		}

		if (!root) {
			if (request.kind !== "identity")
				return {
					ok: false,
					error: {
						code: "invalid-input",
						operation: "set-config",
						retryable: false,
						message: "Choose a repository before editing remotes.",
					},
				};

			const result = await new GitIdentity().write(request.identity);

			return result.ok
				? {
						ok: true,
						value: { identity: result.value, custom: true, remotes: [] },
					}
				: result;
		}

		const opened = await GitRepository.open({ path: root });

		if (!opened.ok) return opened;

		const repository = opened.value;

		if (request.kind === "identity" || request.kind === "edit-remote") {
			const current = await GitSettingsModel.read(
				root,
				new AbortController().signal
			);

			if (!current.ok) return current;

			const reason =
				request.kind === "identity"
					? current.value.identityReadOnlyReason
					: (current.value.remotes.find(
								(remote) => remote.name === request.name
						  )?.fetchUrls.length ?? 0) > 1
						? "Remotes with multiple fetch URLs must be edited in Git directly."
						: undefined;

			if (reason)
				return {
					ok: false,
					error: {
						code: "invalid-input",
						operation: "set-config",
						retryable: false,
						message: reason,
					},
				};
		}

		if (request.kind === "identity") {
			for (const [key, value] of [
				["user.name", request.identity.name],
				["user.email", request.identity.email],
			] as const) {
				const result = request.custom
					? await repository.setConfig({ key, value: value?.trim() ?? "" })
					: await repository.unsetConfig({ key });

				if (!result.ok) return result;
			}
		} else {
			const result =
				request.kind === "add-remote"
					? await repository.addRemote({
							name: request.name.trim(),
							url: request.url.trim(),
						})
					: request.kind === "edit-remote"
						? await repository.setRemoteUrl({
								name: request.name,
								url: request.url.trim(),
							})
						: await repository.removeRemote({ name: request.name });

			if (!result.ok) return result;
		}

		return await GitSettingsModel.read(root, new AbortController().signal);
	}
}
