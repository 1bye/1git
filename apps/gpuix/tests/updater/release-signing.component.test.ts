/**
 * Covers: release Keychain fallback, explicit override, validation and file-based signing isolation.
 * Real: release signing configuration and public-key validation.
 * Doubles: Keychain lookup; no credentials, native tools, build, or publishing.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import {
	releaseUpdateConfiguration,
	updateConfiguration,
} from "../../native/sparkle";

const feedURL = "https://updates.example.com/appcast.xml";
const publicKey = Buffer.alloc(32, 1).toString("base64");

it("uses the existing public key when no override is exported", async () => {
	let lookups = 0;

	const configuration = await releaseUpdateConfiguration(
		feedURL,
		{},
		async () => {
			lookups++;

			return ` ${publicKey}\n`;
		}
	);

	expect(configuration).toEqual({ feedURL, publicKey });
	expect(lookups).toBe(1);
	expect(updateConfiguration()).toBeUndefined();
});

it("uses an explicit public key without touching Keychain, including file-based signing", async () => {
	const configuration = await releaseUpdateConfiguration(
		feedURL,
		{
			ONEGIT_UPDATE_PUBLIC_KEY: publicKey,
			ONEGIT_UPDATE_KEY_FILE: "/secure/key",
		},
		async () => {
			throw new Error("Must not read Keychain");
		}
	);

	expect(configuration.publicKey).toBe(publicKey);
	await expect(
		releaseUpdateConfiguration(
			feedURL,
			{
				ONEGIT_UPDATE_KEY_FILE: "/secure/key",
			},
			async () => {
				throw new Error("Must not read Keychain");
			}
		)
	).rejects.toThrow("file-based signing");
	await expect(
		releaseUpdateConfiguration(
			feedURL,
			{
				ONEGIT_UPDATE_PUBLIC_KEY: "",
			},
			async () => {
				throw new Error("Must not read Keychain");
			}
		)
	).rejects.toThrow("empty");
	await expect(
		releaseUpdateConfiguration(
			feedURL,
			{
				ONEGIT_UPDATE_PUBLIC_KEY: "invalid",
			},
			async () => {
				throw new Error("Must not read Keychain");
			}
		)
	).rejects.toThrow("Ed25519");
});

it("fails safely on denied/missing keys or invalid tool output without generating a replacement", async () => {
	await expect(
		releaseUpdateConfiguration(feedURL, {}, async () => {
			throw new Error("Keychain lookup denied; no key created");
		})
	).rejects.toThrow("no key created");
	await expect(
		releaseUpdateConfiguration(feedURL, {}, async () => "not a public key")
	).rejects.toThrow("Ed25519");
	await expect(
		releaseUpdateConfiguration(feedURL, {}, async () => "\n")
	).rejects.toThrow("empty");
	await expect(
		releaseUpdateConfiguration(
			"http://updates.example.com/appcast.xml",
			{},
			async () => publicKey
		)
	).rejects.toThrow("HTTPS");
});
