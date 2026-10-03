/** Narrow OS vault boundary. Tests substitute this boundary, never a user's credential store. */
export interface CredentialVault {
	read(key: string): Promise<string | null>;
	write(key: string, token: string): Promise<void>;
	delete(key: string): Promise<void>;
}

/** GPUI platform credential store; no file, environment or plaintext fallback. */
export class NativeCredentials implements CredentialVault {
	constructor(private readonly renderer: object) {}

	async read(key: string): Promise<string | null> {
		NativeCredentials.validateKey(key);

		if (
			!("readHostingCredential" in this.renderer) ||
			typeof this.renderer.readHostingCredential !== "function"
		)
			throw new Error(
				"This build does not support secure account storage. Rebuild the native addon."
			);

		try {
			const bytes: unknown = await this.renderer.readHostingCredential(key);

			if (bytes === null) return null;

			if (!Buffer.isBuffer(bytes)) throw new Error("Invalid vault response.");

			try {
				return bytes.toString("utf8");
			} finally {
				bytes.fill(0);
			}
		} catch {
			throw new Error(
				"Could not read the OS credential store. Unlock it or allow access and try again."
			);
		}
	}

	async write(key: string, token: string): Promise<void> {
		NativeCredentials.validateKey(key);

		if (
			!("writeHostingCredential" in this.renderer) ||
			typeof this.renderer.writeHostingCredential !== "function"
		)
			throw new Error("Secure account storage is unavailable in this build.");

		const bytes = Buffer.from(token, "utf8");

		try {
			await this.renderer.writeHostingCredential(key, bytes);
		} catch {
			throw new Error(
				"Could not save to the OS credential store. The account was not connected."
			);
		} finally {
			bytes.fill(0);
		}
	}

	async delete(key: string): Promise<void> {
		NativeCredentials.validateKey(key);

		if (
			!("deleteHostingCredential" in this.renderer) ||
			typeof this.renderer.deleteHostingCredential !== "function"
		)
			throw new Error("Secure account storage is unavailable in this build.");

		try {
			await this.renderer.deleteHostingCredential(key);
		} catch {
			throw new Error(
				"Could not remove the saved credential. The account was left connected."
			);
		}
	}

	private static validateKey(key: string): void {
		if (!/^1git-hosting-v1:[a-f0-9]{64}$/.test(key))
			throw new Error("Invalid application credential key.");
	}
}
