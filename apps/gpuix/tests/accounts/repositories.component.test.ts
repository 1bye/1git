/**
 * Covers: provider browsing/search/pages, read-only PR metadata, account isolation, permission failures and verified clone destinations.
 * Real: Accounts, providers/transport and disposable AccountStore.
 * Doubles: HTTPS provider replies, credential vault and Git clone boundary; no live accounts.
 * Requires: built @1git/git and @1git/hosting.
 */
import { afterEach, expect, it, mock, spyOn } from "bun:test";
import { rmSync } from "node:fs";
import { GitRepository } from "@1git/git";
import { hostingRepositories } from "../_shared/hosting-repositories";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import { AccountAuthorization } from "../../src/feature/accounts/lib/account-authorization";
import { encodeCredential } from "../../src/feature/accounts/lib/account-credential";

const directories: string[] = [];

afterEach(() => {
	mock.restore();

	for (const path of directories.splice(0))
		rmSync(path, { recursive: true, force: true });
});
function fixture() {
	const value = hostingRepositories();

	directories.push(value.directory);

	return value;
}

it("reads repository review metadata with verified credentials and GET-only pagination", async () => {
	const f = fixture();
	const methods: string[] = [];
	const saved = f.store.load();
	const credential = f.secrets.get(AccountStore.key(f.saved[0]!));

	f.intercept(async (input, init) => {
		const url = new URL(input);

		methods.push(init?.method ?? "GET");

		if (url.pathname === "/user")
			return Response.json({
				id: 7,
				login: "tester",
				html_url: "https://github.com/tester",
			});

		if (url.pathname === "/repos/tester/project")
			return Response.json(f.repo());

		const next = url.searchParams.get("page") !== "2";

		return Response.json(
			[
				{
					id: next ? 100 : 101,
					number: next ? 1 : 2,
					title: "Review",
					body: null,
					state: "open",
					draft: false,
					merged_at: null,
					head: { ref: "feature", repo: { id: 10 } },
					base: { ref: "main" },
					html_url: "https://github.com/tester/project/pull/1",
				},
			],
			{
				headers: next
					? {
							link: '<https://api.github.com/repos/tester/project/pulls?state=open&sort=updated&direction=desc&per_page=100&page=2>; rel="next"',
						}
					: {},
			}
		);
	});

	const result = await f.accounts.repositoryReviews(
		f.saved[0]!,
		{ owner: "tester", name: "project" },
		new AbortController().signal
	);

	expect(result.repository.defaultBranch).toBe("main");
	expect(result.requests.map((item) => item.number)).toEqual([1, 2]);
	expect(result.requests[0]?.sourceRepositoryId).toBe("10");
	expect(result.complete).toBe(true);
	expect(methods).toEqual(["GET", "GET", "GET", "GET"]);
	expect(
		f.requests.every(
			({ headers }) =>
				headers.get("authorization") === "Bearer fixture-github-token"
		)
	).toBe(true);
	expect(f.store.load()).toEqual(saved);
	expect(f.secrets.get(AccountStore.key(f.saved[0]!))).toBe(credential);
	expect(JSON.stringify(result)).not.toContain("fixture-github-token");
});

it("does not read reviews after cancellation or account identity mismatch", async () => {
	const f = fixture();
	const controller = new AbortController();
	const ref = { owner: "tester", name: "project" };

	controller.abort();
	await expect(
		f.accounts.repositoryReviews(f.saved[0]!, ref, controller.signal)
	).rejects.toThrow();
	expect(f.requests).toHaveLength(0);
	f.identity(99);
	await expect(
		f.accounts.repositoryReviews(f.saved[0]!, ref, new AbortController().signal)
	).rejects.toThrow("identity");
	expect(f.requests.map(({ url }) => url.pathname)).toEqual(["/user"]);
});

it("browses both providers, searches and continues with account-bound cursors", async () => {
	const f = fixture();
	const page = await f.accounts.repositories(f.saved[0]!, "", { pageSize: 30 });

	expect(page.items[0]?.ref).toEqual({ owner: "tester", name: "project" });
	expect(page.next).not.toBeNull();
	const more = await f.accounts.repositories(f.saved[0]!, "", {
		pageSize: 30,
		cursor: page.next!,
	});

	expect(more.items[0]?.ref.name).toBe("other");
	expect(more.next).toBeNull();
	const search = await f.accounts.repositories(f.saved[0]!, "  other  ", {
		pageSize: 30,
	});

	expect(search.items[0]?.ref.name).toBe("other");
	expect(f.requests.at(-1)?.url.searchParams.get("q")).toBe("other");
	const lab = await f.accounts.repositories(f.saved[1]!, "", { pageSize: 30 });

	expect(lab.items[0]?.ref).toEqual({
		owner: "group/nested",
		name: "lab-project",
	});
	expect(f.requests.at(-1)?.headers.get("authorization")).toBe(
		"Bearer fixture-gitlab-token"
	);
	await expect(
		f.accounts.repositories(f.saved[1]!, "", {
			pageSize: 30,
			cursor: page.next!,
		})
	).rejects.toThrow();
});

