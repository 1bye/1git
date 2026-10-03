import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostingFetch } from "@1git/hosting/contracts";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import {
	AccountStore,
	type SavedAccount,
} from "../../src/feature/accounts/lib/account-store";

/** Disposable metadata and captured provider HTTP/vault; never discovers real accounts. */
export function hostingRepositories() {
	const directory = mkdtempSync(join(tmpdir(), "1git-hosting-repositories-"));
	const store = new AccountStore(join(directory, "accounts.json"));

	const saved: SavedAccount[] = [
		{
			provider: "github",
			id: "7",
			username: "tester",
			webUrl: "https://github.com/",
		},
		{
			provider: "gitlab",
			id: "8",
			username: "lab-user",
			webUrl: "https://gitlab.com/",
		},
	];

	store.save(saved);
	const secrets = new Map(
		saved.map((account) => [
			AccountStore.key(account),
			`fixture-${account.provider}-token`,
		])
	);

	const requests: { url: URL; headers: Headers }[] = [];
	let repositoryStatus = 200;
	let identity = 7;
	let remote = "https://github.com/tester/project.git";
	let intercept: HostingFetch | undefined;

	const repo = (id = 10) => ({
		id,
		name: id === 10 ? "project" : "other",
		full_name: `tester/${id === 10 ? "project" : "other"}`,
		owner: { login: "tester" },
		description: "A disposable repository",
		private: true,
		default_branch: "main",
		html_url: `https://github.com/tester/${id === 10 ? "project" : "other"}`,
		clone_url: id === 10 ? remote : "https://github.com/tester/other.git",
		ssh_url: "git@github.com:tester/project.git",
		permissions: { pull: true, push: true, admin: false },
	});

	const http: HostingFetch = async (value, init) => {
		const url = new URL(value);

		requests.push({ url, headers: new Headers(init?.headers) });

		if (intercept) return await intercept(value, init);

		if (url.pathname === "/user")
			return Response.json({
				id: identity,
				login: "tester",
				name: null,
				html_url: "https://github.com/tester",
			});

		if (url.pathname === "/api/v4/user")
			return Response.json({
				id: 8,
				username: "lab-user",
				name: null,
				web_url: "https://gitlab.com/lab-user",
			});

		if (repositoryStatus !== 200)
			return Response.json(
				{ message: "never-display-provider-secret" },
				{ status: repositoryStatus }
			);

		if (url.pathname === "/user/repos")
			return Response.json(
				[repo(url.searchParams.get("page") === "2" ? 11 : 10)],
				{
					headers:
						url.searchParams.get("page") === "2"
							? {}
							: {
									link: '<https://api.github.com/user/repos?page=2&per_page=30&sort=updated&affiliation=owner%2Ccollaborator%2Corganization_member>; rel="next"',
								},
				}
			);

		if (url.pathname === "/search/repositories")
			return Response.json({
				items: url.searchParams.get("q") === "missing" ? [] : [repo(11)],
			});

		if (url.pathname === "/api/v4/projects")
			return Response.json([
				{
					id: 20,
					name: "lab-project",
					path: "lab-project",
					path_with_namespace: "group/nested/lab-project",
					description: null,
					visibility: "private",
					default_branch: "main",
					web_url: "https://gitlab.com/group/nested/lab-project",
					http_url_to_repo: "https://gitlab.com/group/nested/lab-project.git",
					ssh_url_to_repo: "git@gitlab.com:group/nested/lab-project.git",
				},
			]);

		if (url.pathname === "/repos/tester/project") return Response.json(repo());

		return Response.json({}, { status: 404 });
	};

	const accounts = new Accounts(
		store,
		{
			async read(key) {
				return secrets.get(key) ?? null;
			},
			async write(key, value) {
				secrets.set(key, value);
			},
			async delete(key) {
				secrets.delete(key);
			},
		},
		http
	);

	return {
		directory,
		store,
		accounts,
		saved,
		secrets,
		requests,
		repo,
		status(value: number) {
			repositoryStatus = value;
		},
		identity(value: number) {
			identity = value;
		},
		remote(value: string) {
			remote = value;
		},
		intercept(value: HostingFetch) {
			intercept = value;
		},
	};
}
