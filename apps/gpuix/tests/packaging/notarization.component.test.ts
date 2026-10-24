/**
 * Covers: Keychain-profile notarization, rejection handling, stapling and Gatekeeper validation.
 * Real: Developer ID configuration, Apple response validation and packaging command orchestration.
 * Doubles: native CLI boundary; no certificates, credentials, Apple upload or publishing.
 * Requires: Bun only.
 */
import { expect, it } from "bun:test";
import { MacSigning } from "../../native/macos-signing";

const environment = {
	ONEGIT_MACOS_SIGNING_IDENTITY: "A".repeat(40),
	ONEGIT_MACOS_TEAM_ID: "BRUNO12345",
	ONEGIT_MACOS_NOTARY_PROFILE: "1git-bruno",
};

it("waits for acceptance, staples the app, and verifies the ticket and Gatekeeper before returning", async () => {
	const signing = await MacSigning.load(environment);
	const calls: string[][] = [];
	let submitTimeoutMs: number | undefined;

	await signing.notarize(
		"/staging/1git.app",
		"/staging/notarization.zip",
		async (args, timeoutMs) => {
			calls.push(args);

			if (args.includes("notarytool")) {
				submitTimeoutMs = timeoutMs;

				return JSON.stringify({
					status: "Accepted",
					id: "00112233-4455-6677-8899-aabbccddeeff",
				});
			}

			return "";
		}
	);

	expect(calls[0]).toContain("--keepParent");
	expect(calls[0]?.slice(-2)).toEqual([
		"/staging/1git.app",
		"/staging/notarization.zip",
	]);
	expect(calls[1]).toContain("1git-bruno");
	expect(calls[1]).toContain("--wait");
	expect(calls[1]).toContain("json");
	expect(submitTimeoutMs).toBeGreaterThan(30 * 60_000);
	expect(calls[2]).toEqual(["xcrun", "stapler", "staple", "/staging/1git.app"]);
	expect(calls[3]).toEqual([
		"xcrun",
		"stapler",
		"validate",
		"/staging/1git.app",
	]);
	expect(calls[4]).toContain("--strict");
	expect(calls[5]).toContain("/usr/sbin/spctl");
	expect(calls[5]).toContain("--assess");
	expect(calls.flat()).not.toContain("--password");
	expect(calls.flat()).not.toContain("--apple-id");
});

it("never staples a rejected, unfinished or malformed notarization", async () => {
	const signing = await MacSigning.load(environment);

	for (const response of [
		JSON.stringify({
			status: "Invalid",
			id: "00112233-4455-6677-8899-aabbccddeeff",
		}),
		JSON.stringify({ status: "In Progress" }),
		JSON.stringify({ status: "Rejected" }),
		JSON.stringify({}),
		"null",
		"not json",
	]) {
		const calls: string[][] = [];

		await expect(
			signing.notarize(
				"/staging/1git.app",
				"/staging/notarization.zip",
				async (args) => {
					calls.push(args);

					return args.includes("notarytool") ? response : "";
				}
			)
		).rejects.toThrow("No release artifacts replaced");
		expect(calls).toHaveLength(2);
	}
});

it("propagates upload, stapling and assessment failures instead of reporting a distributable app", async () => {
	const signing = await MacSigning.load(environment);

	for (const failingCommand of [
		"notarytool",
		"staple",
		"validate",
		"/usr/sbin/spctl",
	]) {
		await expect(
			signing.notarize(
				"/staging/1git.app",
				"/staging/notarization.zip",
				async (args) => {
					if (args.includes(failingCommand))
						throw new Error("native operation failed");

					return JSON.stringify({ status: "Accepted" });
				}
			)
		).rejects.toThrow("native operation failed");
	}
});

it("keeps existing self-signed and ad-hoc packaging offline", async () => {
	for (const signing of [new MacSigning(null), await MacSigning.load({})]) {
		await signing.notarize("/test/1git.app", "/test/archive.zip", async () => {
			throw new Error("Local signing must not access Apple");
		});
		expect(signing.developerID).toBeUndefined();
	}
});
