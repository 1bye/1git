import type {
	Account,
	CallOptions,
	CreatePullRequest,
	CreateRepository,
	Owner,
	PageOptions,
	PullRequest,
	PullRequestFilter,
	Repository,
	RepositoryRef,
} from "../../contracts.js";
import type { Adapter } from "../../adapter.js";
import { repositoryPath, requestNumber } from "../../adapter.js";
import {
	array,
	boolean,
	fail,
	id,
	number,
	optionalString,
	record,
	string,
} from "../../result.js";
import { Transport } from "../../transport.js";

export class GitLabAdapter implements Adapter {
	constructor(private readonly http: Transport) {}

	private path(ref: RepositoryRef): string {
		return `projects/${encodeURIComponent(decodeURIComponent(repositoryPath(ref, true)))}`;
	}

	async account(options: CallOptions): Promise<Account> {
		const reply = await this.http.request(
			this.http.url("user"),
			"GET",
			options
		);

		const user = record(reply.data);

		return {
			id: id(user.id),
			username: string(user.username),
			name: optionalString(user.name),
			browserUrl: this.http.endpoints.browser(string(user.web_url)),
		};
	}

	async owners(options: PageOptions) {
		return this.http.page("namespaces", {}, options, (data): Owner[] =>
			array(data).map((item) => {
				const owner = record(item);
				const kind = string(owner.kind);

				if (kind !== "user" && kind !== "group")
					fail("invalid-response", "Unknown GitLab namespace kind.");

				return {
					id: id(owner.id),
					path: string(owner.full_path),
					kind,
					canCreateRepository: null,
				};
			})
		);
	}

	async repositories(options: PageOptions, search?: string) {
		return this.http.page(
			"projects",
			search === undefined
				? { membership: "true", order_by: "last_activity_at" }
				: { search, order_by: "last_activity_at" },
			options,
			(data) => array(data).map((item) => this.decodeRepository(item))
		);
	}

	async repository(
		ref: RepositoryRef,
		options: CallOptions
	): Promise<Repository> {
		const reply = await this.http.request(
			this.http.url(this.path(ref)),
			"GET",
			options
		);

		return this.decodeRepository(reply.data);
	}

	async createRepository(
		input: CreateRepository,
		options: CallOptions
	): Promise<Repository> {
		if (input.owner.kind !== "group" && input.owner.kind !== "user")
			fail("validation", "Invalid GitLab namespace.");

		if (!/^\d+$/u.test(input.owner.id))
			fail(
				"validation",
				"GitLab creation requires a numeric namespace ID from listOwners."
			);

		const reply = await this.http.request(
			this.http.url("projects"),
			"POST",
			options,
			{
				name: input.name,
				path: input.name,
				namespace_id: input.owner.id,
				visibility: input.visibility,
				description: input.description,
				initialize_with_readme: input.initialize ?? false,
			}
		);

		return this.decodeRepository(reply.data);
	}

	async pullRequests(ref: RepositoryRef, options: PullRequestFilter) {
		return this.http.page(
			`${this.path(ref)}/merge_requests`,
			{
				state:
					options.state === "open" || !options.state ? "opened" : options.state,
				scope: "all",
				order_by: "updated_at",
			},
			options,
			(data) => array(data).map((item) => this.decodePullRequest(item))
		);
	}

	async pullRequest(
		ref: RepositoryRef,
		value: number,
		options: CallOptions
	): Promise<PullRequest> {
		const reply = await this.http.request(
			this.http.url(`${this.path(ref)}/merge_requests/${requestNumber(value)}`),
			"GET",
			options
		);

		return this.decodePullRequest(reply.data);
	}

	async createPullRequest(
		input: CreatePullRequest,
		options: CallOptions
	): Promise<PullRequest> {
		const target = input.sourceRepository
			? await this.repository(input.repository, options)
			: null;

		const title =
			input.draft && !/^(?:Draft:|\[Draft\]|\(Draft\))/iu.test(input.title)
				? `Draft: ${input.title}`
				: input.title;

		const reply = await this.http.request(
			this.http.url(
				`${this.path(input.sourceRepository ?? input.repository)}/merge_requests`
			),
			"POST",
			options,
			{
				title,
				description: input.description,
				source_branch: input.sourceBranch,
				target_branch: input.targetBranch,
				...(target ? { target_project_id: target.id } : {}),
			}
		);

		return this.decodePullRequest(reply.data);
	}

	private decodeRepository(data: unknown): Repository {
		const repo = record(data);
		const path = string(repo.path_with_namespace);
		const split = path.lastIndexOf("/");

		if (split < 1) fail("invalid-response", "Invalid GitLab project path.");

		const ref = { owner: path.slice(0, split), name: path.slice(split + 1) };

		repositoryPath(ref, true);
		const visibility = string(repo.visibility);

		if (
			visibility !== "public" &&
			visibility !== "private" &&
			visibility !== "internal"
		)
			fail("invalid-response", "Unknown GitLab project visibility.");

		const permissions =
			repo.permissions == null ? null : record(repo.permissions);

		const levels = permissions
			? [permissions.project_access, permissions.group_access].map((value) =>
					value == null ? 0 : number(record(value).access_level)
				)
			: [];

		const level = levels.length ? Math.max(...levels) : null;

		return {
			id: id(repo.id),
			avatarUrl:
				this.http.endpoints.provider.avatarUrl(repo.avatar_url) ??
				this.http.endpoints.provider.avatarUrl(
					repo.namespace == null ? null : record(repo.namespace).avatar_url
				),
			ref,
			name: string(repo.name),
			description: optionalString(repo.description),
			visibility,
			defaultBranch: optionalString(repo.default_branch),
			browserUrl: this.http.endpoints.browser(string(repo.web_url)),
			cloneUrls: {
				https: this.http.endpoints.browser(string(repo.http_url_to_repo)),
				ssh: this.http.endpoints.ssh(repo.ssh_url_to_repo),
			},
			permissions: {
				read: level === null ? null : level >= 20 || visibility === "public",
				push: level === null ? null : level >= 30,
				admin: level === null ? null : level >= 40,
			},
		};
	}

	private decodePullRequest(data: unknown): PullRequest {
		const pr = record(data);
		const state = string(pr.state);

		if (!["opened", "closed", "merged", "locked"].includes(state))
			fail("invalid-response", "Unknown GitLab merge request state.");

		return {
			id: id(pr.id),
			number: requestNumber(number(pr.iid)),
			title: string(pr.title),
			description: optionalString(pr.description),
			state:
				state === "opened" || state === "locked"
					? "open"
					: state === "merged"
						? "merged"
						: "closed",
			draft: boolean(pr.draft ?? pr.work_in_progress),
			sourceBranch: string(pr.source_branch),
			targetBranch: string(pr.target_branch),
			browserUrl: this.http.endpoints.browser(string(pr.web_url)),
		};
	}
}
