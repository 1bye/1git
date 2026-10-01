import type { Adapter } from "./adapter.js";
import { segment } from "./adapter.js";
import type {
	Account,
	CallOptions,
	Capabilities,
	CreatePullRequest,
	CreateRepository,
	HostingOptions,
	HostingResult,
	Owner,
	Page,
	PageOptions,
	PullRequest,
	PullRequestFilter,
	Repository,
	RepositoryRef,
} from "./contracts.js";
import { GitHub } from "./github.js";
import { GitLab } from "./gitlab.js";
import { fail, failureResult, nonempty, result } from "./result.js";
import { Endpoints, Transport } from "./transport.js";

/** Stateless hosting API for one provider/account. Does not execute Git or persist credentials. */
export class HostingClient {
	readonly capabilities: Capabilities;
	readonly provider: "github" | "gitlab";
	readonly webUrl: string;
	readonly #adapter: Adapter;

	private constructor(options: HostingOptions) {
		const endpoints = new Endpoints(options);

		if (
			typeof options.accessToken !== "string" &&
			typeof options.accessToken !== "function"
		)
			fail(
				"validation",
				"An explicit access token or credential callback is required."
			);

		if (typeof options.accessToken === "string")
			nonempty(options.accessToken, "access token");

		const transport = new Transport(endpoints, options.accessToken);

		this.#adapter =
			options.provider === "github"
				? new GitHub(transport)
				: new GitLab(transport);
		this.provider = options.provider;
		this.webUrl = endpoints.web.href;
		this.capabilities = Object.freeze({
			pullRequestDrafts: true,
			repositoryVisibilities: Object.freeze(
				options.provider === "github"
					? (["public", "private"] as const)
					: (["public", "private", "internal"] as const)
			),
			oauthPkce: true,
			oauthClientSecretRequired: options.provider === "github",
			oauthRefresh: "when-issued",
			oauthRevocation: true,
		});
	}

	/** Validate configuration without making requests; construct one instance per account. */
	static create(options: HostingOptions): HostingResult<HostingClient> {
		try {
			return { ok: true, value: new HostingClient(options) };
		} catch (error) {
			return failureResult("configure", error);
		}
	}

	/** Validate the current credential and retrieve its account identity. */
	getAccount(options: CallOptions = {}): Promise<HostingResult<Account>> {
		return result("get-account", () => this.#adapter.account(options));
	}

	/** Candidate user/organization/group destinations; provider policy remains authoritative. */
	listOwners(options: PageOptions = {}): Promise<HostingResult<Page<Owner>>> {
		return result("list-owners", () => this.#adapter.owners(options));
	}

	/** Repositories the credential belongs to or collaborates on. */
	listRepositories(
		options: PageOptions = {}
	): Promise<HostingResult<Page<Repository>>> {
		return result("list-repositories", () =>
			this.#adapter.repositories(options)
		);
	}

	/** Provider search: includes accessible public repositories, not just account memberships. */
	searchRepositories(
		query: string,
		options: PageOptions = {}
	): Promise<HostingResult<Page<Repository>>> {
		return result("search-repositories", () =>
			this.#adapter.repositories(options, nonempty(query, "search query"))
		);
	}

	/** Retrieve a repository by owner/name (nested owner paths are supported by GitLab). */
	getRepository(
		ref: RepositoryRef,
		options: CallOptions = {}
	): Promise<HostingResult<Repository>> {
		return result("get-repository", () =>
			this.#adapter.repository(ref, options)
		);
	}

	/** Create only the hosted repository. Never automatically retries a write. */
	createRepository(
		input: CreateRepository,
		options: CallOptions = {}
	): Promise<HostingResult<Repository>> {
		return result("create-repository", () => {
			segment(input.name);

			if (!["public", "private", "internal"].includes(input.visibility))
				fail("validation", "Invalid repository visibility.");

			if (input.owner.canCreateRepository === false)
				fail("permission", "This owner cannot create repositories.");

			return this.#adapter.createRepository(input, options);
		});
	}

	/** Review requests targeting this repository. An empty filtered page can still have next. */
	listPullRequests(
		ref: RepositoryRef,
		options: PullRequestFilter = {}
	): Promise<HostingResult<Page<PullRequest>>> {
		return result("list-pull-requests", () => {
			if (
				options.state &&
				!["open", "closed", "merged", "all"].includes(options.state)
			)
				fail("validation", "Invalid review request state.");

			return this.#adapter.pullRequests(ref, options);
		});
	}

	/** Retrieve a PR/MR by its repository-local number, not global ID. */
	getPullRequest(
		ref: RepositoryRef,
		number: number,
		options: CallOptions = {}
	): Promise<HostingResult<PullRequest>> {
		return result("get-pull-request", () =>
			this.#adapter.pullRequest(ref, number, options)
		);
	}

	/** Create a PR/MR for branches already pushed by the application. */
	createPullRequest(
		input: CreatePullRequest,
		options: CallOptions = {}
	): Promise<HostingResult<PullRequest>> {
		return result("create-pull-request", () => {
			nonempty(input.title, "review request title");
			nonempty(input.sourceBranch, "source branch");
			nonempty(input.targetBranch, "target branch");

			return this.#adapter.createPullRequest(input, options);
		});
	}
}
