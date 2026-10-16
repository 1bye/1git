/**
 * Covers: window-scoped vault reuse, concurrent reads, rotation/deletion ordering and failed-access retries.
 * Real: NativeCredentials and synthetic byte buffers.
 * Doubles: native credential bridge; no macOS Keychain or user credentials are accessed.
 * Requires: Bun only.
 */
import { expect, it, mock } from "bun:test";
import { NativeCredentials } from "../../src/feature/accounts/lib/native-credentials";

const key = `1git-hosting-v1:${"a".repeat(64)}`;
const otherKey = `1git-hosting-v1:${"b".repeat(64)}`;

it("coalesces concurrent approved reads and reuses them without reopening the vault", async () => {
	const pending = Promise.withResolvers<Buffer | null>();
	const read = mock(async () => await pending.promise);
	const vault = new NativeCredentials({ readHostingCredential: read });
	const first = vault.read(key);
	const second = vault.read(key);
	const bytes = Buffer.from("synthetic-token");

	pending.resolve(bytes);
	expect(await first).toBe("synthetic-token");
	expect(await second).toBe("synthetic-token");
	expect(await vault.read(key)).toBe("synthetic-token");
	expect(read).toHaveBeenCalledTimes(1);
	expect(bytes.every((byte) => byte === 0)).toBe(true);
});

it("retries denied reads only on a later call and does not cache the rejection", async () => {
	const read = mock(async () => Buffer.from("approved"));

	read.mockRejectedValueOnce(new Error("private native error"));
	const vault = new NativeCredentials({ readHostingCredential: read });
	const first = vault.read(key);
	const second = vault.read(key);

	const failed = await Promise.allSettled([first, second]);

	for (const result of failed) {
		expect(result.status).toBe("rejected");

		if (result.status === "rejected")
			expect(String(result.reason)).toContain("Unlock");
	}

	expect(read).toHaveBeenCalledTimes(1);
	expect(await vault.read(key)).toBe("approved");
	expect(read).toHaveBeenCalledTimes(2);
});

it("keeps approved secrets isolated by key and vault/window lifetime", async () => {
	const read = mock(async (requested: string) =>
		Buffer.from(requested === key ? "one" : "two")
	);

	const renderer = { readHostingCredential: read };
	const vault = new NativeCredentials(renderer);

	expect(await vault.read(key)).toBe("one");
	expect(await vault.read(otherKey)).toBe("two");
	expect(await vault.read(key)).toBe("one");
	expect(await new NativeCredentials(renderer).read(key)).toBe("one");
	expect(read).toHaveBeenCalledTimes(3);
	await expect(vault.read("github.com")).rejects.toThrow("Invalid");
	expect(read).toHaveBeenCalledTimes(3);
});

it("orders a slow read, token rotation and disconnect without resurrecting an older token", async () => {
	const pending = Promise.withResolvers<Buffer | null>();
	const read = mock(async () => await pending.promise);
	const events: string[] = [];
	let written: Buffer | undefined;

	const vault = new NativeCredentials({
		readHostingCredential: read,
		async writeHostingCredential(_key: string, bytes: Buffer) {
			written = bytes;
			events.push("write");
		},
		async deleteHostingCredential() {
			events.push("delete");
		},
	});

	const first = vault.read(key);
	const rotate = vault.write(key, "new-token");
	const rotatedRead = vault.read(key);
	const disconnect = vault.delete(key);
	const removedRead = vault.read(key);

	pending.resolve(Buffer.from("old-token"));
	expect(await first).toBe("old-token");
	await rotate;
	expect(await rotatedRead).toBe("new-token");
	await disconnect;
	expect(await removedRead).toBeNull();
	expect(await vault.read(key)).toBeNull();
	expect(read).toHaveBeenCalledTimes(1);
	expect(events).toEqual(["write", "delete"]);
	expect(written?.every((byte) => byte === 0)).toBe(true);
});

it.each(["write", "delete"] as const)(
	"evicts cached credentials after a denied %s and rereads the actual vault",
	async (operation) => {
		const read = mock(async () => Buffer.from("old-token"));

		const vault = new NativeCredentials({
			readHostingCredential: read,
			async writeHostingCredential() {
				throw new Error("denied");
			},
			async deleteHostingCredential() {
				throw new Error("denied");
			},
		});

		expect(await vault.read(key)).toBe("old-token");
		await expect(
			operation === "write" ? vault.write(key, "new-token") : vault.delete(key)
		).rejects.toThrow();
		expect(await vault.read(key)).toBe("old-token");
		expect(read).toHaveBeenCalledTimes(2);
	}
);

it("uses a freshly persisted token without an unnecessary Keychain read", async () => {
	const read = mock(async () => Buffer.from("wrong-old-token"));

	const vault = new NativeCredentials({
		readHostingCredential: read,
		async writeHostingCredential() {},
	});

	await vault.write(key, "new-token");
	expect(await vault.read(key)).toBe("new-token");
	expect(read).not.toHaveBeenCalled();
});
