import { hasControlCharacters, type SavedAccount } from "./account-store";

/** Public setup defaults, not embedded application registrations or credentials. */
export const accountSetup = {
	github: { name: "GitHub", host: "https://github.com" },
	gitlab: { name: "GitLab", host: "https://gitlab.com" },
} as const;

export const applicationHomepage = "https://github.com/1bye/1git";
export const defaultAccountCallback = "http://127.0.0.1:8765/oauth/callback";

/** Opens a draft issue only; submitting a request or contributing a provider remains the user's choice. */
export const missingProviderUrl = `${applicationHomepage}/issues/new?${new URLSearchParams(
	{
		title: "Hosting provider request",
		body: "Provider name and host:\n\nWhat would you like to connect?\n\nContributions are welcome: add a provider folder extending HostingProvider in packages/hosting/src/providers. See packages/hosting/README.md for the API and test requirements.",
	}
)}`;

/** Setup links follow the selected HTTPS host, preserve self-managed base paths, and never include credentials. */
export function accountSetupUrl(
	provider: SavedAccount["provider"],
	host: string,
	method: "browser" | "token"
): string | undefined {
	if (!host.trim() || host.length > 2048 || hasControlCharacters(host))
		return undefined;

	let url: URL;

	try {
		url = new URL(host.trim());
	} catch {
		return undefined;
	}

	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		return undefined;

	const path =
		provider === "github"
			? method === "browser"
				? "settings/applications/new"
				: "settings/personal-access-tokens/new"
			: method === "browser"
				? "user_settings/applications"
				: "-/user_settings/personal_access_tokens";

	url.pathname = `${url.pathname.replace(/\/+$/u, "")}/${path}`;

	if (method === "token") {
		url.searchParams.set("name", "1git");

		if (provider === "github") url.searchParams.set("expires_in", "30");
		else url.searchParams.set("scopes", "read_user");
	}

	return url.href;
}
