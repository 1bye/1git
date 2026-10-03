import type { CallOptions } from "../../contracts.js";
import type {
	DeviceOAuthApplication,
	ProviderDeviceOAuthAdapter,
} from "../../provider.js";
import type { Transport } from "../../transport.js";

export class GitHubDeviceOAuthAdapter implements ProviderDeviceOAuthAdapter {
	constructor(private readonly http: Transport) {}
	async begin(
		application: DeviceOAuthApplication,
		options: CallOptions
	): Promise<unknown> {
		const response = await this.http.request(
			new URL("login/device/code", this.http.endpoints.web),
			"POST",
			options,
			new URLSearchParams({
				client_id: application.clientId,
				scope: application.scopes.join(" "),
			}),
			undefined,
			true
		);

		return response.data;
	}
	async exchange(
		grant: Readonly<Record<string, string>>,
		application: DeviceOAuthApplication,
		options: CallOptions
	): Promise<unknown> {
		const response = await this.http.request(
			new URL("login/oauth/access_token", this.http.endpoints.web),
			"POST",
			options,
			new URLSearchParams({ ...grant, client_id: application.clientId }),
			undefined,
			true
		);

		return response.data;
	}
}
