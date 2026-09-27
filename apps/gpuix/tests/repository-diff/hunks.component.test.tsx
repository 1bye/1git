/**
 * Covers: reviewing hunks before staging and invalidating stale reviews without remounting.
 * Real: native GPUIX diff and buttons.
 * Doubles: Git mutation boundary.
 * Requires: macOS graphics and patched GPUIX.
 */
import { expect, it, mock } from "bun:test";
import { createTestRoot } from "@gpuix/react/testing";
import { RepositoryHunkPreview } from "../../src/feature/repository-workspace/components/repository-hunk-preview";

it("requires hunk selection and submits the exact reviewed patch", async () => {
	const root = createTestRoot({ width: 900, height: 600 });

	const patch =
		"diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n@@ -20 +20 @@\n-before\n+after\n";

	const write = mock(async () => null);

	const click = (id: string) => {
		const node = root.renderer.findByTestId(id);
		const bounds = node && root.renderer.getElementBounds(node.id);

		if (!bounds) throw new Error(`Missing ${id}`);

		root.renderer.nativeSimulateClick(
			bounds.x + bounds.width / 2,
			bounds.y + bounds.height / 2
		);
		root.renderer.flush();
	};

	try {
		const renderPatch = (patch: string) =>
			root.render(
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						width: "100%",
						height: "100%",
					}}
				>
					<RepositoryHunkPreview
						testId="hunk-diff"
						patch={patch}
						aria-label="Diff"
						action="stage"
						onHunk={write}
						disabled={false}
					/>
				</div>
			);

		renderPatch(patch);
		click("hunk-apply");
		expect(write).not.toHaveBeenCalled();
		click("hunk-next");
		expect(root.renderer.getAllText().join(" ")).toContain("Hunk 1 of 2");
		click("hunk-apply");
		await Bun.sleep(0);
		root.renderer.flush();
		expect(write).toHaveBeenCalledWith({
			action: "stage",
			hunkIndex: 0,
			expectedPatch: patch,
		});
		write.mockClear();
		const diff = root.renderer.findByTestId("hunk-diff");

		if (!diff) throw new Error("Missing diff viewport");

		root.renderer.nativeSimulateKeyDown(diff.id, "alt-down");
		root.renderer.flush();
		expect(root.renderer.getAllText().join(" ")).toContain("Hunk 2 of 2");
		root.renderer.nativeSimulateKeyDown(diff.id, "cmd-shift-s");
		root.renderer.flush();
		await Bun.sleep(0);
		expect(write).toHaveBeenCalledWith({
			action: "stage",
			hunkIndex: 1,
			expectedPatch: patch,
		});
		await Bun.sleep(0);
		root.renderer.flush();
		const viewport = root.renderer.findByTestId("hunk-diff-content")?.id;

		expect(viewport).toBeDefined();
		write.mockClear();
		renderPatch(patch.replace("+after", "+updated"));
		expect(root.renderer.findByTestId("hunk-diff-content")?.id).toBe(viewport);
		expect(root.renderer.getAllText().join(" ")).toContain(
			"All changes · 2 hunks"
		);
		click("hunk-apply");
		expect(write).not.toHaveBeenCalled();
	} finally {
		root.unmount();
	}
});
