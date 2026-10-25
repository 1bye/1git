/**
 * Covers: certificate pin validation, explicit Developer ID/team selection, hardened signing and fail-closed configuration.
 * Real: public certificate parsing and signing command construction.
 * Doubles: native command execution; no Keychain, private keys or publishing.
 * Requires: Bun only.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
	MacSigning,
	macSigningConfiguration,
} from "../../native/macos-signing";

let directory: string;

beforeEach(async () => {
	directory = await mkdtemp(resolve(tmpdir(), "1git-signing-unit-"));
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

it("uses the pinned public certificate without loading a private key and signs every nested path with it", async () => {
	const signing = await MacSigning.load(
		{ ONEGIT_MACOS_SIGNING_CONFIG: macSigningConfiguration },
		true
	);

	const calls: string[][] = [];

	for (const path of [
		"/test/Sparkle.framework",
		"/test/native.node",
		"/test/1git.app",
	])
		await signing.sign(path, async (args) => {
			calls.push(args);
		});

	expect(signing.fingerprint).toMatch(/^[A-F0-9]{40}$/u);
	expect(calls).toHaveLength(3);

	for (const call of calls) {
		expect(call).toContain(signing.fingerprint);
		expect(call).not.toContain("-");
	}

	expect(await readFile(macSigningConfiguration, "utf8")).not.toContain(
		"PRIVATE KEY"
	);
});

it("never silently replaces a missing or malformed configured release identity", async () => {
	const path = resolve(directory, "signing.json");
	const env = { ONEGIT_MACOS_SIGNING_CONFIG: path };

	await expect(MacSigning.load(env, true)).rejects.toThrow("not configured");
	await expect(MacSigning.load(env)).rejects.toThrow("not configured");
	await writeFile(path, "{}");
	await expect(MacSigning.load(env, true)).rejects.toThrow("Invalid");
	await expect(MacSigning.load(env)).rejects.toThrow("Invalid");
});

it("rejects a changed certificate fingerprint instead of accepting a different signer", async () => {
	const pin = JSON.parse(await readFile(macSigningConfiguration, "utf8"));
	const path = resolve(directory, "signing.json");

	await writeFile(
		path,
		JSON.stringify({ ...pin, fingerprint: "0".repeat(40) })
	);
	await expect(
		MacSigning.load({ ONEGIT_MACOS_SIGNING_CONFIG: path }, true)
	).rejects.toThrow("Refusing to change");
});

it("allows explicit ad-hoc releases without a certificate", async () => {
	const env = { ONEGIT_MACOS_ADHOC: "1" };

	expect((await MacSigning.load(env)).fingerprint).toBe("-");
	expect((await MacSigning.load(env, true)).fingerprint).toBe("-");
});

it("defaults to ad-hoc packaging without reading a signing identity", async () => {
	const signing = await MacSigning.load({});
	const calls: string[][] = [];

	expect(signing.fingerprint).toBe("-");
	expect(signing.certificate).toBeNull();
	expect(signing.developerID).toBeUndefined();
	await signing.verify(async () => {
		throw new Error("Default packaging must not query Keychain identities.");
	});
	await signing.notarize("/test/1git.app", "/test/app.zip", async () => {
		throw new Error("Default packaging must not contact Apple.");
	});
	await signing.sign("/test/1git.app", async (args) => {
		calls.push(args);
	});
	expect(calls[0]).toContain("--sign");
	expect(calls[0]).toContain("-");
	expect(calls[0]).toContain("--timestamp=none");
});

const developerEnvironment = {
	ONEGIT_MACOS_SIGNING_IDENTITY: "abcdef0123456789abcdef0123456789abcdef01",
	ONEGIT_MACOS_TEAM_ID: "BRUNO12345",
	ONEGIT_MACOS_NOTARY_PROFILE: "1git-bruno",
};

it("selects the explicit Developer ID fingerprint independently of the default self-signed pin", async () => {
	const signing = await MacSigning.load(developerEnvironment, true);

	expect(signing.fingerprint).toBe(
		developerEnvironment.ONEGIT_MACOS_SIGNING_IDENTITY.toUpperCase()
	);
	expect(signing.developerID?.teamID).toBe("BRUNO12345");
	expect(signing.developerID?.notaryProfile).toBe("1git-bruno");
	expect(signing.certificate).toBeNull();
});

it("rejects incomplete, malformed or conflicting Developer ID settings without a fallback", async () => {
	for (const env of [
		{
			ONEGIT_MACOS_SIGNING_IDENTITY:
				developerEnvironment.ONEGIT_MACOS_SIGNING_IDENTITY,
		},
		{ ONEGIT_MACOS_TEAM_ID: "BRUNO12345" },
		{ ONEGIT_MACOS_NOTARY_PROFILE: "1git-bruno" },
		{
			...developerEnvironment,
			ONEGIT_MACOS_SIGNING_IDENTITY: "Developer ID Application: Bruno",
		},
		{ ...developerEnvironment, ONEGIT_MACOS_SIGNING_IDENTITY: "" },
		{ ...developerEnvironment, ONEGIT_MACOS_TEAM_ID: "wrong" },
		{ ...developerEnvironment, ONEGIT_MACOS_NOTARY_PROFILE: "" },
		{ ...developerEnvironment, ONEGIT_MACOS_ADHOC: "1" },
		{ ...developerEnvironment, ONEGIT_MACOS_SIGNING_CONFIG: "" },
		{
			...developerEnvironment,
			ONEGIT_MACOS_SIGNING_CONFIG: macSigningConfiguration,
		},
	])
		await expect(MacSigning.load(env)).rejects.toThrow("Developer ID");
});

it("requires the selected fingerprint to be a usable Developer ID Application certificate from Bruno's team", async () => {
	const signing = await MacSigning.load(developerEnvironment);
	const fingerprint = signing.fingerprint;

	await signing.verify(
		async () =>
			`  1) ${"F".repeat(40)} "Developer ID Application: Other (OTHER12345)"\n  2) ${fingerprint} "Developer ID Application: Bruno (BRUNO12345)"\n  2 valid identities found\n`
	);

	for (const identities of [
		"0 valid identities found",
		`1) ${"F".repeat(40)} "Developer ID Application: Bruno (BRUNO12345)"`,
		`1) ${fingerprint} "Developer ID Application: Bruno (OTHER12345)"`,
		`1) ${fingerprint} "Apple Development: Bruno (BRUNO12345)"`,
		`1) ${fingerprint} "iPhone Distribution: Bruno (BRUNO12345)"`,
		`1) ${fingerprint} "Developer ID Installer: Bruno (BRUNO12345)"`,
	])
		await expect(signing.verify(async () => identities)).rejects.toThrow(
			"No other account"
		);
});

it("uses timestamps and hardened runtime on Developer ID code, with Bun entitlements only on the main app", async () => {
	const signing = await MacSigning.load(developerEnvironment);
	const calls: string[][] = [];

	const run = async (args: string[]): Promise<void> => {
		calls.push(args);
	};

	await signing.sign("/test/native.node", run);
	await signing.sign("/test/Downloader.xpc", run, {
		preserveEntitlements: true,
	});
	await signing.sign("/test/1git.app", run, {
		entitlements: "/test/macos.entitlements",
	});

	for (const args of calls) {
		expect(args).toContain(signing.fingerprint);
		expect(args).toContain("--timestamp");
		expect(args).toContain("runtime");
		expect(args).not.toContain("--timestamp=none");
		expect(args).not.toContain("--deep");
	}

	expect(calls[0]).not.toContain("--entitlements");
	expect(calls[1]).toContain("--preserve-metadata=entitlements");
	expect(calls[1]).not.toContain("--entitlements");
	expect(calls[2]).toContain("/test/macos.entitlements");
});
