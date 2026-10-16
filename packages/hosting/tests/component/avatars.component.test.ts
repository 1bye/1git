/**
 * Covers: public avatar lookup, thumbnail sizing, unchanged repository metadata and image origin validation.
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

it("resolves public GitHub owner images without API requests or credentials", async () => {
	const provider = new GitHubProvider({
		accessToken: () => {
			throw new Error("Credentials must not be read");
		},
		fetch: async () => {
			throw new Error("Public avatar lookup must not use the REST API");
		},
	});

	expect(
		value(await getRepositoryAvatar(provider, { owner: "alice", name: "demo" }))
	).toBe("https://avatars.githubusercontent.com/alice");
	expect(provider.avatarCacheKey({ owner: "Alice", name: "other" })).toBe(
		"alice"
	);
});

it("keeps Enterprise avatars on their configured host without reading credentials", async () => {
	const requests: RequestInit[] = [];

	const provider = new GitHubProvider({
		webUrl: "https://git.company.test",
		accessToken: () => {
			throw new Error("Credentials must not be read");
		},
		fetch: async (url, init = {}) => {
			expect(String(url)).toBe("https://git.company.test/api/v3/users/alice");
			requests.push(init);

			return Response.json({
				avatar_url: "https://git.company.test/avatars/alice.png",
			});
		},
	});

	expect(
		value(await getRepositoryAvatar(provider, { owner: "alice", name: "demo" }))
	).toBe("https://git.company.test/avatars/alice.png");
	expect(new Headers(requests[0]?.headers).has("authorization")).toBe(false);
});

it("rejects invalid public owners and honours cancellation before deriving an image URL", async () => {
	const provider = new GitHubProvider();
	const controller = new AbortController();

	controller.abort();
	const cancelled = await getRepositoryAvatar(
		provider,
		{ owner: "alice", name: "demo" },
		{ signal: controller.signal }
	);

	expect(cancelled.ok ? null : cancelled.error.code).toBe("cancelled");

	for (const owner of ["..", "a/b", "secret@github.com", "alice?token=secret"])
		expect(
			(await getRepositoryAvatar(provider, { owner, name: "demo" })).ok
		).toBe(false);
});

it("requests provider thumbnails without changing original metadata or image trust rules", () => {
	const github = new GitHubProvider();
	const gitlab = new GitLabProvider({ webUrl: "https://git.company.test" });
	const owner = "https://avatars.githubusercontent.com/u/1?v=4&s=1024";
	const project = "https://git.company.test/uploads/project.png?width=1024";

	expect(github.avatarThumbnailUrl(owner)).toBe(
		"https://avatars.githubusercontent.com/u/1?v=4&s=200"
	);
	expect(gitlab.avatarThumbnailUrl(project)).toBe(
		"https://git.company.test/uploads/project.png?width=200"
	);
	expect(github.avatarUrl(owner)).toBe(owner);
	expect(gitlab.avatarUrl(project)).toBe(project);
	expect(gitlab.avatarThumbnailUrl("/uploads/group.png")).toBe(
		"https://git.company.test/uploads/group.png?width=200"
	);

	for (const provider of [github, gitlab]) {
		for (const url of [
			"http://git.company.test/a.png",
			"https://secret@git.company.test/a.png",
			"https://evil.test/a.png",
			"https://git.company.test/a.png?width=invalid",
			"https://avatars.githubusercontent.com/u/1?token=secret",
		])
			expect(provider.avatarThumbnailUrl(url)).toBeNull();
	}
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
			webUrl: "https://git.company.test",
			fetch: async () => new Response(null, { status: 404 }),
		}),
		{ owner: "alice", name: "demo" }
	);

	expect(missing.ok ? null : missing.error.code).toBe("not-found");
});
