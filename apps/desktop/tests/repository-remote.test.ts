import { describe, expect, test } from "bun:test";
import type { RemoteInfo } from "@1git/git";
import {
	getGithubRepositoryUrl,
	getPreferredRepositoryRemoteUrl,
} from "@/fixture/repository-item/lib/repository-remote.js";

const remote = (name: string, url: string): RemoteInfo => ({
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
});
