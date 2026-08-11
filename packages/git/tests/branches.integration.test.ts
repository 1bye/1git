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

describe("GitRepository branches and commit sequences", () => {
	test("creates a branch without switching", async () => {
		const fixture = await fixtures.create();

		const result = unwrapResult(
			await fixture.repository.createBranch({ name: "feature/local" })
		);

		expect(result.snapshot.head.branch).toBe("main");
		expect(
			result.branches.branches.find((branch) => branch.name === "feature/local")
		).toMatchObject({
			checkedOut: false,
			type: "local",
		});
	});

	test("creates and checks out a branch in one operation", async () => {
		const fixture = await fixtures.create();

		const result = unwrapResult(
			await fixture.repository.createBranch({
				checkout: true,
				name: "feature/checked-out",
			})
		);

		expect(result.snapshot.head.branch).toBe("feature/checked-out");
		expect(result.branches.current).toBe("feature/checked-out");
	});

	test("switches between existing branches", async () => {
		const fixture = await fixtures.create();
		unwrapResult(
			await fixture.repository.createBranch({
				checkout: true,
				name: "feature/switch",
			})
		);

		const result = unwrapResult(
			await fixture.repository.checkoutBranch({ name: "main" })
		);

		expect(result.snapshot.head.branch).toBe("main");
		expect(result.branches.current).toBe("main");
	});

	test("renames the current branch", async () => {
		const fixture = await fixtures.create();

		const result = unwrapResult(
			await fixture.repository.renameBranch({ newName: "trunk" })
		);

		expect(result.snapshot.head.branch).toBe("trunk");
		expect(
			result.branches.branches.some((branch) => branch.name === "main")
		).toBe(false);
	});

	test("renames a named branch without switching", async () => {
		const fixture = await fixtures.create();
		unwrapResult(await fixture.repository.createBranch({ name: "before" }));

		const result = unwrapResult(
			await fixture.repository.renameBranch({
				currentName: "before",
				newName: "after",
			})
		);

		expect(result.snapshot.head.branch).toBe("main");
		expect(
			result.branches.branches.some((branch) => branch.name === "after")
		).toBe(true);
	});

	test("deletes a merged branch", async () => {
		const fixture = await fixtures.create();
		unwrapResult(await fixture.repository.createBranch({ name: "finished" }));

		const result = unwrapResult(
			await fixture.repository.deleteBranch({ name: "finished" })
		);

		expect(
			result.branches.branches.some((branch) => branch.name === "finished")
		).toBe(false);
	});

	test("requires force to delete an unmerged branch", async () => {
		const fixture = await fixtures.create();
		unwrapResult(
			await fixture.repository.createBranch({
				checkout: true,
				name: "unmerged",
			})
		);
		await fixture.write("unmerged.txt", "work\n");
		await fixture.commitAll("unmerged work");
		unwrapResult(await fixture.repository.checkoutBranch({ name: "main" }));

		const rejected = await fixture.repository.deleteBranch({
			name: "unmerged",
		});
		const deleted = unwrapResult(
			await fixture.repository.deleteBranch({
				force: true,
				name: "unmerged",
			})
		);

		expect(rejected.ok).toBe(false);
		expect(
			deleted.branches.branches.some((branch) => branch.name === "unmerged")
		).toBe(false);
	});

	test("returns an invalid-reference error for malformed branch names", async () => {
		const fixture = await fixtures.create();

		const result = await fixture.repository.createBranch({ name: "bad name" });

		expect(result).toMatchObject({
			error: { code: "invalid-reference", operation: "create-branch" },
			ok: false,
		});
	});

	test("fast-forwards a branch", async () => {
		const fixture = await fixtures.create();
		unwrapResult(
			await fixture.repository.createBranch({
				checkout: true,
				name: "feature/fast-forward",
			})
		);
		await fixture.write("feature.txt", "feature\n");
		const featureOid = await fixture.commitAll("feature");
		unwrapResult(await fixture.repository.checkoutBranch({ name: "main" }));

		const snapshot = unwrapResult(
			await fixture.repository.merge({
				fastForward: "only",
				revision: "feature/fast-forward",
			})
		);

		expect(snapshot.head.oid).toBe(featureOid);
		expect(await fixture.read("feature.txt")).toBe("feature\n");
	});

	test("reports merge conflicts and can abort them", async () => {
		const fixture = await fixtures.create();
		unwrapResult(
			await fixture.repository.createBranch({
				checkout: true,
				name: "feature/conflict",
			})
		);
		await fixture.write("README.md", "feature\n");
		await fixture.commitAll("feature change");
		unwrapResult(await fixture.repository.checkoutBranch({ name: "main" }));
		await fixture.write("README.md", "main\n");
		await fixture.commitAll("main change");

		const conflict = await fixture.repository.merge({
			revision: "feature/conflict",
		});
		const conflictedSnapshot = unwrapResult(
			await fixture.repository.getSnapshot()
		);
		const aborted = unwrapResult(await fixture.repository.abortMerge());

		expect(conflict).toMatchObject({
			error: { code: "conflict", operation: "merge" },
			ok: false,
		});
		expect(conflictedSnapshot.operationState).toBe("merge");
		expect(aborted.operationState).toBe("normal");
	});

	test("restores a conflicted merge and continues after resolution", async () => {
		const fixture = await fixtures.create();
		unwrapResult(
			await fixture.repository.createBranch({
				checkout: true,
				name: "feature/recover",
			})
		);
		await fixture.write("README.md", "feature\n");
		await fixture.commitAll("feature change");
		unwrapResult(await fixture.repository.checkoutBranch({ name: "main" }));
		await fixture.write("README.md", "main\n");
		await fixture.commitAll("main change");
		await fixture.repository.merge({ revision: "feature/recover" });

		const reopened = unwrapResult(
			await GitRepository.open({ path: fixture.repositoryPath })
		);
		const interrupted = unwrapResult(await reopened.getSnapshot());
		await fixture.write("README.md", "resolved\n");
		unwrapResult(await reopened.stage({ paths: ["README.md"] }));
		const recovered = unwrapResult(await reopened.continueMerge());

		expect(interrupted.operationState).toBe("merge");
		expect(interrupted.files).toContainEqual(
			expect.objectContaining({
				path: "README.md",
				recordType: "unmerged",
			})
		);
		expect(recovered.operationState).toBe("normal");
		expect(recovered.files).toEqual([]);
		expect(await fixture.read("README.md")).toBe("resolved\n");
	});

	test("rebases a feature branch onto main", async () => {
		const fixture = await fixtures.create();
		unwrapResult(
			await fixture.repository.createBranch({
				checkout: true,
				name: "feature/rebase",
			})
		);
		await fixture.write("feature.txt", "feature\n");
		await fixture.commitAll("feature");
		unwrapResult(await fixture.repository.checkoutBranch({ name: "main" }));
		await fixture.write("main.txt", "main\n");
		await fixture.commitAll("main");
		unwrapResult(
			await fixture.repository.checkoutBranch({ name: "feature/rebase" })
		);

		const snapshot = unwrapResult(
			await fixture.repository.rebase({ upstream: "main" })
		);

		expect(snapshot.head.branch).toBe("feature/rebase");
		expect(
			await fixture.git(["merge-base", "--is-ancestor", "main", "HEAD"])
		).toBe("");
	});

	test("cherry-picks a commit", async () => {
		const fixture = await fixtures.create();
		unwrapResult(
			await fixture.repository.createBranch({
				checkout: true,
				name: "feature/cherry",
			})
		);
		await fixture.write("picked.txt", "picked\n");
		const pickedOid = await fixture.commitAll("picked");
		unwrapResult(await fixture.repository.checkoutBranch({ name: "main" }));

		const snapshot = unwrapResult(
			await fixture.repository.cherryPick({ revisions: [pickedOid] })
		);

		expect(snapshot.files).toEqual([]);
		expect(await fixture.read("picked.txt")).toBe("picked\n");
	});

	test("reverts a commit", async () => {
		const fixture = await fixtures.create();
		await fixture.write("reverted.txt", "remove later\n");
		const revertedOid = await fixture.commitAll("add reverted file");

		const snapshot = unwrapResult(
			await fixture.repository.revert({ revisions: [revertedOid] })
		);

		expect(snapshot.files).toEqual([]);
		await expect(fixture.read("reverted.txt")).rejects.toThrow();
	});
});

describe("GitRepository tags", () => {
	test("creates lightweight tags", async () => {
		const fixture = await fixtures.create();

		const tags = unwrapResult(
			await fixture.repository.createTag({ name: "v1.0.0" })
		);

		expect(tags[0]).toMatchObject({
			name: "v1.0.0",
			type: "lightweight",
		});
	});

	test("creates annotated tags", async () => {
		const fixture = await fixtures.create();

		const tags = unwrapResult(
			await fixture.repository.createTag({
				message: "First release",
				name: "v1.0.0",
			})
		);

		expect(tags[0]).toMatchObject({
			message: "First release",
			name: "v1.0.0",
			type: "annotated",
		});
		expect(tags[0]?.targetOid).not.toBe(tags[0]?.oid);
	});

	test("deletes tags", async () => {
		const fixture = await fixtures.create();
		unwrapResult(await fixture.repository.createTag({ name: "temporary" }));

		const tags = unwrapResult(
			await fixture.repository.deleteTag({ name: "temporary" })
		);

		expect(tags).toEqual([]);
	});
});
