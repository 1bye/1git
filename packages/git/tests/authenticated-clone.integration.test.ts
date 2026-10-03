/**
 * Covers: one-shot HTTPS clone, clean remotes/config, inherited config isolation, redirect refusal, cancellation and safe errors.
 * Real: Git clone against a disposable authenticated TLS/dumb-HTTP server and real certificates.
 * Doubles: Git executable wrapper trusts only the test CA; server represents hosting transport, not a live provider.
 * Requires: Git, OpenSSL and local TCP listener permission. No user credentials or repositories.
 */
import { afterEach, expect, it } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GitRepository } from "../src/repository.js";
import { RepositoryFixtures } from "./_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => {
	await fixtures.cleanup();
});

async function serverFixture() {
	const fixture = await fixtures.create();

	await fixture.git(["update-server-info"]);
	const cert = fixture.path("cert.pem");
	const key = fixture.path("key.pem");

	const generation = Bun.spawn(
		[
			"openssl",
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-days",
			"1",
			"-subj",
			"/CN=127.0.0.1",
			"-addext",
			"subjectAltName=IP:127.0.0.1",
			"-keyout",
			key,
			"-out",
			cert,
		],
		{ stdout: "ignore", stderr: "ignore" }
	);

	if (await generation.exited)
		throw new Error("Could not create disposable TLS certificate.");

	const requests: { url: URL; authorization: string | null }[] = [];
	const password = "private-fixture-password";
	const basic = `Basic ${Buffer.from(`oauth2:${password}`).toString("base64")}`;
	let redirect: string | undefined;
	let deny = false;

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		tls: { cert: Bun.file(cert), key: Bun.file(key) },
		async fetch(request) {
			const url = new URL(request.url);

			requests.push({
				url,
				authorization: request.headers.get("authorization"),
			});

			if (redirect) return Response.redirect(redirect, 302);

			if (deny || request.headers.get("authorization") !== basic)
				return new Response(`${password} ${basic}`, {
					status: 401,
					headers: { "www-authenticate": 'Basic realm="test"' },
				});

			if (!url.pathname.startsWith("/repo.git/") || url.pathname.includes(".."))
				return new Response(null, { status: 404 });

			const file = Bun.file(
				join(
					fixture.repositoryPath,
					".git",
					url.pathname.slice("/repo.git/".length)
				)
			);

			return (await file.exists())
				? new Response(file, { headers: { "content-type": "text/plain" } })
				: new Response(null, { status: 404 });
		},
	});

	const wrapper = fixture.path("test-git.sh");

	// Public paths only; the wrapper/certificate contain no password. Production has no TLS override.
	await writeFile(
		wrapper,
		`#!/bin/sh\nexec git -c http.sslCAInfo='${cert.replaceAll("'", "'\\''")}' "$@"\n`,
		{ mode: 0o700 }
	);

	return {
		fixture,
		server,
		requests,
		password,
		basic,
		remoteUrl: `https://127.0.0.1:${server.port}/repo.git`,
		runtime: { executable: wrapper },
		redirect(url: string) {
			redirect = url;
		},
		deny() {
			deny = true;
		},
	};
}

