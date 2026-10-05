/**
 * Covers: public avatar lookup, repository metadata and image origin validation.
 * Real: providers, transport, response normalization and Result handling.
 * Doubles: HTTP responses; no live hosting accounts.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { getRepositoryAvatar } from "../../src/avatars.js";
import { GitHubProvider } from "../../src/providers/github/provider.js";
import { GitLabProvider } from "../../src/providers/gitlab/provider.js";
import {
	capture,
	githubRepository,
	gitlabRepository,
	value,
} from "../_shared/fixtures.js";

it("resolves GitHub owner images without touching configured credentials", async () => {
	const requests: RequestInit[] = [];

	const provider = new GitHubProvider({
		accessToken: () => {
			throw new Error("Credentials must not be read");
		},
		fetch: async (url, init = {}) => {
			expect(String(url)).toBe("https://api.github.com/users/alice");
			requests.push(init);

			return Response.json({
				avatar_url: "https://avatars.githubusercontent.com/u/1",
			});
		},
	});

	expect(
		value(await getRepositoryAvatar(provider, { owner: "alice", name: "demo" }))
	).toBe("https://avatars.githubusercontent.com/u/1");
	expect(new Headers(requests[0]?.headers).has("authorization")).toBe(false);
	expect(provider.avatarCacheKey({ owner: "Alice", name: "other" })).toBe(
		"alice"
	);
});

it("normalizes list/get avatar metadata without accepting unrelated destinations", async () => {
	const gh = capture("github", () =>
		Response.json({
			...githubRepository(),
			owner: {
				login: "alice",
				avatar_url: "https://avatars.githubusercontent.com/u/1",
			},
		})
	);

	const gl = capture("gitlab", () =>
		Response.json({
			...gitlabRepository(),
			namespace: { avatar_url: "/uploads/group.png" },
		})
	);

	expect(
		value(await gh.client.getRepository({ owner: "alice", name: "demo" }))
			.avatarUrl
	).toBe("https://avatars.githubusercontent.com/u/1");
	expect(
		value(await gl.client.getRepository({ owner: "team/sub", name: "demo" }))
			.avatarUrl
	).toBe("https://gitlab.com/uploads/group.png");

	for (const url of [
		"http://gitlab.com/a.png",
		"https://secret@gitlab.com/a.png",
		"https://evil.test/a.png",
		"data:image/png;base64,AAAA",
	]) {
		expect(new GitLabProvider().avatarUrl(url)).toBeNull();
	}

	expect(
		new GitHubProvider({ webUrl: "https://git.example.test" }).avatarUrl(
			"https://avatars.githubusercontent.com/u/1"
		)
	).toBeNull();
	expect(
		new GitHubProvider({ webUrl: "https://git.example.test" }).avatarUrl(
			"https://git.example.test/avatar.png"
		)
	).toBe("https://git.example.test/avatar.png");
});

it("resolves public GitLab project images and reports cancelled/failed lookups safely", async () => {
	const provider = new GitLabProvider({
		fetch: async (url) => {
			expect(String(url)).toBe(
				"https://gitlab.com/api/v4/projects/team%2Fsub%2Fdemo"
			);

			return Response.json({
				...gitlabRepository(),
				avatar_url: "https://gitlab.com/uploads/demo.png",
			});
		},
	});

	expect(
		value(
			await getRepositoryAvatar(provider, { owner: "team/sub", name: "demo" })
		)
	).toBe("https://gitlab.com/uploads/demo.png");

	const controller = new AbortController();

	controller.abort();
	const cancelled = await getRepositoryAvatar(
		provider,
		{ owner: "team/sub", name: "demo" },
		{ signal: controller.signal }
	);

	expect(cancelled.ok).toBe(false);

	const missing = await getRepositoryAvatar(
		new GitHubProvider({
			fetch: async () => new Response(null, { status: 404 }),
		}),
		{ owner: "alice", name: "demo" }
	);

	expect(missing.ok ? null : missing.error.code).toBe("not-found");
});
