/** Canonical source repository; deployments can override it for a fork. */
export const REPO_URL =
	import.meta.env.PUBLIC_REPO_URL?.trim() || "https://github.com/1bye/1git";
