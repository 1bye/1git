import type { CallOptions, HostingResult, RepositoryRef } from "./contracts.js";
import type { HostingProvider } from "./provider.js";
import { Endpoints, Transport } from "./transport.js";
import { result } from "./result.js";

/** Public image metadata only. Provider credentials are deliberately never read or sent. */
export async function getRepositoryAvatar(
	provider: HostingProvider,
	ref: RepositoryRef,
	options: CallOptions = {}
): Promise<HostingResult<string | null>> {
	return await result("get-repository-avatar", async () => {
		const http = new Transport(new Endpoints(provider));

		return provider.avatarUrl(
			await provider.repositoryAvatar(http, ref, options)
		);
	});
}
