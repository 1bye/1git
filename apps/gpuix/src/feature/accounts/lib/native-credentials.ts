/** Narrow OS vault boundary. Tests substitute this boundary, never a user's credential store. */
export interface CredentialVault {
	read(key: string): Promise<string | null>;
	write(key: string, token: string): Promise<void>;
	delete(key: string): Promise<void>;
}

/** Window-owned OS vault with approved values reused in memory; no file or environment fallback. */
export class NativeCredentials implements CredentialVault {
	private readonly entries = new Map<string, Promise<string | null>>();

	constructor(private readonly renderer: object) {}

	async read(key: string): Promise<string | null> {
		NativeCredentials.validateKey(key);

		return await this.access(key, async () => await this.readNative(key));
	}

	async write(key: string, token: string): Promise<void> {
		NativeCredentials.validateKey(key);
		await this.access(
			key,
			async () => {
				await this.writeNative(key, token);

				return token;
			},
			true
		);
	}

	async delete(key: string): Promise<void> {
		NativeCredentials.validateKey(key);
		await this.access(
			key,
			async () => {
				await this.deleteNative(key);

				return null;
			},
			true
		);
	}

	private async access(
		key: string,
		operation: () => Promise<string | null>,
		replacing = false
	): Promise<string | null> {
		const previous = this.entries.get(key);

		if (previous && !replacing) return await previous;

		const pending = (async () => {
			// Queue rotations/removal behind reads so a late result cannot resurrect stale credentials.
			if (replacing) await previous?.catch(() => undefined);

			return await operation();
		})();

		this.entries.set(key, pending);

		try {
			return await pending;
		} catch (error) {
			if (this.entries.get(key) === pending) this.entries.delete(key);

			throw error;
		}
	}

	private async readNative(key: string): Promise<string | null> {
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

	private async writeNative(key: string, token: string): Promise<void> {
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

	private async deleteNative(key: string): Promise<void> {
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
