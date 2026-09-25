import { describe, expect, test } from "bun:test";

import type { RemoteInfo } from "@1git/git";

import {
	getGithubPullRequestUrl,
	getGithubRepositoryUrl,
	getPreferredRepositoryRemoteUrl,
	getRepositoryWebUrl,
} from "@/feature/workspace/lib/repository-remote.js";

const remote = (name: string, url: string): RemoteInfo => ({
	defaultBranch: null,
	fetchUrls: [url],
	name,
	pushUrls: [url],
});

describe("repository remote", () => {
	test("prefers origin before the upstream remote", () => {
		expect(
			getPreferredRepositoryRemoteUrl(
				[
					remote("upstream", "https://github.com/company/app.git"),
					remote("origin", "git@github.com:user/app.git"),
				],
				"upstream/main"
			)
		).toBe("git@github.com:user/app.git");
	});

	test("falls back to the first available remote", () => {
		expect(
			getPreferredRepositoryRemoteUrl(
				[remote("company", "ssh://git@example.com/company/app.git")],
				null
			)
		).toBe("ssh://git@example.com/company/app.git");
	});

	test("converts GitHub HTTPS and SSH remotes to browser URLs", () => {
		expect(getGithubRepositoryUrl("https://github.com/openai/codex.git")).toBe(
			"https://github.com/openai/codex"
		);
		expect(getGithubRepositoryUrl("git@github.com:openai/codex.git")).toBe(
			"https://github.com/openai/codex"
		);
		expect(
			getGithubRepositoryUrl("ssh://git@github.com/openai/codex.git")
		).toBe("https://github.com/openai/codex");
	});

	test("does not create a GitHub action for another host", () => {
		expect(
			getGithubRepositoryUrl("https://gitlab.com/openai/codex.git")
		).toBeNull();
	});

	test("creates secure browser URLs for other hosted remotes", () => {
		expect(
			getRepositoryWebUrl("git@gitlab.example.com:platform/desktop.git")
		).toBe("https://gitlab.example.com/platform/desktop");
		expect(getRepositoryWebUrl("/tmp/repository.git")).toBeNull();
	});

	test("creates a GitHub comparison URL without provider API state", () => {
		expect(
			getGithubPullRequestUrl(
				"git@github.com:openai/codex.git",
				"main",
				"feature/clean-state"
			)
		).toBe(
			"https://github.com/openai/codex/compare/main...feature%2Fclean-state?expand=1"
		);
	});
});
