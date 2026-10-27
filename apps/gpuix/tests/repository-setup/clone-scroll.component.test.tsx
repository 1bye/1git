/**
 * Covers: bounded native clone-list scrolling, scrollbar input, selection and fixed footer at large list sizes.
 * Real: App, React and native GPUIX layout/paint/wheel events.
 * Doubles: disposable account metadata/vault and provider repositories; no live accounts.
 * Requires: patched release native addon and macOS graphics access.
 */
import { expect, it, mock, spyOn } from "bun:test";
import { rmSync } from "node:fs";
import { createTestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import { hostingRepositories } from "../_shared/hosting-repositories";
import sharp from "sharp";
import { GitHubProvider } from "@1git/hosting/providers/github";
import { RepositoryAvatars } from "../../src/feature/repository-workspace/lib/repository-avatars";

for (const count of [30, 300, 3000]) {
	it(`keeps native wheel scrolling within budget with ${count} repositories`, async () => {
		const f = hostingRepositories();
		const root = createTestRoot({ width: 980, height: 720 });

		const png = await sharp({
			create: { width: 8, height: 8, channels: 4, background: "#5577aa" },
		})
			.png()
			.toBuffer();

		let downloads = 0;

		const avatars = new RepositoryAvatars(async () => [
			new GitHubProvider({
				fetch: async () => {
					downloads += 1;

					return new Response(png, {
						headers: { "content-type": "image/png" },
					});
				},
			}),
		]);

		try {
			const account = f.saved[0];

			if (!account) throw new Error("Missing account fixture");

			const page = await f.accounts.repositories(account, "", { pageSize: 30 });
			const template = page.items[0];

			if (!template) throw new Error("Missing repository fixture");

			const repositories = spyOn(f.accounts, "repositories").mockResolvedValue({
				...page,
				next: count === 3000 ? "next-page" : null,
				items: Array.from({ length: count }, (_, index) => ({
					...template,
					id: String(index),
					ref: { owner: "tester", name: `project-${index}` },
					browserUrl: `https://github.com/tester/project-${index}`,
					avatarUrl: "https://avatars.githubusercontent.com/u/7",
					description:
						"A disposable repository with a reasonably sized description for native rendering.",
				})),
			});

			root.renderer.clockPause();
			root.render(<App accounts={f.accounts} avatars={avatars} />);
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

			expect(
				root.renderer.findByTestId("workspace-1")?.customProps?.["aria-label"]
			).toBe("Welcome");
			const scrollbar = root.renderer.findByTestId(
				"clone-repositories-scrollbar-vertical"
			);

			if (!scrollbar) throw new Error("Missing clone scrollbar");

			expect(
				root.renderer.getElementBounds(scrollbar.id)?.height
			).toBeGreaterThan(0);

			const final = root.renderer.findByTestId(`clone-repository-${count - 1}`);

			if (count === 3000) {
				expect(final).toBeUndefined();
				expect(root.renderer.findByTestId("clone-more")).toBeUndefined();
				expect(
					root.renderer.findByTestId("clone-repository-1000")
				).toBeUndefined();
			} else {
				expect(
					final ? root.renderer.getElementBounds(final.id) : null
				).toBeNull();
			}

			expect(root.renderer.findByTestId("clone-avatar-0-image")).toBeDefined();
			expect(downloads).toBe(1);

			const footerBefore = root.renderer.getElementBounds(footer.id);
			const requestsBefore = repositories.mock.calls.length;

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

			if (count === 3000) {
				root.renderer.resetDebugFrameOverlayStats();

				for (let tick = 0; tick < 40; tick++)
					root.renderer.dispatchScrollWheel(
						firstBounds.x + 20,
						firstBounds.y + 15,
						0,
						-240
					);

				const shifted = root.renderer.getDebugFrameOverlayStats();

				process.stdout.write(
					`clone ${count} repositories across buffered windows: native draw p90=${shifted.p90Ms?.toFixed(2)}ms max=${shifted.maxMs?.toFixed(2)}ms\n`
				);
				expect(shifted.samples).toBeGreaterThanOrEqual(40);
				expect(shifted.p90Ms).toBeLessThan(12);
				expect(
					root.renderer.findByTestId("clone-repository-0")
				).toBeUndefined();
				const firstVisible = root.renderer.getListScrollTop(list.id)?.[0];

				const painted = root.renderer.findByTestId(
					`clone-repository-${firstVisible}`
				);

				const paintedBounds =
					painted && root.renderer.getElementBounds(painted.id);

				expect(firstVisible).toBeGreaterThan(100);
				expect(paintedBounds).toBeDefined();
				expect(paintedBounds).not.toBeNull();
				expect(root.renderer.getElementBounds(footer.id)).toEqual(footerBefore);
				expect(repositories.mock.calls.length).toBe(requestsBefore);
			}

			if (count === 3000) {
				const bar = root.renderer.getElementBounds(scrollbar.id);

				if (!bar) throw new Error("Missing scrollbar bounds");

				root.renderer.nativeSimulateClick(
					bar.x + bar.width / 2,
					bar.y + bar.height - 3
				);
			} else root.renderer.nativeSimulateKeyDown(scrollbar.id, "end");

			root.renderer.advanceTime(1);
			root.renderer.flush();
			root.renderer.dispatchNativeEvents();
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

			if (!last) throw new Error("Missing final repository");

			if (count === 3000)
				expect(root.renderer.findByTestId("clone-more")).toBeDefined();

			root.renderer.nativeSimulateKeyDown(last.id, "home");
			root.renderer.flush();
			const home = root.renderer.findByTestId("clone-repository-0");

			if (!home) throw new Error("Missing first repository after Home");

			expect(root.renderer.getFocusedElementId()).toBe(home.id);
			root.renderer.nativeSimulateKeyDown(home.id, "end");
			root.renderer.flush();
			const end = root.renderer.findByTestId(`clone-repository-${count - 1}`);

			if (!end) throw new Error("Missing final repository after End");

			expect(root.renderer.getFocusedElementId()).toBe(end.id);
			root.renderer.nativeSimulateKeyDown(end.id, "enter");
			root.renderer.flush();
			expect(
				root.renderer.findByTestId(`clone-repository-${count - 1}`)
					?.customProps?.["aria-description"]
			).toBe("Selected repository");
		} finally {
			root.unmount();
			avatars.dispose();
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