it("clones with transient credentials without persisting auth or inheriting a malicious helper/rewrite", async () => {
	const f = await serverFixture();
	const oldCount = process.env.GIT_CONFIG_COUNT;
	const oldKey = process.env.GIT_CONFIG_KEY_0;
	const oldValue = process.env.GIT_CONFIG_VALUE_0;

	try {
		process.env.GIT_CONFIG_COUNT = "1";
		process.env.GIT_CONFIG_KEY_0 = `url.https://evil.invalid/.insteadOf`;
		process.env.GIT_CONFIG_VALUE_0 = "https://127.0.0.1:";
		const result = await GitRepository.clone({
			path: f.fixture.path("clone"),
			remoteUrl: f.remoteUrl,
			runtime: f.runtime,
			httpAuthentication: { username: "oauth2", password: f.password },
		});

		expect(result.ok).toBe(true);
		expect(f.requests.length).toBeGreaterThan(2);
		expect(
			f.requests.every(
				(request) =>
					request.authorization === f.basic &&
					request.url.pathname.startsWith("/repo.git/")
			)
		).toBe(true);
		expect(await readFile(f.fixture.path("clone/README.md"), "utf8")).toBe(
			"# Test repository\n"
		);
		const config = await readFile(f.fixture.path("clone/.git/config"), "utf8");

		expect(config).toContain(f.remoteUrl);
		expect(config).not.toContain(f.password);
		expect(config).not.toContain(f.basic);
		expect(config).not.toContain("extraheader");

		if (result.ok) {
			// The returned session deliberately resumes normal Git config, without the one-shot credential.
			delete process.env.GIT_CONFIG_COUNT;
			const remotes = await result.value.getRemotes();

			expect(remotes.ok && remotes.value[0]?.fetchUrls[0]).toBe(f.remoteUrl);
		}
	} finally {
		for (const [name, value] of [
			["GIT_CONFIG_COUNT", oldCount],
			["GIT_CONFIG_KEY_0", oldKey],
			["GIT_CONFIG_VALUE_0", oldValue],
		]) {
			if (value === undefined) delete process.env[name!];
			else process.env[name!] = value;
		}

		await f.server.stop(true);
	}
});

it("refuses redirects and never returns reflected credentials in errors", async () => {
	const f = await serverFixture();
	let leakedRequests = 0;

	const sink = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch() {
			leakedRequests++;

			return new Response();
		},
	});

	try {
		f.redirect(`http://127.0.0.1:${sink.port}/repo.git`);
		const result = await GitRepository.clone({
			path: f.fixture.path("redirect-clone"),
			remoteUrl: f.remoteUrl,
			runtime: f.runtime,
			httpAuthentication: { username: "oauth2", password: f.password },
		});

		expect(result.ok).toBe(false);
		expect(leakedRequests).toBe(0);
		expect(JSON.stringify(result)).not.toContain(f.password);
		expect(JSON.stringify(result)).not.toContain(f.basic);
	} finally {
		await f.server.stop(true);
		await sink.stop(true);
	}

	const denied = await serverFixture();

	try {
		denied.deny();
		const result = await GitRepository.clone({
			path: denied.fixture.path("denied-clone"),
			remoteUrl: denied.remoteUrl,
			runtime: denied.runtime,
			httpAuthentication: { username: "oauth2", password: denied.password },
		});

		expect(result.ok).toBe(false);
		expect(JSON.stringify(result)).not.toContain(denied.password);
		expect(JSON.stringify(result)).not.toContain(denied.basic);
	} finally {
		await denied.server.stop(true);
	}
});

it("rejects unsafe authentication before spawning Git and honors cancellation", async () => {
	const f = await fixtures.create();

	for (const input of [
		{ remoteUrl: "http://example.com/repo.git" },
		{ remoteUrl: "https://user@example.com/repo.git" },
		{ remoteUrl: "https://example.com/repo.git?secret=x" },
		{ remoteUrl: "https://example.com/repo.git", recurseSubmodules: true },
	]) {
		const result = await GitRepository.clone({
			path: f.path("unsafe-clone"),
			...input,
			httpAuthentication: { username: "oauth2", password: "fixture-password" },
		});

		expect(result.ok).toBe(false);

		if (!result.ok) expect(result.error.code).toBe("invalid-input");
	}

	const controller = new AbortController();

	controller.abort();
	const result = await GitRepository.clone({
		path: f.path("cancelled"),
		remoteUrl: "https://example.com/repo.git",
		signal: controller.signal,
		httpAuthentication: { username: "oauth2", password: "fixture-password" },
	});

	expect(result.ok).toBe(false);

	if (!result.ok) expect(result.error.code).toBe("aborted");
});
