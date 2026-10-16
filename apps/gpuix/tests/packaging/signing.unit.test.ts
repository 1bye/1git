/**
 * Covers: certificate pin validation, explicit ad-hoc test mode, and fail-closed release configuration.
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

it("allows explicit ad-hoc packaging for isolated tests but never for publishing", async () => {
	const env = { ONEGIT_MACOS_ADHOC: "1" };

	expect((await MacSigning.load(env)).fingerprint).toBe("-");
	await expect(MacSigning.load(env, true)).rejects.toThrow("cannot use ad-hoc");
});
