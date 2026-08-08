import type { DesktopIntegrationApi } from "./desktop-integration.js";
import type { DesktopGitApi } from "./git-ipc.js";
import type { RepositoryOwnerApi } from "./repository-owner-avatar.js";

export type DesktopPlatform =
	| "aix"
	| "android"
	| "cygwin"
	| "darwin"
	| "freebsd"
	| "haiku"
	| "linux"
	| "netbsd"
	| "openbsd"
	| "sunos"
	| "win32";

export interface DesktopApi {
	readonly git: DesktopGitApi;
	readonly integrations: DesktopIntegrationApi;
	readonly platform: DesktopPlatform;
	readonly repositoryOwners: RepositoryOwnerApi;
}
