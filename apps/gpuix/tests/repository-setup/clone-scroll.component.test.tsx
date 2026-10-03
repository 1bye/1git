/**
 * Covers: bounded native clone-list scrolling, selection and fixed footer at large list sizes.
 * Real: App, React and native GPUIX layout/paint/wheel events.
 * Doubles: disposable account metadata/vault and provider repositories; no live accounts.
 * Requires: patched release native addon and macOS graphics access.
 */
import { expect, it, mock, spyOn } from "bun:test";
import { rmSync } from "node:fs";
import { createTestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import { hostingRepositories } from "../_shared/hosting-repositories";

for (const count of [30, 300, 3000]) {
	it(`keeps native wheel scrolling within budget with ${count} repositories`, async () => {
		const f = hostingRepositories();
		const root = createTestRoot({ width: 980, height: 720 });

		try {
			const account = f.saved[0];

			if (!account) throw new Error("Missing account fixture");

			const page = await f.accounts.repositories(account, "", { pageSize: 30 });
			const template = page.items[0];

			if (!template) throw new Error("Missing repository fixture");

			const repositories = spyOn(f.accounts, "repositories").mockResolvedValue({
				...page,
				next: null,
				items: Array.from({ length: count }, (_, index) => ({
					...template,
					id: String(index),
					ref: { owner: "tester", name: `project-${index}` },
					description:
						"A disposable repository with a reasonably sized description for native rendering.",
				})),
			});

			root.renderer.clockPause();
			root.render(<App accounts={f.accounts} />);
			const trigger = root.renderer.findByTestId("repository-clone");

			const triggerBounds =
				trigger && root.renderer.getElementBounds(trigger.id);

			if (!triggerBounds) throw new Error("Missing clone action");

			root.renderer.nativeSimulateClick(
				triggerBounds.x + 10,
				triggerBounds.y + 10
			);
			await Bun.sleep(200);
			root.renderer.clockFastForward(300);
			root.renderer.advanceTime(1);
			root.renderer.flush();
			const list = root.renderer.findByTestId("clone-repositories");
			const footer = root.renderer.findByTestId("clone-footer");
			const first = root.renderer.findByTestId("clone-repository-0");
			const firstBounds = first && root.renderer.getElementBounds(first.id);

			if (!list || !footer || !firstBounds)
				throw new Error("Missing clone list layout");

			const footerBefore = root.renderer.getElementBounds(footer.id);
			const requestsBefore = repositories.mock.calls.length;
			const final = root.renderer.findByTestId(`clone-repository-${count - 1}`);

			if (!final) throw new Error("Missing final repository");

			expect(root.renderer.getElementBounds(final.id)).toBeNull();

			root.renderer.resetDebugFrameOverlayStats();

			for (let tick = 0; tick < 40; tick++) {
				root.renderer.dispatchScrollWheel(
					firstBounds.x + 20,
					firstBounds.y + 15,
					0,
					-12
				);
			}

			const draw = root.renderer.getDebugFrameOverlayStats();

			process.stdout.write(
				`clone ${count} repositories: native draw p90=${draw.p90Ms?.toFixed(2)}ms max=${draw.maxMs?.toFixed(2)}ms\n`
			);
			expect(draw.samples).toBeGreaterThanOrEqual(40);
			expect(draw.p90Ms).toBeLessThan(12);
			expect(root.renderer.getScrollOffset(list.id)?.[1]).toBeLessThan(-300);
			expect(root.renderer.getElementBounds(footer.id)).toEqual(footerBefore);
			expect(repositories.mock.calls.length).toBe(requestsBefore);
			const visible = root.renderer.findByTestId("clone-repository-10");

			const visibleBounds =
				visible && root.renderer.getElementBounds(visible.id);

			if (!visibleBounds) throw new Error("Missing scrolled repository");

			root.renderer.nativeSimulateClick(
				visibleBounds.x + 20,
				visibleBounds.y + 15
			);
			expect(
				root.renderer.findByTestId("clone-repository-10")?.customProps?.[
					"aria-description"
				]
			).toBe("Selected repository");
			root.renderer.scrollTo(list.id, 0, -(count - 1) * 54);
			root.renderer.flush();
			const last = root.renderer.findByTestId(`clone-repository-${count - 1}`);

			const lastBounds = last && root.renderer.getElementBounds(last.id);

			expect(lastBounds).toBeDefined();
			expect(lastBounds).not.toBeNull();

			if (!lastBounds) throw new Error("Missing final repository bounds");

			expect(lastBounds.y).toBeGreaterThanOrEqual(firstBounds.y);
			expect(lastBounds.y + lastBounds.height).toBeLessThanOrEqual(
				footerBefore?.y ?? 720
			);
			root.renderer.nativeSimulateKeyDown(final.id, "enter");
			root.renderer.flush();
			expect(
				root.renderer.findByTestId(`clone-repository-${count - 1}`)
					?.customProps?.["aria-description"]
			).toBe("Selected repository");
		} finally {
			root.unmount();
			mock.restore();
			rmSync(f.directory, { recursive: true, force: true });
		}
	});
}

it("constrains long repository text at the minimum window size", async () => {
	const f = hostingRepositories();
	const root = createTestRoot({ width: 980, height: 640 });

	try {
		const account = f.saved[0];

		if (!account) throw new Error("Missing account fixture");

		const page = await f.accounts.repositories(account, "", { pageSize: 30 });
		const template = page.items[0];

		if (!template) throw new Error("Missing repository fixture");

		const name = "a-repository-with-a-long-name-".repeat(4);

		spyOn(f.accounts, "repositories").mockResolvedValue({
			...page,
			next: null,
			items: [
				{
					...template,
					ref: { owner: "tester", name },
					description: "Long description with café and 日本語. ".repeat(12),
				},
			],
		});
		root.renderer.clockPause();
		root.render(<App accounts={f.accounts} />);
		const trigger = root.renderer.findByTestId("repository-clone");
		const triggerBounds = trigger && root.renderer.getElementBounds(trigger.id);

		if (!triggerBounds) throw new Error("Missing clone action");

		root.renderer.nativeSimulateClick(
			triggerBounds.x + 10,
			triggerBounds.y + 10
		);
		await Bun.sleep(200);
		root.renderer.clockFastForward(300);
		root.renderer.advanceTime(1);
		root.renderer.flush();
		const row = root.renderer.findByTestId(`clone-repository-${template.id}`);
		const rowBounds = row && root.renderer.getElementBounds(row.id);

		const title = root.renderer.findByTestId(
			`clone-repository-name-${template.id}`
		);

		const titleBounds = title && root.renderer.getElementBounds(title.id);

		const description = root.renderer.findByTestId(
			`clone-repository-description-${template.id}`
		);

		const descriptionBounds =
			description && root.renderer.getElementBounds(description.id);

		if (!row || !rowBounds || !titleBounds || !descriptionBounds)
			throw new Error("Missing long repository layout");

		expect(rowBounds.height).toBe(52);

		for (const bounds of [titleBounds, descriptionBounds]) {
			expect(bounds.x).toBeGreaterThanOrEqual(rowBounds.x + 12);
			expect(bounds.x + bounds.width).toBeLessThanOrEqual(
				rowBounds.x + rowBounds.width - 12
			);
			expect(bounds.y).toBeGreaterThanOrEqual(rowBounds.y);
			expect(bounds.y + bounds.height).toBeLessThanOrEqual(
				rowBounds.y + rowBounds.height
			);
		}

		expect(descriptionBounds.y).toBeGreaterThanOrEqual(
			titleBounds.y + titleBounds.height
		);
		expect(row.customProps?.["aria-label"]).toBe(`tester/${name}`);

		if (process.env.GPUIX_CLONE_LONG_TEXT_SCREENSHOT)
			root.renderer.captureScreenshot(
				process.env.GPUIX_CLONE_LONG_TEXT_SCREENSHOT
			);
	} finally {
		root.unmount();
		mock.restore();
		rmSync(f.directory, { recursive: true, force: true });
	}
});
