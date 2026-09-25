import { describe, expect, test } from "bun:test";

import type { RemoteInfo } from "@1git/git";

import { getRepositoryOwner } from "../src/renderer/src/feature/workspace/lib/repository-owner.js";

const remote = (
	name: string,
	fetchUrl: string,
	pushUrl = fetchUrl
): RemoteInfo => ({
	defaultBranch: null,
	fetchUrls: [fetchUrl],
	name,
	pushUrls: [pushUrl],
});

describe("repository owner", () => {
	test("reads an owner from an HTTPS origin", () => {
		expect(
			getRepositoryOwner(
				[remote("origin", "https://github.com/openai/codex.git")],
				null
			)
		).toEqual({
			host: "github.com",
			name: "openai",
			namespace: "openai",
			remoteName: "origin",
		});
	});

	test("reads an owner from an SCP-style SSH remote", () => {
		expect(
			getRepositoryOwner(
				[remote("origin", "git@gitlab.example.com:platform/desktop.git")],
				null
			)
		).toEqual({
			host: "gitlab.example.com",
			name: "platform",
			namespace: "platform",
			remoteName: "origin",
		});
	});

	test("preserves nested namespaces", () => {
		expect(
			getRepositoryOwner(
				[
					remote(
						"origin",
						"ssh://git@gitlab.example.com/company/platform/desktop.git"
					),
				],
				null
			)
		).toEqual({
			host: "gitlab.example.com",
			name: "platform",
			namespace: "company/platform",
			remoteName: "origin",
		});
	});

	test("prefers origin over another hosted upstream", () => {
		expect(
			getRepositoryOwner(
				[
					remote("upstream", "https://github.com/upstream/desktop.git"),
					remote("origin", "https://github.com/fork-owner/desktop.git"),
				],
				"upstream/main"
			)
		).toEqual({
			host: "github.com",
			name: "fork-owner",
			namespace: "fork-owner",
			remoteName: "origin",
		});
	});

	test("falls back to the upstream remote when origin is local", () => {
		expect(
			getRepositoryOwner(
				[
					remote("origin", "/tmp/local-repository.git"),
					remote("upstream", "https://github.com/one-git/desktop.git"),
				],
				"upstream/main"
			)
		).toEqual({
			host: "github.com",
			name: "one-git",
			namespace: "one-git",
			remoteName: "upstream",
		});
	});

	test("returns null when no hosted remote identifies an owner", () => {
		expect(
			getRepositoryOwner([remote("origin", "/tmp/local-repository.git")], null)
		).toBeNull();
	});
});
