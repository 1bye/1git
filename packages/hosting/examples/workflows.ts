import { HostingClient } from "@1git/hosting";
import { GitHubProvider } from "@1git/hosting/providers/github";
import { GitLabProvider } from "@1git/hosting/providers/gitlab";
import type {
	HostingResult,
	Owner,
	RepositoryRef,
} from "@1git/hosting/contracts";

/** CLI examples are opt-in. Only this example reads environment variables, never the package. */
function unwrap<T>(result: HostingResult<T>): T {
	if (!result.ok)
		throw new Error(
			`${result.error.operation}: ${result.error.code} — ${result.error.message}`
		);

	return result.value;
}

function argument(index: number, name: string): string {
	const value = process.argv[index];

	if (!value) throw new Error(`Missing ${name}; see the package README.`);

	return value;
}

async function main(): Promise<void> {
	const providerId = process.env.HOSTING_PROVIDER;
	const accessToken = process.env.HOSTING_TOKEN;

	if ((providerId !== "github" && providerId !== "gitlab") || !accessToken)
		throw new Error(
			"Set HOSTING_PROVIDER to github/gitlab and provide HOSTING_TOKEN explicitly."
		);

	const options = {
		accessToken,
		webUrl: process.env.HOSTING_WEB_URL,
		apiUrl: process.env.HOSTING_API_URL,
	};

	const provider =
		providerId === "github"
			? new GitHubProvider(options)
			: new GitLabProvider(options);

	const client = unwrap(HostingClient.create(provider));

	const action = argument(2, "action (list, create, pr)");

	if (action === "list") {
		let cursor: string | undefined;

		do {
			const page = unwrap(await client.listRepositories({ cursor }));

			for (const repository of page.items)
				process.stdout.write(
					`${repository.ref.owner}/${repository.ref.name}\t${repository.browserUrl}\n`
				);

			cursor = page.next ?? undefined;
		} while (cursor);

		return;
	}

	if (action === "create") {
		const ownerPath = argument(3, "owner path");
		let owner: Owner | undefined;
		let cursor: string | undefined;

		do {
			const page = unwrap(await client.listOwners({ cursor }));

			owner = page.items.find((candidate) => candidate.path === ownerPath);
			cursor = page.next ?? undefined;
		} while (!owner && cursor);

		if (!owner)
			throw new Error("Owner not found among the account destinations.");

		const repository = unwrap(
			await client.createRepository({
				owner,
				name: argument(4, "repository name"),
				visibility: "private",
			})
		);

		process.stdout.write(`${repository.browserUrl}\n`);

		return;
	}

	if (action === "pr") {
		const repository: RepositoryRef = {
			owner: argument(3, "owner path"),
			name: argument(4, "repository name"),
		};

		const request = unwrap(
			await client.createPullRequest({
				repository,
				sourceBranch: argument(5, "source branch"),
				targetBranch: argument(6, "target branch"),
				title: argument(7, "title"),
				draft: true,
			})
		);

		process.stdout.write(`${request.browserUrl}\n`);

		return;
	}

	throw new Error("Unknown action; use list, create, or pr.");
}

await main();
