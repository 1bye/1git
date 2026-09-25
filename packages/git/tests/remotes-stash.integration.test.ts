import { afterEach, describe, expect, test } from "bun:test";

import { GitRepository } from "../src/repository.js";
import {
	RepositoryFixtures,
	unwrapResult,
} from "./_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => {
	await fixtures.cleanup();
});

describe("GitRepository remotes and synchronization", () => {
	test("adds and lists a remote", async () => {
		const fixture = await fixtures.create();
		const remotePath = await fixture.createBareRemote();

		const remotes = unwrapResult(
			await fixture.repository.addRemote({
				name: "origin",
				url: remotePath,
			})
		);

		expect(remotes).toEqual([
			{
				defaultBranch: null,
				fetchUrls: [remotePath],
				name: "origin",
				pushUrls: [remotePath],
			},
		]);
	});

	test("does not persist credentials embedded in HTTP remote URLs", async () => {
		const fixture = await fixtures.create();

		const result = await fixture.repository.addRemote({
			name: "origin",
			url: "https://user:secret@example.com/repository.git",
		});

		expect(result).toMatchObject({
			error: {
				code: "invalid-input",
				message:
					"Remote URL must not contain credentials. Configure a Git credential helper instead.",
			},
			ok: false,
		});
		expect(await fixture.git(["remote"])).toBe("");
	});

	test("renames a remote", async () => {
		const fixture = await fixtures.create();
		const remotePath = await fixture.createBareRemote();
		unwrapResult(
			await fixture.repository.addRemote({
				name: "origin",
				url: remotePath,
			})
		);

		const remotes = unwrapResult(
			await fixture.repository.renameRemote({
				currentName: "origin",
				newName: "upstream",
			})
		);

		expect(remotes[0]?.name).toBe("upstream");
	});

	test("sets and adds remote URLs", async () => {
		const fixture = await fixtures.create();
		const firstRemote = await fixture.createBareRemote("first.git");
		const secondRemote = await fixture.createBareRemote("second.git");
		unwrapResult(
			await fixture.repository.addRemote({
				name: "origin",
				url: firstRemote,
			})
		);

		unwrapResult(
			await fixture.repository.setRemoteUrl({
				name: "origin",
				url: secondRemote,
			})
		);
		const remotes = unwrapResult(
			await fixture.repository.setRemoteUrl({
				add: true,
				name: "origin",
				url: firstRemote,
			})
		);

		expect(remotes[0]?.fetchUrls).toEqual([secondRemote, firstRemote]);
	});

	test("sets a dedicated push URL", async () => {
		const fixture = await fixtures.create();
		const fetchRemote = await fixture.createBareRemote("fetch.git");
		const pushRemote = await fixture.createBareRemote("push.git");
		unwrapResult(
			await fixture.repository.addRemote({
				name: "origin",
				url: fetchRemote,
			})
		);

		const remotes = unwrapResult(
			await fixture.repository.setRemoteUrl({
				name: "origin",
				push: true,
				url: pushRemote,
			})
		);

		expect(remotes[0]?.fetchUrls).toEqual([fetchRemote]);
		expect(remotes[0]?.pushUrls).toEqual([pushRemote]);
	});

	test("removes a remote", async () => {
		const fixture = await fixtures.create();
		const remotePath = await fixture.createBareRemote();
		unwrapResult(
			await fixture.repository.addRemote({
				name: "origin",
				url: remotePath,
			})
		);

		const remotes = unwrapResult(
			await fixture.repository.removeRemote({ name: "origin" })
		);

		expect(remotes).toEqual([]);
	});

	test("pushes and establishes upstream tracking", async () => {
		const fixture = await fixtures.create();
		const remotePath = await fixture.createBareRemote();
		unwrapResult(
			await fixture.repository.addRemote({
				name: "origin",
				url: remotePath,
			})
		);

		const result = unwrapResult(
			await fixture.repository.push({
				branch: "main",
				remote: "origin",
				setUpstream: true,
			})
		);

		expect(result).toMatchObject({
			branch: "main",
			operation: "push",
			remote: "origin",
		});
		expect(result.snapshot.head.upstream).toBe("origin/main");
		expect(
			await fixture.git(["ls-remote", "--heads", "origin", "main"])
		).toContain("refs/heads/main");
	});

	test("reports the fetched remote default branch", async () => {
		const fixture = await fixtures.create();
		const remotePath = await fixture.createBareRemote();
		await fixture.git(["remote", "add", "origin", remotePath]);
		await fixture.git(["push", "--set-upstream", "origin", "main"]);
		await fixture.git(["remote", "set-head", "origin", "main"]);

		const remotes = unwrapResult(await fixture.repository.getRemotes());

		expect(remotes[0]?.defaultBranch).toBe("main");
	});

	test("changes the upstream to an existing remote branch", async () => {
		const fixture = await fixtures.create();
		const remotePath = await fixture.createBareRemote();
		unwrapResult(
			await fixture.repository.addRemote({
				name: "origin",
				url: remotePath,
			})
		);
		unwrapResult(
			await fixture.repository.push({
				branch: "main",
				remote: "origin",
			})
		);
		const result = unwrapResult(
			await fixture.repository.setUpstream({
				branch: "main",
				upstream: "origin/main",
			})
		);

		expect(result.snapshot.head.upstream).toBe("origin/main");
		expect(
			result.branches.branches.find(({ name }) => name === "main")?.upstream
		).toBe("origin/main");
	});

	test("fetches all remotes and returns tracking branches", async () => {
		const fixture = await fixtures.create();
		const remotePath = await fixture.createBareRemote();
		unwrapResult(
			await fixture.repository.addRemote({
				name: "origin",
				url: remotePath,
			})
		);
		unwrapResult(
			await fixture.repository.push({
				branch: "main",
				remote: "origin",
				setUpstream: true,
			})
		);

		const result = unwrapResult(
			await fixture.repository.fetch({ prune: true, remote: "origin" })
		);
		const branches = unwrapResult(await fixture.repository.getBranches());

		expect(result.operation).toBe("fetch");
		expect(
			branches.branches.some((branch) => branch.name === "origin/main")
		).toBe(true);
	});

	test("clones a repository into a structured session", async () => {
		const fixture = await fixtures.create();
		const remotePath = await fixture.createBareRemote();
		unwrapResult(
			await fixture.repository.addRemote({
				name: "origin",
				url: remotePath,
			})
		);
		unwrapResult(
			await fixture.repository.push({
				branch: "main",
				remote: "origin",
				setUpstream: true,
			})
		);

		const cloned = unwrapResult(
			await GitRepository.clone({
				path: fixture.path("clone"),
				remoteUrl: remotePath,
			})
		);
		const snapshot = unwrapResult(await cloned.getSnapshot());

		expect(snapshot.head.branch).toBe("main");
		expect(snapshot.files).toEqual([]);
	});

	test("pulls new commits from a local remote", async () => {
		const fixture = await fixtures.create();
		const remotePath = await fixture.createBareRemote();
		unwrapResult(
			await fixture.repository.addRemote({
				name: "origin",
				url: remotePath,
			})
		);
		unwrapResult(
			await fixture.repository.push({
				branch: "main",
				remote: "origin",
				setUpstream: true,
			})
		);
		const cloned = unwrapResult(
			await GitRepository.clone({
				path: fixture.path("pull-clone"),
				remoteUrl: remotePath,
			})
		);
		await fixture.write("remote-change.txt", "remote\n");
		await fixture.commitAll("remote change");
		unwrapResult(
			await fixture.repository.push({
				branch: "main",
				remote: "origin",
			})
		);

		const pulled = unwrapResult(
			await cloned.pull({
				remote: "origin",
				strategy: "fast-forward-only",
			})
		);
		const content = unwrapResult(
			await cloned.getFileContent({
				path: "remote-change.txt",
				source: { kind: "revision", revision: "HEAD" },
			})
		);

		expect(pulled.operation).toBe("pull");
		expect(content.content).toBe("remote\n");
	});

	test("rejects branch-only pull and upstream push inputs", async () => {
		const fixture = await fixtures.create();

		const pull = await fixture.repository.pull({ branch: "main" });
		const push = await fixture.repository.push({ setUpstream: true });

		expect(pull).toMatchObject({
			error: { code: "invalid-input" },
			ok: false,
		});
		expect(push).toMatchObject({
			error: { code: "invalid-input" },
			ok: false,
		});
	});
});

