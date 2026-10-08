/**
 * Covers: destination selection, encoded creation links and fork-safe existing request links.
 * Real: review model and URL parsing.
 * Doubles: immutable metadata only.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import type { BranchCollection } from "@1git/git";
import {
	RepositoryPullRequest,
	type PullRequestPreview,
} from "../../src/feature/repository-pull-request/repository-pull-request";

function preview(providerId = "github"): PullRequestPreview {
	return {
		branch: "feature/ui",
		head: "head",
		remote: "origin",
		remoteUrl: "https://github.com/team/app.git",
		remoteRef: "refs/heads/feature/ui",
		publishedHead: "head",
		uploadKind: "push",
		identity: {
			providerId,
			host: "github.com",
			repository: { owner: "team", name: "app" },
			browserUrl: "https://github.com/team/app",
		},
		comparison: { root: "/test", base: "base", baseName: "main", branches: [] },
		requests: [],
		repositoryId: "7",
		notice: null,
	};
}

it("encodes slashes, Unicode, percent signs and URL syntax inside branch names", () => {
	const url = RepositoryPullRequest.browserUrl(
		{ ...preview(), remoteRef: "refs/heads/feature/hello%&é" },
		"release/next"
	);

	expect(url).toBe(
		"https://github.com/team/app/compare/release%2Fnext...feature%2Fhello%25%26%C3%A9?expand=1"
	);
	expect(() => RepositoryPullRequest.browserUrl(preview(), "\nmain")).toThrow(
		"valid branches"
	);
});

it("supports nested self-hosted GitLab paths and exact source/target query parameters", () => {
	const value = preview("gitlab");

	const url = new URL(
		RepositoryPullRequest.browserUrl(
			{
				...value,
				identity: {
					...value.identity,
					browserUrl: "https://git.example/gitlab/group/sub/project",
				},
			},
			"release/β"
		)
	);

	expect(url.pathname).toBe("/gitlab/group/sub/project/-/merge_requests/new");
	expect(url.searchParams.get("merge_request[source_branch]")).toBe(
		"feature/ui"
	);
	expect(url.searchParams.get("merge_request[target_branch]")).toBe(
		"release/β"
	);
});

it("reuses only the same repository's matching open request, ignoring an untrusted provider URL", () => {
	const request = {
		id: "3",
		number: 23,
		title: "UI",
		description: null,
		state: "open" as const,
		draft: false,
		sourceBranch: "feature/ui",
		targetBranch: "main",
		sourceRepositoryId: "7",
		browserUrl: "https://evil.invalid/request",
	};

	const value = {
		...preview(),
		requests: [{ ...request, number: 12, sourceRepositoryId: "fork" }, request],
	};

	expect(RepositoryPullRequest.browserUrl(value, "main")).toBe(
		"https://github.com/team/app/pull/23"
	);
	expect(
		RepositoryPullRequest.existing(
			{ ...value, requests: [{ ...request, sourceRepositoryId: null }] },
			"main"
		)
	).toBeUndefined();
	expect(RepositoryPullRequest.existing(value, "other")).toBeUndefined();
	expect(
		RepositoryPullRequest.browserUrl(
			{ ...value, identity: { ...value.identity, providerId: "gitlab" } },
			"main"
		)
	).toBe("https://github.com/team/app/-/merge_requests/23");
});

it("does not guess between multiple remotes or publish destinations", () => {
	const collection: BranchCollection = { current: null, branches: [] };

	const first = {
		name: "first",
		defaultBranch: "main",
		fetchUrls: ["https://github.com/team/app.git"],
		pushUrls: ["https://github.com/team/app.git"],
	};

	expect(() =>
		RepositoryPullRequest.destination(collection, [
			first,
			{ ...first, name: "second" },
		])
	).toThrow("Choose a remote");
	expect(
		RepositoryPullRequest.destination(collection, [
			first,
			{ ...first, name: "origin" },
		]).name
	).toBe("origin");
	expect(() =>
		RepositoryPullRequest.destination(collection, [
			{ ...first, pushUrls: [...first.pushUrls, "other"] },
		])
	).toThrow("one fetch and one push");
});
