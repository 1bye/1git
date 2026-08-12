import { describe, expect, test } from "bun:test";
import type { HeadState, RepositorySnapshot } from "@1git/git";
import { renderToStaticMarkup } from "react-dom/server";
import { getRepositoryCleanAction } from "../src/renderer/src/feature/workspace/lib/repository-clean-state.js";
import { getRepositorySyncAction } from "../src/renderer/src/feature/workspace/lib/repository-sync.js";
import { CleanState } from "../src/renderer/src/fixture/repository-workspace/components/clean-state.js";

const snapshot = (headState: HeadState): RepositorySnapshot => ({
	files: [],
	head: headState,
	operationState: "normal",
	repository: {
		commonDirectory: "/repository/.git",
		gitDirectory: "/repository/.git",
		isBare: false,
		isShallow: false,
		root: "/repository",
	},
	stashCount: 0,
});

const head = (overrides: Partial<HeadState> = {}): HeadState => ({
	ahead: 0,
	behind: 0,
	branch: "main",
	detached: false,
	oid: "0123456789abcdef",
	unborn: false,
	upstream: "origin/main",
	...overrides,
});

const ignoreAction = async (): Promise<void> => undefined;

describe("repository clean-state sync action", () => {
	test("shows the state-aware next action", () => {
		const repositorySnapshot = snapshot(head({ ahead: 2 }));
		const syncAction = getRepositorySyncAction(repositorySnapshot.head, []);
		const markup = renderToStaticMarkup(
			<CleanState
				cleanAction={getRepositoryCleanAction(syncAction, null)}
				onCancelSync={ignoreAction}
				onPreviewComparison={ignoreAction}
				onSync={ignoreAction}
				pendingAction={null}
				snapshot={repositorySnapshot}
			/>
		);

		expect(markup).toContain(">Push<");
		expect(markup).toContain("Push 2 commits to origin/main");
	});

	test("turns the same action into cancellation while syncing", () => {
		const repositorySnapshot = snapshot(head({ ahead: 2, behind: 1 }));
		const syncAction = getRepositorySyncAction(repositorySnapshot.head, []);
		const markup = renderToStaticMarkup(
			<CleanState
				cleanAction={getRepositoryCleanAction(syncAction, null)}
				onCancelSync={ignoreAction}
				onPreviewComparison={ignoreAction}
				onSync={ignoreAction}
				pendingAction="sync"
				snapshot={repositorySnapshot}
			/>
		);

		expect(markup).toContain('aria-busy="true"');
		expect(markup).toContain("Cancel syncing");
		expect(markup).toContain("Stop this operation");
	});

	test("explains a disabled publish action without adding another control", () => {
		const repositorySnapshot = snapshot(head({ upstream: null }));
		const syncAction = getRepositorySyncAction(repositorySnapshot.head, []);
		const markup = renderToStaticMarkup(
			<CleanState
				cleanAction={getRepositoryCleanAction(syncAction, null)}
				onCancelSync={ignoreAction}
				onPreviewComparison={ignoreAction}
				onSync={ignoreAction}
				pendingAction={null}
				snapshot={repositorySnapshot}
			/>
		);

		expect(markup).toContain("Publish branch");
		expect(markup).toContain("Add a remote before publishing this branch.");
		expect(markup).toContain("disabled");
	});

	test("offers a pull request preview without adding a second action", () => {
		const repositorySnapshot = snapshot(
			head({
				branch: "feature/clean-state",
				upstream: "origin/feature/clean-state",
			})
		);
		const syncAction = getRepositorySyncAction(repositorySnapshot.head, []);
		const markup = renderToStaticMarkup(
			<CleanState
				cleanAction={getRepositoryCleanAction(syncAction, {
					baseBranch: "main",
					baseRevision: "origin/main",
					browserActionLabel: "Open pull request",
					browserUrl:
						"https://github.com/openai/codex/compare/main...feature%2Fclean-state?expand=1",
					headBranch: "feature/clean-state",
				})}
				onCancelSync={ignoreAction}
				onPreviewComparison={ignoreAction}
				onSync={ignoreAction}
				pendingAction={null}
				snapshot={repositorySnapshot}
			/>
		);

		expect(markup).toContain("Preview pull request");
		expect(markup).toContain("Compare feature/clean-state with main");
		expect(markup).not.toContain(">Fetch<");
	});
});
