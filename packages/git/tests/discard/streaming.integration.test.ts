/**
 * Covers: streamed discard rollback and cancellation before destructive writes.
 * Real: Git, disk-backed patches and disposable repositories.
 * Doubles: one injected Git apply failure or cancellation at the process boundary.
 * Requires: Git and writable temporary storage; no user data or network.
 */
import { afterEach, expect, it, mock, spyOn } from "bun:test";
import {
	GitCommandFailure,
	GitProcess,
} from "../../src/process/git-process.js";
import {
	RepositoryFixtures,
	unwrapResult,
} from "../_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => {
	mock.restore();
	await fixtures.cleanup();
});

it.each(["worktree", "index"])(
	"rolls back disk-backed patches if the %s apply fails",
	async (phase) => {
		const cached = phase === "index";
		const fixture = await fixtures.create();

		await fixture.write("README.md", "staged\n");
		await fixture.git(["add", "README.md"]);
		await fixture.write("README.md", "working\n");
		await fixture.write("new.txt", "untracked\n");
		await fixture.write("keep.txt", "excluded\n");
		const snapshot = unwrapResult(await fixture.repository.getSnapshot());
		const beforeIndex = await fixture.git(["diff", "--cached"]);
		const originalRun = GitProcess.prototype.run;
		let injected = false;

		spyOn(GitProcess.prototype, "run").mockImplementation(async function (
			this: GitProcess,
			input
		) {
			if (
				!injected &&
				input.args[0] === "apply" &&
				input.args.includes("--reverse") &&
				!input.args.includes("--check") &&
				input.args.includes("--cached") === cached &&
				input.args.at(-1)?.endsWith("/staged.patch")
			) {
				injected = true;

				throw new GitCommandFailure(1, "Injected apply failure");
			}

			return await originalRun.call(this, input);
		});
		const result = await fixture.repository.discardFiles({
			allowDestructive: true,
			paths: ["README.md", "new.txt"],
			recovery: {
				directory: fixture.path("recovery"),
				expectedHead: snapshot.head.oid,
				expectedBranch: snapshot.head.branch,
			},
		});

		expect(injected).toBe(true);
		expect(result.ok).toBe(false);
		expect(await fixture.git(["diff", "--cached"])).toBe(beforeIndex);
		expect(await fixture.read("README.md")).toBe("working\n");
		expect(await fixture.read("new.txt")).toBe("untracked\n");
		expect(await fixture.read("keep.txt")).toBe("excluded\n");
		expect(await Bun.file(fixture.path("recovery/README.txt")).exists()).toBe(
			true
		);
	}
);

it("preserves all changes when cancellation arrives during streamed backup preparation", async () => {
	const fixture = await fixtures.create();

	await fixture.write("README.md", "staged\n");
	await fixture.git(["add", "README.md"]);
	await fixture.write("README.md", "working\n");
	const snapshot = unwrapResult(await fixture.repository.getSnapshot());
	const beforeIndex = await fixture.git(["diff", "--cached"]);
	const controller = new AbortController();
	const originalRun = GitProcess.prototype.run;
	let captured = false;

	spyOn(GitProcess.prototype, "run").mockImplementation(async function (
		this: GitProcess,
		input
	) {
		const result = await originalRun.call(this, input);

		if (input.stdoutFile !== undefined && !captured) {
			captured = true;
			controller.abort();
		}

		return result;
	});
	const result = await fixture.repository.discardFiles({
		allowDestructive: true,
		paths: ["README.md"],
		signal: controller.signal,
		recovery: {
			directory: fixture.path("recovery"),
			expectedHead: snapshot.head.oid,
			expectedBranch: snapshot.head.branch,
		},
	});

	expect(captured).toBe(true);
	expect(result).toMatchObject({ ok: false, error: { code: "aborted" } });
	expect(await fixture.git(["diff", "--cached"])).toBe(beforeIndex);
	expect(await fixture.read("README.md")).toBe("working\n");
});
