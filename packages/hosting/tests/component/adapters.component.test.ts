/**
 * Covers: both adapters' repository, owner and review-request contracts and wire serialization.
 * Real: hosting clients, adapters, validation and normalization.
 * Doubles: captured HTTP responses; does not prove a live provider accepts requests.
 * Requires: none.
 */
import { expect, test } from "bun:test";
import {
	capture,
	githubPull,
	githubRepository,
	gitlabPull,
	gitlabRepository,
	value,
} from "../_shared/fixtures.js";

test("GitHub account, destinations and repository permissions", async () => {
	const { client, requests } = capture("github", (url) =>
		Response.json(
			url.pathname === "/user"
				? {
						id: 1,
						login: "alice",
						name: "Alice",
						html_url: "https://github.com/alice",
					}
				: url.pathname === "/user/orgs"
					? [{ id: 2, login: "team" }]
					: url.pathname === "/user/repos"
						? [githubRepository()]
						: githubRepository()
		)
	);

	expect(value(await client.getAccount()).username).toBe("alice");
	expect(value(await client.listOwners()).items).toEqual([
		{ id: "1", path: "alice", kind: "user", canCreateRepository: null },
		{ id: "2", path: "team", kind: "organization", canCreateRepository: null },
	]);
	const repo = value(await client.listRepositories()).items[0];

	expect(repo?.permissions).toEqual({ read: true, push: true, admin: false });
	expect(repo?.cloneUrls.https).not.toContain("fake-token");
	expect(
		value(await client.getRepository({ owner: "alice", name: "demo" })).ref.name
	).toBe("demo");
	expect(
		requests.every(
			({ init }) =>
				new Headers(init.headers).get("Authorization") === "Bearer fake-token"
		)
	).toBe(true);
});

test("GitHub search preserves provider query semantics", async () => {
	const { client, requests } = capture("github", () =>
		Response.json({ items: [githubRepository()], incomplete_results: false })
	);

	expect(
		value(await client.searchRepositories("org:team topic:desktop")).items
	).toHaveLength(1);
	expect(requests[0]?.url.searchParams.get("q")).toBe("org:team topic:desktop");
});

test("GitHub creates user/org repositories but never another user's repository", async () => {
	const { client, requests } = capture("github", (url) =>
		Response.json(
			url.pathname === "/user"
				? { id: 1, login: "alice", html_url: "https://github.com/alice" }
				: githubRepository()
		)
	);

	const input = {
		name: "demo",
		owner: {
			id: "1",
			path: "alice",
			kind: "user" as const,
			canCreateRepository: null,
		},
		visibility: "private" as const,
		initialize: true,
	};

	expect((await client.createRepository(input)).ok).toBe(true);
	expect(JSON.parse(String(requests.at(-1)?.init.body))).toMatchObject({
		name: "demo",
		private: true,
		auto_init: true,
	});
	expect(
		(
			await client.createRepository({
				...input,
				owner: { ...input.owner, id: "2", path: "team", kind: "organization" },
			})
		).ok
	).toBe(true);
	expect(requests.at(-1)?.url.pathname).toBe("/orgs/team/repos");
	expect(
		await client.createRepository({
			...input,
			owner: { ...input.owner, path: "someone" },
		})
	).toMatchObject({ ok: false, error: { code: "permission" } });
	expect(
		await client.createRepository({ ...input, visibility: "internal" })
	).toMatchObject({ ok: false, error: { code: "unsupported" } });
});

test("GitHub lists, gets and creates draft fork PRs", async () => {
	const { client, requests } = capture("github", (url, init) =>
		Response.json(
			url.pathname.endsWith("/pulls") && init.method === "GET"
				? [
						githubPull(),
						{
							...githubPull(),
							id: 101,
							state: "closed",
							merged_at: "2026-01-01",
						},
					]
				: githubPull()
		)
	);

	const repository = { owner: "alice", name: "demo" };

	expect(
		value(
			await client.listPullRequests(repository, { state: "merged" })
		).items.map((pr) => pr.state)
	).toEqual(["merged"]);
	expect(requests[0]?.url.searchParams.get("state")).toBe("closed");
	expect(value(await client.getPullRequest(repository, 1))).toMatchObject({
		draft: true,
		sourceRepositoryId: "7",
	});
	expect(
		(
			await client.createPullRequest({
				repository,
				sourceRepository: { owner: "bob", name: "fork" },
				sourceBranch: "feature",
				targetBranch: "main",
				title: "Change",
				draft: true,
			})
		).ok
	).toBe(true);
	expect(JSON.parse(String(requests.at(-1)?.init.body))).toEqual({
		title: "Change",
		head: "bob:feature",
		head_repo: "fork",
		base: "main",
		draft: true,
	});
});

