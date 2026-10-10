import type {
	CreateReleaseTagInput,
	PushTagInput,
	RepositorySnapshot,
	TagPushResult,
} from "./contracts.js";
import type { RepositoryContext } from "./internal.js";
import { loadRemotes, loadSnapshot, loadTags } from "./queries.js";
import { invalidInput } from "./result.js";
import { validateHttpAuthentication } from "./http-authentication.js";
import {
	requireCredentialFreeRemoteUrl,
	requireText,
	requireRevision,
} from "./validation.js";
import { GitCommandFailure } from "./process/git-process.js";
import { resolve } from "node:path";

const commitOid = /^(?:[a-f\d]{40}|[a-f\d]{64})$/i;
const transportUrl = /^[a-z][a-z\d+.-]*:\/\//i;
const scpUrl = /^[^/]+:/;

/** Reviewed release tagging and single-tag publishing; callers coordinate shared refs and uncertain outcomes. */
export class TagOperations {
	private constructor() {}

	private static async review(
		context: RepositoryContext,
		input: CreateReleaseTagInput | PushTagInput
	): Promise<void> {
		const operation = "commit" in input ? "create-tag" : "push-tag";
		const snapshot = await loadSnapshot(context, false, input.signal);

		if (
			!input.expectedHead ||
			snapshot.head.oid !== input.expectedHead ||
			snapshot.head.branch !== input.expectedBranch ||
			snapshot.operationState !== "normal"
		)
			throw invalidInput(
				operation,
				"The repository changed or has a Git operation in progress. Refresh and review the tag again."
			);

		const name = requireRevision(input.name, "Tag name", operation);

		try {
			await context.process.run({
				args: ["check-ref-format", `refs/tags/${name}`],
				cwd: context.repository.root,
				signal: input.signal,
			});
		} catch (cause) {
			if (cause instanceof GitCommandFailure && cause.exitCode === 1)
				throw invalidInput(
					operation,
					"Enter a valid Git tag name, such as v1.0.0. Spaces and ref-special characters are not allowed."
				);

			throw cause;
		}
	}

	static async create(
		context: RepositoryContext,
		input: CreateReleaseTagInput
	): Promise<RepositorySnapshot> {
		await TagOperations.review(context, input);
		const message = requireText(input.message, "Tag message", "create-tag");

		if (!message.trim() || !commitOid.test(input.commit))
			throw invalidInput(
				"create-tag",
				"A tag message and exact commit ID are required."
			);

		const object = await context.process.run({
			args: ["cat-file", "-t", input.commit],
			cwd: context.repository.root,
			signal: input.signal,
		});

		if (object.stdout.toString().trim() !== "commit")
			throw invalidInput(
				"create-tag",
				"Select an exact commit from History before tagging."
			);

		try {
			await context.process.run({
				args: ["merge-base", "--is-ancestor", input.commit, input.expectedHead],
				cwd: context.repository.root,
				signal: input.signal,
			});
		} catch (cause) {
			if (cause instanceof GitCommandFailure && cause.exitCode === 1)
				throw invalidInput(
					"create-tag",
					"The selected commit is no longer in the reviewed History. Refresh before tagging."
				);

			throw cause;
		}

		const tags = await loadTags(context, input.signal);

		if (tags.some((tag) => tag.name === input.name))
			throw invalidInput(
				"create-tag",
				"A tag with this name already exists. Choose another name; existing tags are never replaced."
			);

		await TagOperations.review(context, input);
		await context.process.run({
			args: ["tag", "-a", "-F", "-", "--", input.name, input.commit],
			cwd: context.repository.root,
			stdin: `${message}\n`,
			signal: input.signal,
		});

		return await loadSnapshot(context, false, input.signal);
	}

	static async push(
		context: RepositoryContext,
		input: PushTagInput
	): Promise<TagPushResult> {
		await TagOperations.review(context, input);
		const [tags, remotes] = await Promise.all([
			loadTags(context, input.signal),
			loadRemotes(context, input.signal),
		]);

		const tag = tags.find((item) => item.name === input.name);
		const remote = remotes.find((item) => item.name === input.remote);

		if (
			!tag ||
			tag.oid !== input.expectedOid ||
			tag.targetOid !== input.expectedTarget ||
			!remote ||
			remote.pushUrls.length !== 1 ||
			remote.pushUrls[0] !== input.expectedUrl
		)
			throw invalidInput(
				"push-tag",
				"The tag or remote destination changed. Refresh and review before pushing."
			);

		const url = requireCredentialFreeRemoteUrl(input.expectedUrl, "push-tag");

		// Disambiguate local paths from remote names; otherwise Git can resolve a path through another remote's config.
		const destination =
			transportUrl.test(url) || scpUrl.test(url)
				? url
				: resolve(context.repository.root, url);

		if (input.httpAuthentication)
			validateHttpAuthentication(
				input.httpAuthentication,
				remote.pushUrls,
				"push-tag"
			);

		// An exact URL pins the destination; an exact object/refspec prevents config-driven branch, mirror or extra-tag pushes.
		await context.process.run({
			args: [
				"push",
				"--no-force",
				"--no-mirror",
				"--no-follow-tags",
				"--recurse-submodules=no",
				"--",
				destination,
				`${tag.oid}:refs/tags/${tag.name}`,
			],
			cwd: context.repository.root,
			signal: input.signal,
			httpAuthentication: input.httpAuthentication,
		});

		return {
			name: tag.name,
			oid: tag.oid,
			remote: remote.name,
			snapshot: await loadSnapshot(context, false, input.signal),
		};
	}
}
