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
import { repositoryPath, requestNumber, segment } from "../../adapter.js";
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

export class GitHubAdapter implements Adapter {
	constructor(private readonly http: Transport) {}

	async account(options: CallOptions): Promise<Account> {
		const { data } = await this.http.request(
			this.http.url("user"),
			"GET",
			options
		);

		const user = record(data);

		return {
			id: id(user.id),
			username: string(user.login),
			name: optionalString(user.name),
			browserUrl: this.http.endpoints.browser(string(user.html_url)),
		};
	}

	async owners(options: PageOptions) {
		const page = await this.http.page(
			"user/orgs",
			{},
			options,
			(data): Owner[] =>
				array(data).map((item) => {
					const org = record(item);

					return {
						id: id(org.id),
						path: string(org.login),
						kind: "organization",
						canCreateRepository: null,
					};
				})
		);

		if (options.cursor) return page;

		const self = await this.account(options);

		const owner: Owner = {
			id: self.id,
			path: self.username,
			kind: "user",
			canCreateRepository: null,
		};

		return { ...page, items: [owner, ...page.items] };
	}

	async repositories(options: PageOptions, search?: string) {
		return search === undefined
			? this.http.page(
					"user/repos",
					{
						sort: "updated",
						affiliation: "owner,collaborator,organization_member",
					},
					options,
					(data) => array(data).map((item) => this.decodeRepository(item))
				)
			: this.http.page(
					"search/repositories",
					{ q: search },
					options,
					(data) => {
						const response = record(data);

						if (response.incomplete_results === true)
							fail(
								"invalid-response",
								"GitHub search returned incomplete results; narrow the query."
							);

						return array(response.items).map((item) =>
							this.decodeRepository(item)
						);
					}
				);
	}

	async repository(
		ref: RepositoryRef,
		options: CallOptions
	): Promise<Repository> {
		const reply = await this.http.request(
			this.http.url(`repos/${repositoryPath(ref, false)}`),
			"GET",
			options
		);

		return this.decodeRepository(reply.data);
	}

	async createRepository(
		input: CreateRepository,
		options: CallOptions
	): Promise<Repository> {
		if (input.visibility === "internal")
			fail(
				"unsupported",
				"This adapter creates public or private GitHub repositories."
			);

		let path: string;

		if (input.owner.kind === "user") {
			const self = await this.account(options);

			if (
				input.owner.id !== self.id ||
				input.owner.path.toLowerCase() !== self.username.toLowerCase()
			)
				fail(
					"permission",
					"Repositories can only be created for the authenticated user or an organization."
				);

			path = "user/repos";
		} else {
			if (input.owner.kind !== "organization")
				fail("validation", "Invalid GitHub repository owner.");

			path = `orgs/${segment(input.owner.path)}/repos`;
		}

		const reply = await this.http.request(
			this.http.url(path),
			"POST",
			options,
			{
				name: input.name,
				private: input.visibility === "private",
				description: input.description,
				auto_init: input.initialize ?? false,
			}
		);

		return this.decodeRepository(reply.data);
	}

	async pullRequests(ref: RepositoryRef, options: PullRequestFilter) {
		const state =
			options.state === "merged" ? "closed" : (options.state ?? "open");

		return this.http.page(
			`repos/${repositoryPath(ref, false)}/pulls`,
			{ state, sort: "updated", direction: "desc" },
			options,
			(data) =>
				array(data)
					.map((item) => this.decodePullRequest(item))
					.filter(
						(item) =>
							!options.state ||
							options.state === "all" ||
							item.state === options.state
					)
		);
	}

	async pullRequest(
		ref: RepositoryRef,
		value: number,
		options: CallOptions
	): Promise<PullRequest> {
		const reply = await this.http.request(
			this.http.url(
				`repos/${repositoryPath(ref, false)}/pulls/${requestNumber(value)}`
			),
			"GET",
			options
		);

		return this.decodePullRequest(reply.data);
	}

	async createPullRequest(
		input: CreatePullRequest,
		options: CallOptions
	): Promise<PullRequest> {
		if (input.sourceRepository) repositoryPath(input.sourceRepository, false);

		const head = input.sourceRepository
			? `${input.sourceRepository.owner}:${input.sourceBranch}`
			: input.sourceBranch;

		const reply = await this.http.request(
			this.http.url(`repos/${repositoryPath(input.repository, false)}/pulls`),
			"POST",
			options,
			{
				title: input.title,
				body: input.description,
				head,
				head_repo: input.sourceRepository?.name,
				base: input.targetBranch,
				draft: input.draft ?? false,
			}
		);

		return this.decodePullRequest(reply.data);
	}

	private decodeRepository(data: unknown): Repository {
		const repo = record(data);

		const permissions =
			repo.permissions == null ? null : record(repo.permissions);

		const owner = record(repo.owner);
		const name = string(repo.name);
		const ref = { owner: string(owner.login), name };

		repositoryPath(ref, false);
		const visibility =
			repo.visibility ?? (boolean(repo.private) ? "private" : "public");

		if (
			visibility !== "public" &&
			visibility !== "private" &&
			visibility !== "internal"
		)
			fail("invalid-response", "Unknown GitHub repository visibility.");

		return {
			id: id(repo.id),
			ref,
			name,
			description: optionalString(repo.description),
			visibility,
			defaultBranch: optionalString(repo.default_branch),
			browserUrl: this.http.endpoints.browser(string(repo.html_url)),
			cloneUrls: {
				https: this.http.endpoints.browser(string(repo.clone_url)),
				ssh: this.http.endpoints.ssh(repo.ssh_url),
			},
			permissions: {
				read: permissions?.pull == null ? null : boolean(permissions.pull),
				push: permissions?.push == null ? null : boolean(permissions.push),
				admin: permissions?.admin == null ? null : boolean(permissions.admin),
			},
		};
	}

	private decodePullRequest(data: unknown): PullRequest {
		const pr = record(data);
		const state = string(pr.state);

		if (state !== "open" && state !== "closed")
			fail("invalid-response", "Unknown GitHub pull request state.");

		return {
			id: id(pr.id),
			number: number(pr.number),
			title: string(pr.title),
			description: optionalString(pr.body),
			state: pr.merged_at != null || pr.merged === true ? "merged" : state,
			draft: boolean(pr.draft),
			sourceBranch: string(record(pr.head).ref),
			targetBranch: string(record(pr.base).ref),
			browserUrl: this.http.endpoints.browser(string(pr.html_url)),
		};
	}
}