test("GitLab namespace listing, membership list and search use distinct endpoints/filters", async () => {
	const { client, requests } = capture("gitlab", (url) =>
		Response.json(
			url.pathname.endsWith("/user")
				? {
						id: 1,
						username: "alice",
						name: null,
						web_url: "https://gitlab.com/alice",
					}
				: url.pathname.endsWith("/namespaces")
					? [{ id: 2, full_path: "team/sub", kind: "group" }]
					: [gitlabRepository()]
		)
	);

	expect(value(await client.getAccount()).name).toBeNull();
	expect(value(await client.listOwners()).items[0]?.kind).toBe("group");
	expect(value(await client.listRepositories()).items[0]?.visibility).toBe(
		"internal"
	);
	expect(requests.at(-1)?.url.searchParams.get("membership")).toBe("true");
	expect((await client.searchRepositories("demo")).ok).toBe(true);
	expect(requests.at(-1)?.url.searchParams.has("membership")).toBe(false);
});

test("GitLab project paths are encoded once; creating uses namespace IDs", async () => {
	const { client, requests } = capture("gitlab", () =>
		Response.json(gitlabRepository())
	);

	expect(
		value(await client.getRepository({ owner: "team/sub", name: "demo" }))
			.permissions
	).toEqual({ read: true, push: true, admin: false });
	expect(requests[0]?.url.pathname).toBe("/api/v4/projects/team%2Fsub%2Fdemo");
	expect(
		(
			await client.createRepository({
				owner: {
					id: "2",
					path: "team/sub",
					kind: "group",
					canCreateRepository: null,
				},
				name: "demo",
				visibility: "internal",
			})
		).ok
	).toBe(true);
	expect(JSON.parse(String(requests.at(-1)?.init.body))).toMatchObject({
		namespace_id: "2",
		path: "demo",
		visibility: "internal",
	});
});

test("GitLab gets/lists merge requests and creates forks against the target project", async () => {
	const { client, requests } = capture("gitlab", (url, init) =>
		Response.json(
			url.pathname.endsWith("/merge_requests")
				? init.method === "GET"
					? [gitlabPull()]
					: gitlabPull()
				: url.pathname.endsWith("/merge_requests/2")
					? gitlabPull()
					: gitlabRepository()
		)
	);

	const repository = { owner: "team/sub", name: "demo" };

	expect(value(await client.listPullRequests(repository)).items[0]?.state).toBe(
		"open"
	);
	expect(value(await client.getPullRequest(repository, 2))).toMatchObject({
		number: 2,
		sourceRepositoryId: "17",
	});
	expect(
		(
			await client.createPullRequest({
				repository,
				sourceRepository: { owner: "alice", name: "fork" },
				sourceBranch: "feature",
				targetBranch: "main",
				title: "Change",
				draft: true,
			})
		).ok
	).toBe(true);
	expect(requests.at(-1)?.url.pathname).toBe(
		"/api/v4/projects/alice%2Ffork/merge_requests"
	);
	expect(JSON.parse(String(requests.at(-1)?.init.body))).toMatchObject({
		target_project_id: "20",
		title: "Draft: Change",
	});
});

test("missing permission metadata is unknown rather than granted", async () => {
	for (const provider of ["github", "gitlab"] as const) {
		const repo =
			provider === "github" ? githubRepository() : gitlabRepository();

		const { client } = capture(provider, () =>
			Response.json({ ...repo, permissions: undefined })
		);

		expect(
			value(await client.getRepository({ owner: "a", name: "b" })).permissions
		).toEqual({ read: null, push: null, admin: null });
	}
});
