import type {
	Account,
	CallOptions,
	CommitIdentity,
	CreatePullRequest,
	CreateRepository,
	Owner,
	Page,
	PageOptions,
	PullRequest,
	PullRequestFilter,
	Repository,
	RepositoryRef,
} from "./contracts.js";
import { fail, nonempty } from "./result.js";

export interface Adapter {
	account(options: CallOptions): Promise<Account>;
	commitIdentity?(options: CallOptions): Promise<CommitIdentity>;
	owners(options: PageOptions): Promise<Page<Owner>>;
	repositories(
		options: PageOptions,
		search?: string
	): Promise<Page<Repository>>;
	repository(ref: RepositoryRef, options: CallOptions): Promise<Repository>;
	createRepository(
		input: CreateRepository,
		options: CallOptions
	): Promise<Repository>;
	pullRequests(
		ref: RepositoryRef,
		options: PullRequestFilter
	): Promise<Page<PullRequest>>;
	pullRequest(
		ref: RepositoryRef,
		number: number,
		options: CallOptions
	): Promise<PullRequest>;
	createPullRequest(
		input: CreatePullRequest,
		options: CallOptions
	): Promise<PullRequest>;
}

export function segment(value: string): string {
	nonempty(value, "repository path");

	if (value === "." || value === ".." || /[\\/?#%@:\s]/u.test(value))
		fail("validation", "Invalid repository path segment.");

	return encodeURIComponent(value);
}

export function repositoryPath(ref: RepositoryRef, nested: boolean): string {
	const owner = ref.owner.split("/");

	if (!nested && owner.length !== 1)
		fail(
			"validation",
			"This provider does not support nested owner namespaces."
		);

	return `${owner.map(segment).join("/")}/${segment(ref.name)}`;
}

export function requestNumber(value: number): number {
	if (!Number.isSafeInteger(value) || value < 1)
		fail("validation", "Invalid pull request number.");

	return value;
}
