import { describe, expect, test } from "bun:test";

import type { HeadState, RemoteInfo } from "@1git/git";

import {
	getRepositoryBranchComparison,
	getRepositoryCleanAction,
} from "../src/renderer/src/feature/workspace/lib/repository-clean-state.js";
import { getRepositorySyncAction } from "../src/renderer/src/feature/workspace/lib/repository-sync.js";

const head = (overrides: Partial<HeadState> = {}): HeadState => ({
	ahead: 0,
	behind: 0,
	branch: "feature/clean-state",
	detached: false,
	oid: "0123456789abcdef",
	unborn: false,
	upstream: "origin/feature/clean-state",
	...overrides,
});

const remote = (
	url = "git@github.com:openai/codex.git",
	defaultBranch: string | null = "main"
): RemoteInfo => ({
	defaultBranch,
	fetchUrls: [url],
	name: "origin",
	pushUrls: [url],
});

describe("repository clean-state action", () => {
	test("keeps synchronization ahead of branch comparison", () => {
		const repositoryHead = head({ ahead: 2 });
		const repositoryRemote = remote();

		const comparison = getRepositoryBranchComparison(repositoryHead, [
			repositoryRemote,
		]);

		const action = getRepositoryCleanAction(
			getRepositorySyncAction(repositoryHead, [repositoryRemote]),
			comparison
		);

		expect(action).toMatchObject({ kind: "sync", label: "Push" });
	});

	test("previews an up-to-date topic branch against the remote default", () => {
		const repositoryHead = head();
		const repositoryRemote = remote();

		const comparison = getRepositoryBranchComparison(repositoryHead, [
			repositoryRemote,
		]);

		const action = getRepositoryCleanAction(
			getRepositorySyncAction(repositoryHead, [repositoryRemote]),
			comparison
		);

		expect(comparison).toEqual({
			baseBranch: "main",
			baseRevision: "origin/main",
			browserActionLabel: "Open pull request",
			browserUrl:
				"https://github.com/openai/codex/compare/main...feature%2Fclean-state?expand=1",
			headBranch: "feature/clean-state",
		});
		expect(action).toMatchObject({
			kind: "preview-comparison",
			label: "Preview pull request",
		});
	});

	test("opens the remote for a comparison on an unsupported provider", () => {
		const repositoryHead = head();

		const repositoryRemote = remote(
			"git@gitlab.example.com:platform/desktop.git"
		);

		const comparison = getRepositoryBranchComparison(repositoryHead, [
			repositoryRemote,
		]);

		expect(comparison?.browserUrl).toBe(
			"https://gitlab.example.com/platform/desktop"
		);
		expect(comparison?.browserActionLabel).toBe("Open remote");
	});

	test("fetches on the configured default branch", () => {
		const repositoryHead = head({ branch: "main", upstream: "origin/main" });
		const repositoryRemote = remote();

		const comparison = getRepositoryBranchComparison(repositoryHead, [
			repositoryRemote,
		]);

		const action = getRepositoryCleanAction(
			getRepositorySyncAction(repositoryHead, [repositoryRemote]),
			comparison
		);

		expect(comparison).toBeNull();
		expect(action).toMatchObject({ kind: "sync", label: "Fetch" });
	});
});
