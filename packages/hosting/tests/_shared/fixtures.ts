import type { HostingResult } from "../../src/contracts.js";
import type { ProviderOptions } from "../../src/provider.js";
import { HostingClient } from "../../src/hosting.js";
import { GitHubProvider } from "../../src/providers/github/provider.js";
import { GitLabProvider } from "../../src/providers/gitlab/provider.js";

export function value<T>(result: HostingResult<T>): T {
	if (!result.ok) throw new Error(JSON.stringify(result.error));

	return result.value;
}

export function githubRepository(base = "https://github.com", name = "demo") {
	return {
		id: 10,
		name,
		owner: { login: "alice" },
		private: true,
		description: "Example",
		default_branch: "main",
		html_url: `${base}/alice/${name}`,
		clone_url: `${base}/alice/${name}.git`,
		ssh_url: `git@${new URL(base).hostname}:alice/${name}.git`,
		permissions: { pull: true, push: true, admin: false },
	};
}

export function gitlabRepository(base = "https://gitlab.com") {
	return {
		id: 20,
		name: "Demo",
		path_with_namespace: "team/sub/demo",
		visibility: "internal",
		description: null,
		default_branch: "main",
		web_url: `${base}/team/sub/demo`,
		http_url_to_repo: `${base}/team/sub/demo.git`,
		ssh_url_to_repo: `git@${new URL(base).hostname}:team/sub/demo.git`,
		permissions: { project_access: { access_level: 30 }, group_access: null },
	};
}

export function githubPull(base = "https://github.com") {
	return {
		id: 100,
		number: 1,
		title: "Change",
		body: "Details",
		state: "open",
		draft: true,
		merged_at: null,
		head: { ref: "feature", repo: { id: 7 } },
		base: { ref: "main" },
		html_url: `${base}/alice/demo/pull/1`,
	};
}

export function gitlabPull(base = "https://gitlab.com") {
	return {
		id: 200,
		iid: 2,
		title: "Draft: Change",
		description: null,
		state: "opened",
		draft: true,
		source_branch: "feature",
		source_project_id: 17,
		target_branch: "main",
		web_url: `${base}/team/sub/demo/-/merge_requests/2`,
	};
}

export function capture(
	provider: "github" | "gitlab",
	respond: (url: URL, init: RequestInit) => Response | Promise<Response>,
	overrides: ProviderOptions = {}
) {
	const requests: { url: URL; init: RequestInit }[] = [];

	const options: ProviderOptions = {
		accessToken: "fake-token",
		...overrides,
		fetch: async (input, init = {}) => {
			const url = new URL(input);

			requests.push({ url, init });

			return respond(url, init);
		},
	};

	const configured =
		provider === "github"
			? new GitHubProvider(options)
			: new GitLabProvider(options);

	const client = value(HostingClient.create(configured));

	return { client, requests };
}
