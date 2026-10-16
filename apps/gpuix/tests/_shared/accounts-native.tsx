import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GpuixRenderer } from "@gpuix/native";
import { render } from "@gpuix/react";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import { NativeCredentials } from "../../src/feature/accounts/lib/native-credentials";

const renderer = new GpuixRenderer();

renderer.init({
	title: "1git isolated credential test",
	width: 500,
	height: 300,
});
render(<text>Isolated synthetic credential test</text>, { renderer });
const pump = setInterval(() => renderer.tick(), 10);
const vault = new NativeCredentials(renderer);

const key = AccountStore.key({
	provider: "github",
	webUrl: "https://credential-test.invalid/",
	id: randomUUID(),
	username: "synthetic-test-only",
});

let written = false;

try {
	await assert.rejects(vault.read("github.com"), /Invalid application/);
	await vault.write(key, "synthetic-credential-first");
	written = true;
	assert.equal(
		await new NativeCredentials(renderer).read(key),
		"synthetic-credential-first"
	);
	await vault.write(key, "synthetic-credential-second");
	assert.equal(
		await new NativeCredentials(renderer).read(key),
		"synthetic-credential-second"
	);
	const bundle = JSON.stringify({
		accessToken: "a".repeat(3000),
		refreshToken: "b".repeat(3000),
	});

	await vault.write(key, bundle);
	assert.equal(
		await new NativeCredentials(renderer).read(key),
		bundle,
		"OAuth pairs larger than old PAT bound must round-trip securely"
	);
	await vault.delete(key);
	written = false;
	assert.equal(await new NativeCredentials(renderer).read(key), null);

	const takeSettings: unknown = Reflect.get(renderer, "takeSettingsRequested");

	assert.equal(
		typeof takeSettings,
		"function",
		"native Settings bridge must exist"
	);

	if (typeof takeSettings !== "function")
		throw new Error("Missing Settings bridge");

	assert.equal(takeSettings.call(renderer), false);
	renderer.simulateKeystrokes("cmd-,");
	assert.equal(takeSettings.call(renderer), true);
	assert.equal(takeSettings.call(renderer), false);
	process.stdout.write(
		"isolated OS credential round-trip and Settings action verified\n"
	);
} finally {
	if (written) await vault.delete(key);

	clearInterval(pump);
}