it("reports safe permission/expired/removed/identity errors without cloning", async () => {
	const f = fixture();
	const account = f.saved[0]!;

	f.status(403);
	await expect(f.accounts.repositories(account, "")).rejects.toThrow(
		"repository access"
	);
	f.status(200);
	f.identity(9);
	await expect(
		f.accounts.clone(
			account,
			{ owner: "tester", name: "project" },
			"/unused",
			new AbortController().signal
		)
	).rejects.toThrow("identity");
	f.identity(7);
	f.secrets.delete(AccountStore.key(account));
	await expect(
		f.accounts.clone(
			account,
			{ owner: "tester", name: "project" },
			"/unused",
			new AbortController().signal
		)
	).rejects.toThrow("no saved token");
	f.store.save([]);
	await expect(f.accounts.repositories(account, "")).rejects.toThrow();
});

it.each([false, true])(
	"re-resolves clone URLs and rejects unexpected hosts, paths and credentials (prepared parent: %s)",
	async (requireExistingParent) => {
		const f = fixture();

		const clone = spyOn(GitRepository, "clone").mockResolvedValue({
			ok: false,
			error: {
				code: "aborted",
				message: "Fixture clone",
				operation: "clone-repository",
				retryable: false,
			},
		});

		const signal = new AbortController().signal;

		for (const remote of [
			"https://evil.example/tester/project.git",
			"https://github.com/tester/other.git",
			"https://token@github.com/tester/project.git",
			"https://github.com/tester/project.git?token=secret",
		]) {
			f.remote(remote);
			await expect(
				f.accounts.clone(
					f.saved[0]!,
					{ owner: "tester", name: "project" },
					"/unused",
					signal
				)
			).rejects.toThrow();
		}

		expect(clone).not.toHaveBeenCalled();
		f.remote("https://github.com/tester/project.git");
		await f.accounts.clone(
			f.saved[0]!,
			{ owner: "tester", name: "project" },
			"/unused",
			signal,
			requireExistingParent
		);
		expect(clone).toHaveBeenCalledWith({
			path: "/unused",
			...(requireExistingParent ? { requireExistingParent: true } : {}),
			remoteUrl: "https://github.com/tester/project.git",
			signal,
			httpAuthentication: {
				username: "x-access-token",
				password: "fixture-github-token",
			},
		});
	}
);

it("passes cancellation and rejects invalid queries before fetching", async () => {
	const f = fixture();
	const controller = new AbortController();

	controller.abort();
	await expect(
		f.accounts.repositories(f.saved[0]!, "", { signal: controller.signal })
	).rejects.toThrow();
	await expect(
		f.accounts.repositories(f.saved[0]!, "x".repeat(257))
	).rejects.toThrow("256");
	expect(f.requests).toHaveLength(0);
});

it("requests broader GitHub scopes only after explicit opt-in", async () => {
	const requested: string[] = [];

	const authorization = new AccountAuthorization(
		async (url, init) => {
			if (new URL(url).pathname === "/login/device/code") {
				requested.push(
					new URLSearchParams(String(init?.body)).get("scope") ?? ""
				);

				return Response.json({
					device_code: "fixture-device",
					user_code: "ABCD-EFGH",
					verification_uri: "https://github.com/login/device",
					interval: 1,
					expires_in: 900,
				});
			}

			return Response.json({
				access_token: "fixture-access",
				token_type: "bearer",
				scope: requested.at(-1),
			});
		},
		async () => undefined
	);

	await authorization.authorize({
		provider: "github",
		webUrl: "https://github.com",
		registration: { clientId: "fixture-client" },
		signal: new AbortController().signal,
	});
	await authorization.authorize({
		provider: "github",
		webUrl: "https://github.com",
		registration: { clientId: "fixture-client" },
		repositoryAccess: true,
		signal: new AbortController().signal,
	});
	expect(requested).toEqual(["read:user", "read:user repo"]);
});

it("refreshes before browsing and reports granted repository scopes without exposing the pair", async () => {
	const f = fixture();
	const key = AccountStore.key(f.saved[0]!);

	f.secrets.set(
		key,
		encodeCredential({
			token: "expired-fixture",
			oauth: {
				registration: { clientId: "fixture-client" },
				tokens: {
					accessToken: "expired-fixture",
					refreshToken: "fixture-refresh",
					tokenType: "bearer",
					expiresAt: Date.now() - 1000,
					refreshExpiresAt: null,
					scopes: ["read:user", "repo"],
				},
			},
		})
	);
	let refreshes = 0;

	f.intercept(async (url, init) => {
		if (new URL(url).pathname === "/login/oauth/access_token") {
			refreshes++;

			return Response.json({
				access_token: "rotated-fixture",
				refresh_token: "rotated-refresh",
				token_type: "bearer",
				expires_in: 7200,
				scope: "read:user repo",
			});
		}

		expect(new Headers(init?.headers).get("authorization")).toBe(
			"Bearer rotated-fixture"
		);

		return new URL(url).pathname === "/user"
			? Response.json({
					id: 7,
					login: "tester",
					name: null,
					html_url: "https://github.com/tester",
				})
			: Response.json([f.repo()]);
	});
	const page = await f.accounts.repositories(f.saved[0]!, "");

	expect(page.items).toHaveLength(1);
	expect(refreshes).toBe(1);
	expect(f.secrets.get(key)).toContain("rotated-refresh");
	expect(await f.accounts.repositoryAccess(f.saved[0]!)).toBe(true);
	expect(JSON.stringify(page)).not.toContain("rotated-fixture");
});