describe("GitRepository stash", () => {
	test("creates and lists a named stash", async () => {
		const fixture = await fixtures.create();
		await fixture.write("README.md", "changed\n");

		const snapshot = unwrapResult(
			await fixture.repository.stash({ message: "desktop work" })
		);
		const stashes = unwrapResult(await fixture.repository.getStashes());

		expect(snapshot.files).toEqual([]);
		expect(snapshot.stashCount).toBe(1);
		expect(stashes[0]?.summary).toContain("desktop work");
	});

	test("includes untracked paths when requested", async () => {
		const fixture = await fixtures.create();
		await fixture.write("untracked.txt", "untracked\n");

		unwrapResult(
			await fixture.repository.stash({
				includeUntracked: true,
				message: "untracked",
			})
		);

		expect(unwrapResult(await fixture.repository.getSnapshot()).files).toEqual(
			[]
		);
	});

	test("applies a stash without removing it", async () => {
		const fixture = await fixtures.create();
		await fixture.write("README.md", "stashed\n");
		unwrapResult(await fixture.repository.stash({ message: "apply me" }));

		const snapshot = unwrapResult(
			await fixture.repository.applyStash({ reference: "stash@{0}" })
		);
		const stashes = unwrapResult(await fixture.repository.getStashes());

		expect(snapshot.files[0]?.path).toBe("README.md");
		expect(stashes).toHaveLength(1);
	});

	test("pops a stash and removes it", async () => {
		const fixture = await fixtures.create();
		await fixture.write("README.md", "stashed\n");
		unwrapResult(await fixture.repository.stash({ message: "pop me" }));

		const snapshot = unwrapResult(
			await fixture.repository.popStash({ reference: "stash@{0}" })
		);
		const stashes = unwrapResult(await fixture.repository.getStashes());

		expect(snapshot.files[0]?.path).toBe("README.md");
		expect(stashes).toEqual([]);
	});

	test("keeps a stash when pop produces conflicts", async () => {
		const fixture = await fixtures.create();
		await fixture.write("README.md", "stashed\n");
		unwrapResult(
			await fixture.repository.stash({ message: "keep on conflict" })
		);
		await fixture.write("README.md", "current\n");
		await fixture.commitAll("competing change");

		const result = await fixture.repository.popStash({
			reference: "stash@{0}",
		});
		const stashes = unwrapResult(await fixture.repository.getStashes());
		const snapshot = unwrapResult(await fixture.repository.getSnapshot());

		expect(result).toMatchObject({
			error: { code: "conflict", operation: "pop-stash" },
			ok: false,
		});
		expect(stashes).toHaveLength(1);
		expect(snapshot.files).toContainEqual(
			expect.objectContaining({
				path: "README.md",
				recordType: "unmerged",
			})
		);
	});

	test("drops a stash", async () => {
		const fixture = await fixtures.create();
		await fixture.write("README.md", "stashed\n");
		unwrapResult(await fixture.repository.stash({ message: "drop me" }));

		const stashes = unwrapResult(
			await fixture.repository.dropStash({ reference: "stash@{0}" })
		);

		expect(stashes).toEqual([]);
	});

	test("stashes only selected paths", async () => {
		const fixture = await fixtures.create();
		await fixture.write("README.md", "selected\n");
		await fixture.write("other.txt", "other\n");

		const snapshot = unwrapResult(
			await fixture.repository.stash({
				message: "selected only",
				paths: ["README.md"],
			})
		);

		expect(snapshot.files.map((file) => file.path)).toEqual(["other.txt"]);
	});
});
