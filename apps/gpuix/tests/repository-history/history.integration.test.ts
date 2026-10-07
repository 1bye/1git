/**
 * Covers: anchored pagination, remote commit links, root/merge/rename/deletion diffs and immutable image versions.
 * Real: shared Git backend, history/diff readers, Sharp and disposable Git repositories.
 * Doubles: none.
 * Requires: Git, Sharp and writable temporary storage; no network or graphics.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { GitRepository } from "@1git/git";
import { GitHubProvider } from "@1git/hosting/providers/github";
import { GitLabProvider } from "@1git/hosting/providers/gitlab";

import { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import { RepositoryDiff } from "../../src/feature/repository-workspace/lib/repository-diff";
import {
	previewPixel,
	rasterContent,
	svgContent,
} from "../_shared/image-content";

const execute = promisify(execFile);
let repository: string;

const git = async (...args: string[]): Promise<string> => {
	const result = await execute(
		"git",
		[
			"--literal-pathspecs",
			"-c",
			"user.name=History Test",
			"-c",
			"user.email=history@example.invalid",
			"-c",
			"commit.gpgsign=false",
			"-c",
			"core.hooksPath=/dev/null",
			...args,
		],
		{
			cwd: repository,
			env: {
				...process.env,
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_CONFIG_GLOBAL: "/dev/null",
			},
		}
	);

	return result.stdout.trimEnd();
};

const signal = (): AbortSignal => new AbortController().signal;

it.each([
	[
		"https://github.com/team/project.git",
		"https://github.com/team/project/commit/",
		"View on GitHub",
	],
	[
		"git@github.com:team/project.git",
		"https://github.com/team/project/commit/",
		"View on GitHub",
	],
	[
		"ssh://git@github.com/team/project.git",
		"https://github.com/team/project/commit/",
		"View on GitHub",
	],
	[
		"https://gitlab.com/team/subgroup/project.git",
		"https://gitlab.com/team/subgroup/project/-/commit/",
		"View on GitLab",
	],
	[
		"git@gitlab.com:team/subgroup/project.git",
		"https://gitlab.com/team/subgroup/project/-/commit/",
		"View on GitLab",
	],
	[
		"https://github.example.invalid/team/project.git",
		"https://github.example.invalid/team/project/commit/",
		"View on GitHub",
	],
	[
		"git@gitlab.example.invalid:team/subgroup/project.git",
		"https://gitlab.example.invalid/gitlab/team/subgroup/project/-/commit/",
		"View on GitLab",
	],
	[
		"https://gitlab.example.invalid/gitlab/team/project.git",
		"https://gitlab.example.invalid/gitlab/team/project/-/commit/",
		"View on GitLab",
	],
] as const)(
	"derives a credential-free commit link from %s without fetching",
	async (remote, prefix, label) => {
		await git("commit", "--allow-empty", "-m", "Local commit");
		const head = await git("rev-parse", "HEAD");

		await git("remote", "add", "origin", remote);
		const config = await readFile(join(repository, ".git/config"), "utf8");

		const providers = [
			new GitHubProvider({ webUrl: "https://github.example.invalid" }),
			new GitLabProvider({ webUrl: "https://gitlab.example.invalid/gitlab" }),
		];

		expect(
			await RepositoryHistory.readCommitLink(
				repository,
				head,
				signal(),
				providers
			)
		).toEqual({ label, url: `${prefix}${head}` });
		expect(await git("rev-parse", "HEAD")).toBe(head);
		expect(await git("status", "--porcelain")).toBe("");
		expect(await readFile(join(repository, ".git/config"), "utf8")).toBe(
			config
		);
		expect(await git("for-each-ref", "refs/remotes")).toBe("");
	}
);

it("uses an exact upstream remote before origin and falls back only to origin or a sole remote", async () => {
	await git("commit", "--allow-empty", "-m", "Local commit");
	const head = await git("rev-parse", "HEAD");

	await git(
		"remote",
		"add",
		"company/team",
		"git@gitlab.com:company/team/project.git"
	);
	expect(
		await RepositoryHistory.readCommitLink(repository, head, signal())
	).toEqual({
		label: "View on GitLab",
		url: `https://gitlab.com/company/team/project/-/commit/${head}`,
	});
	await git("remote", "add", "other", "https://github.com/other/project.git");
	expect(
		await RepositoryHistory.readCommitLink(repository, head, signal())
	).toBeNull();
	await git("remote", "add", "origin", "https://github.com/fork/project.git");
	expect(
		await RepositoryHistory.readCommitLink(repository, head, signal())
	).toEqual({
		label: "View on GitHub",
		url: `https://github.com/fork/project/commit/${head}`,
	});
	await git("update-ref", "refs/remotes/company/team/main", head);
	await git("config", "branch.main.remote", "company/team");
	await git("config", "branch.main.merge", "refs/heads/main");
	expect(
		await RepositoryHistory.readCommitLink(repository, head, signal())
	).toEqual({
		label: "View on GitLab",
		url: `https://gitlab.com/company/team/project/-/commit/${head}`,
	});
	await git(
		"remote",
		"set-url",
		"company/team",
		"https://custom.example.invalid/team/project.git"
	);
	expect(
		await RepositoryHistory.readCommitLink(repository, head, signal())
	).toBeNull();
});

it("does not guess browser links for missing, unsupported or credential-bearing remotes or invalid IDs", async () => {
	await git("commit", "--allow-empty", "-m", "Local commit");
	const head = await git("rev-parse", "HEAD");

	expect(
		await RepositoryHistory.readCommitLink(repository, head, signal())
	).toBeNull();
	await git(
		"remote",
		"add",
		"origin",
		"https://custom.example.invalid/team/project.git"
	);

	for (const remote of [
		"https://custom.example.invalid/team/project.git",
		"https://credential@github.com/team/project.git",
		"https://github.com/team/project.git?token=secret",
		"file:///private/tmp/project",
	]) {
		await git("remote", "set-url", "origin", remote);
		expect(
			await RepositoryHistory.readCommitLink(repository, head, signal())
		).toBeNull();
	}

	await git(
		"remote",
		"set-url",
		"origin",
		"https://github.com/team/project.git"
	);

	for (const oid of [
		"HEAD",
		"abcdef",
		"../settings",
		"a".repeat(40) + "?token=secret",
	])
		expect(
			await RepositoryHistory.readCommitLink(repository, oid, signal())
		).toBeNull();

	const controller = new AbortController();

	controller.abort();
	expect(
		await RepositoryHistory.readCommitLink(repository, head, controller.signal)
	).toBeNull();
	expect(await git("rev-parse", "HEAD")).toBe(head);
	expect(await git("status", "--porcelain")).toBe("");
});

it("matches full message bodies literally and supports cancellation", async () => {
	await git(
		"commit",
		"--allow-empty",
		"-m",
		"Short summary",
		"-m",
		"Body contains [Needle]."
	);
	const head = await git("rev-parse", "HEAD");

	const found = await RepositoryHistory.read(
		repository,
		head,
		0,
		signal(),
		"[needle]"
	);

	if (!found.ok) throw new Error(found.error.message);

	expect(found.value.commits.map((commit) => commit.oid)).toEqual([head]);
	expect(found.value.commits[0]?.body).toBe(
		"Short summary\n\nBody contains [Needle]."
	);
	const controller = new AbortController();

	controller.abort();
	const aborted = await RepositoryHistory.read(
		repository,
		head,
		0,
		controller.signal,
		"needle"
	);

	expect(aborted.ok).toBe(false);
	expect(await git("status", "--porcelain")).toBe("");
});

beforeEach(async () => {
	repository = await realpath(await mkdtemp(join(tmpdir(), "gpuix-history-")));
	await git("init", "--initial-branch=main");
	await git("config", "core.fsmonitor", "false");
});
afterEach(async () => {
	await rm(repository, { recursive: true, force: true });
});

const files = async (commit: string) => {
	const result = await RepositoryHistory.readFiles(
		repository,
		commit,
		signal()
	);

	if (!result.ok) throw new Error(result.error.message);

	return result.value;
};

const diff = async (commit: string, path: string) => {
	const selection = (await files(commit)).find(
		(file) => file.id === path
	)?.commitFile;

	if (!selection) throw new Error(`Missing committed file: ${path}`);

	const result = await RepositoryDiff.read(repository, selection, signal());

	if (!result.ok) throw new Error(result.error.message);

	return result.value[0];
};

it("pages from a fixed HEAD without duplicates after another commit, including detached and unborn repositories", async () => {
	const opened = await GitRepository.open({ path: repository });

	if (!opened.ok) throw new Error(opened.error.message);

	expect(await opened.value.getHistory()).toEqual({
		ok: true,
		value: { commits: [], hasMore: false, nextOffset: null },
	});

	for (let index = 0; index < 52; index += 1)
		await git("commit", "--allow-empty", "-m", `Commit ${index}`);

	const head = await git("rev-parse", "HEAD");
	const first = await RepositoryHistory.read(repository, head, 0, signal());

	await git("commit", "--allow-empty", "-m", "New head");
	await git("checkout", "--detach", "HEAD");
	const second = await RepositoryHistory.read(repository, head, 50, signal());

	if (!first.ok || !second.ok) throw new Error("History failed");

	expect(first.value.commits).toHaveLength(50);
	expect(first.value.nextOffset).toBe(50);
	expect(second.value.commits).toHaveLength(2);
	expect(second.value.nextOffset).toBeNull();
	expect(
		new Set(
			[...first.value.commits, ...second.value.commits].map(
				(commit) => commit.oid
			)
		).size
	).toBe(52);
	expect(first.value.commits[0]?.summary).toBe("Commit 51");
	expect(first.value.commits[0]?.author.name).toBe("History Test");
	const oldest = await RepositoryHistory.read(
		repository,
		head,
		0,
		signal(),
		"COMMIT 0"
	);

	if (!oldest.ok) throw new Error(oldest.error.message);

	expect(oldest.value.commits.map((commit) => commit.summary)).toEqual([
		"Commit 0",
	]);
	const author = await RepositoryHistory.read(
		repository,
		head,
		0,
		signal(),
		"history@example.invalid"
	);

	if (!author.ok || author.value.nextOffset === null)
		throw new Error("Missing author results");

	expect(author.value.commits).toHaveLength(50);
	const remaining = await RepositoryHistory.read(
		repository,
		head,
		author.value.nextOffset,
		signal(),
		"history@example.invalid"
	);

	if (!remaining.ok) throw new Error(remaining.error.message);

	expect(remaining.value.commits).toHaveLength(2);
	const hash = await RepositoryHistory.read(
		repository,
		head,
		0,
		signal(),
		head.slice(0, 10)
	);

	if (!hash.ok) throw new Error(hash.error.message);

	expect(hash.value.commits.map((commit) => commit.oid)).toEqual([head]);
	const literal = await RepositoryHistory.read(
		repository,
		head,
		0,
		signal(),
		".*"
	);

	if (!literal.ok) throw new Error(literal.error.message);

	expect(literal.value.commits).toEqual([]);
	expect(first.value.commits[0]?.authoredAt).toMatch(/^\d{4}-/u);
	expect(await files(head)).toEqual([]);
	await git("checkout", "--orphan", "unborn");
	const anchored = await RepositoryHistory.read(repository, head, 50, signal());

	expect(anchored).toEqual(second);
});

it("reads root, rename and deletion patches with literal unusual paths without touching Git state", async () => {
	const path = "café [one]\tline\nfile.txt";

	await writeFile(join(repository, path), "committed content\n");
	await git("add", "--", path);
	await git("commit", "-m", "Root", "-m", "Full commit body");
	const root = await git("rev-parse", "HEAD");

	expect((await files(root))[0]?.status).toBe("A");
	expect((await diff(root, path))?.patch).toContain("+committed content");
	await git("mv", "--", path, "renamed.txt");
	await git("commit", "-m", "Rename");
	const rename = await git("rev-parse", "HEAD");

	expect((await files(rename))[0]?.commitFile?.originalPath).toBe(path);
	expect((await files(rename))[0]?.status).toBe("R");
	expect((await diff(rename, "renamed.txt"))?.patch).toContain(
		"rename to renamed.txt"
	);
	await git("rm", "renamed.txt");
	await git("commit", "-m", "Delete");
	const head = await git("rev-parse", "HEAD");

	await writeFile(join(repository, "dirty.txt"), "staged\n");
	await git("add", "dirty.txt");
	await writeFile(join(repository, "dirty.txt"), "working\n");
	const index = await readFile(join(repository, ".git/index"));
	const deleted = await diff(head, "renamed.txt");

	expect(deleted?.target).toBe("commit");
	expect(deleted?.patch).toContain("-committed content");
	expect((await files(head))[0]?.status).toBe("D");
	expect(await readFile(join(repository, ".git/index"))).toEqual(index);
	expect(await git("rev-parse", "HEAD")).toBe(head);
	expect(await readFile(join(repository, "dirty.txt"), "utf8")).toBe(
		"working\n"
	);
});

it("compares merge commits to their first parent rather than showing combined patches", async () => {
	await git("commit", "--allow-empty", "-m", "Root");
	await git("checkout", "-b", "feature");
	await writeFile(join(repository, "feature.txt"), "feature\n");
	await git("add", "feature.txt");
	await git("commit", "-m", "Feature");
	await git("checkout", "main");
	await writeFile(join(repository, "main.txt"), "main\n");
	await git("add", "main.txt");
	await git("commit", "-m", "Main");
	await git("merge", "--no-ff", "feature", "-m", "Merge");
	const head = await git("rev-parse", "HEAD");

	expect((await files(head)).map((file) => file.id)).toEqual(["feature.txt"]);
	expect((await diff(head, "feature.txt"))?.patch).toContain("+feature");
	expect((await diff(head, "feature.txt"))?.message).toBeNull();
});

it("previews committed raster/SVG versions and binary notices independently of working files", async () => {
	const red = await rasterContent("png", "red");
	const green = await rasterContent("png", "lime");

	await writeFile(
		join(repository, "image.png"),
		Buffer.from(red.content, "base64")
	);
	await writeFile(join(repository, "icon.svg"), svgContent().content);
	await writeFile(join(repository, "binary.bin"), Buffer.from([0, 1, 2]));
	await git("add", ".");
	await git("commit", "-m", "Images");
	const added = await git("rev-parse", "HEAD");

	await writeFile(
		join(repository, "image.png"),
		Buffer.from(green.content, "base64")
	);
	await git("add", "image.png");
	await git("commit", "-m", "Green");
	const changed = await git("rev-parse", "HEAD");

	await git("rm", "image.png", "icon.svg");
	await git("commit", "-m", "Remove images");
	const deleted = await git("rev-parse", "HEAD");

	const comparison = (await diff(changed, "image.png"))?.image;

	expect(await previewPixel(comparison?.before?.image?.src ?? "")).toEqual([
		255, 0, 0, 255,
	]);
	expect(await previewPixel(comparison?.after?.image?.src ?? "")).toEqual([
		0, 255, 0, 255,
	]);
	expect((await diff(added, "image.png"))?.image?.before).toBeNull();
	expect((await diff(deleted, "image.png"))?.image?.after).toBeNull();
	const svg = await diff(added, "icon.svg");

	expect(svg?.image?.svg).toBe(true);
	expect(svg?.image?.after?.image?.width).toBe(32);
	expect(svg?.patch).toContain("+<svg");
	expect((await diff(deleted, "icon.svg"))?.image?.before?.image?.width).toBe(
		32
	);
	expect((await diff(added, "binary.bin"))?.message).toContain("Binary file");
});
