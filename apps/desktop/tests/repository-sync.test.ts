import { describe, expect, test } from "bun:test";
import type { HeadState, RemoteInfo } from "@1git/git";
import {
	getRepositorySyncAction,
	getRepositorySyncSteps,
	isRepositorySyncActionKind,
	repositorySyncProgressLabel,
} from "../src/renderer/src/feature/workspace/lib/repository-sync.js";

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

const remote = (
	name: string,
	{ canPush = true }: { readonly canPush?: boolean } = {}
): RemoteInfo => ({
	fetchUrls: [`https://example.com/${name}.git`],
	name,
	pushUrls: canPush ? [`https://example.com/${name}.git`] : [],
});

describe("repository sync action", () => {
	test("maps tracking state to one primary action", () => {
		expect(getRepositorySyncAction(head(), []).kind).toBe("fetch");
		expect(getRepositorySyncAction(head({ behind: 2 }), []).kind).toBe("pull");
		expect(getRepositorySyncAction(head({ ahead: 3 }), []).kind).toBe("push");
		expect(
			getRepositorySyncAction(head({ ahead: 3, behind: 2 }), []).kind
		).toBe("sync");
	});

	test("publishes an untracked branch to the preferred push remote", () => {
		const action = getRepositorySyncAction(head({ upstream: null }), [
			remote("backup"),
			remote("origin"),
		]);

		expect(action).toMatchObject({
			disabledReason: null,
			kind: "publish",
			label: "Publish branch",
			remoteName: "origin",
		});
		expect(getRepositorySyncSteps(action, "main")).toEqual([
			{
				input: {
					branch: "main",
					remote: "origin",
					setUpstream: true,
				},
				kind: "push",
			},
		]);
	});

	test("explains why an untracked branch cannot be published", () => {
		const noRemote = getRepositorySyncAction(head({ upstream: null }), []);
		const noCommit = getRepositorySyncAction(
			head({ oid: null, unborn: true, upstream: null }),
			[remote("origin")]
		);

		expect(noRemote.disabledReason).toBe(
			"Add a remote before publishing this branch."
		);
		expect(noCommit.disabledReason).toBe(
			"Create or check out a branch with a commit first."
		);
		expect(getRepositorySyncSteps(noRemote, "main")).toEqual([]);
	});

	test("uses a non-rewriting pull before pushing a diverged branch", () => {
		const action = getRepositorySyncAction(head({ ahead: 3, behind: 2 }), []);

		expect(getRepositorySyncSteps(action, "main")).toEqual([
			{ input: { strategy: "merge" }, kind: "pull" },
			{ input: {}, kind: "push" },
		]);
	});
});

describe("repository sync progress", () => {
	test("recognizes and labels only sync operations", () => {
		expect(isRepositorySyncActionKind("publish")).toBe(true);
		expect(isRepositorySyncActionKind("commit")).toBe(false);
		expect(repositorySyncProgressLabel("fetch")).toBe("Fetching");
		expect(repositorySyncProgressLabel("sync")).toBe("Syncing");
	});
});
