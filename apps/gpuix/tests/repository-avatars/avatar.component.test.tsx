/**
 * Covers: native avatar fallback/loading, stable bounds, stale sources and app surfaces.
 * Real: App, avatar cache, providers, Sharp and GPUIX image rendering.
 * Doubles: HTTP and Git metadata; disposable saved accounts, no live accounts.
 * Requires: patched native renderer and macOS graphics access.
 */
import { expect, it } from "bun:test";
import { rmSync } from "node:fs";
import sharp from "sharp";
import { createTestRoot } from "@gpuix/react/testing";
import { GitHubProvider } from "@1git/hosting/providers/github";
import { App } from "../../src/app";
import {
	RepositoryAvatar,
	RepositoryAvatarContext,
} from "../../src/feature/repository-workspace/components/repository-avatar";
import { RepositoryAvatars } from "../../src/feature/repository-workspace/lib/repository-avatars";
import { hostingRepositories } from "../_shared/hosting-repositories";
import { repositorySnapshot } from "../_shared/repository-snapshot";

it("keeps fixed initials while loading, and never shows a previous source's late image", async () => {
	const root = createTestRoot({ width: 400, height: 220 });

	const png = await sharp({
		create: { width: 8, height: 8, channels: 4, background: "#5577aa" },
	})
		.png()
		.toBuffer();

	let release: (() => void) | undefined;

	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});

	const avatars = new RepositoryAvatars(async () => [
		new GitHubProvider({
			fetch: async () => {
				await wait;

				return new Response(png, { headers: { "content-type": "image/png" } });
			},
		}),
	]);

	const render = (remote: string) =>
		root.render(
			<RepositoryAvatarContext value={avatars}>
				<div style={{ padding: 20 }}>
					<RepositoryAvatar
						testId="avatar"
						label="Project"
						source={{ remote }}
						size={32}
					/>
				</div>
			</RepositoryAvatarContext>
		);

	try {
		render("https://github.com/alice/demo");
		await Bun.sleep(20);
		root.renderer.flush();
		const initial = root.renderer.findByTestId("avatar-initial");
		const frame = root.renderer.findByTestId("avatar");

		expect(initial).toBeDefined();
		expect(JSON.stringify(root.renderer.toJSON())).toContain('"text":"P"');
		expect(frame && root.renderer.getElementBounds(frame.id)?.width).toBe(32);
		render("https://unknown.test/local/repo");
		release?.();
		await Bun.sleep(80);
		root.renderer.flush();
		expect(root.renderer.findByTestId("avatar-image")).toBeUndefined();
		expect(root.renderer.findByTestId("avatar-initial")).toBeDefined();
		render("https://github.com/alice/demo");
		await Bun.sleep(30);
		root.renderer.flush();
		expect(root.renderer.findByTestId("avatar-image")).toBeDefined();
		expect(frame && root.renderer.getElementBounds(frame.id)?.width).toBe(32);
	} finally {
		release?.();
		root.unmount();
		avatars.dispose();
	}
});

it("reuses the same thumbnail in saved repositories, repository tabs and Clone rows", async () => {
	const root = createTestRoot({ width: 980, height: 720 });
	const f = hostingRepositories();

	const png = await sharp({
		create: { width: 8, height: 8, channels: 4, background: "#5577aa" },
	})
		.png()
		.toBuffer();

	let downloads = 0;

	const avatars = new RepositoryAvatars(
		async () => [
			new GitHubProvider({
				fetch: async () => {
					downloads += 1;

					return new Response(png, {
						headers: { "content-type": "image/png" },
					});
				},
			}),
		],
		async () => [
			{
				name: "origin",
				fetchUrls: ["git@github.com:tester/project.git"],
				pushUrls: [],
				defaultBranch: null,
			},
		]
	);

	const click = (id: string) => {
		const node = root.renderer.findByTestId(id);
		const box = node && root.renderer.getElementBounds(node.id);

		if (!box) throw new Error(`Missing ${id}`);

		root.renderer.nativeSimulateClick(
			box.x + box.width / 2,
			box.y + box.height / 2
		);
		root.renderer.flush();
	};

	try {
		root.render(
			<App
				accounts={f.accounts}
				avatars={avatars}
				initialSession={{
					version: 1,
					tabs: [],
					activeId: null,
					recentRepositories: ["/test/project"],
				}}
				readRepository={async () => ({ ok: true, value: repositorySnapshot() })}
			/>
		);
		click("welcome-view-list");
		click("welcome-folder-other");
		await Bun.sleep(120);
		root.renderer.flush();
		expect(
			root.renderer.findByTestId("welcome-avatar-/test/project-image")
		).toBeDefined();
		click("welcome-repository-/test/project");
		await Bun.sleep(120);
		root.renderer.flush();
		expect(
			root.renderer.findByTestId("avatar-workspace-1-image")
		).toBeDefined();
		click("workspace-home");
		click("repository-clone");
		await Bun.sleep(160);
		root.renderer.flush();
		expect(root.renderer.findByTestId("clone-avatar-10-image")).toBeDefined();
		expect(downloads).toBe(1);

		if (process.env.GPUIX_AVATAR_SCREENSHOT) {
			await Bun.sleep(100);
			root.renderer.captureScreenshot(process.env.GPUIX_AVATAR_SCREENSHOT);
		}
	} finally {
		root.unmount();
		avatars.dispose();
		rmSync(f.directory, { recursive: true, force: true });
	}
});

for (const view of ["list", "tiles"] as const) {
	it(`loads ${view} avatars only near the viewport and keeps initials for missing artwork`, async () => {
		const root = createTestRoot({ width: 980, height: 640 });
		const f = hostingRepositories();

		const paths = Array.from(
			{ length: 1000 },
			(_, index) => `/test/discovered-${index}`
		);

		const reads: string[] = [];
		let downloads = 0;

		const png = await sharp({
			create: { width: 8, height: 8, channels: 4, background: "#5e94a8" },
		})
			.png()
			.toBuffer();

		const avatars = new RepositoryAvatars(
			async () => [
				new GitHubProvider({
					fetch: async () => {
						downloads++;

						return new Response(png, {
							headers: { "content-type": "image/png" },
						});
					},
				}),
			],
			async (path) => {
				reads.push(path);

				return path === paths[1]
					? []
					: [
							{
								name: "origin",
								fetchUrls: ["https://github.com/tester/project"],
								pushUrls: [],
								defaultBranch: null,
							},
						];
			}
		);

		const waitFor = async (ready: () => boolean): Promise<void> => {
			const deadline = Date.now() + 3000;

			while (!ready()) {
				if (Date.now() > deadline)
					throw new Error("Timed out waiting for visible avatars");

				await Bun.sleep(10);
				root.renderer.flush();
			}
		};

		try {
			root.render(
				<App
					accounts={f.accounts}
					avatars={avatars}
					initialSession={{
						version: 1,
						tabs: [],
						activeId: null,
						repositoryLibrary: { view, starred: [] },
					}}
					discoverRepositories={async () => ({
						paths,
						scanned: 1000,
						skipped: 0,
						limited: false,
					})}
				/>
			);
			await waitFor(() => !!root.renderer.findByTestId("welcome-folder-other"));
			expect(reads).toHaveLength(0);
			const folder = root.renderer.findByTestId("welcome-folder-other");
			const folderBounds = folder && root.renderer.getElementBounds(folder.id);

			if (!folderBounds) throw new Error("Missing folder tile");

			root.renderer.nativeSimulateClick(
				folderBounds.x + folderBounds.width / 2,
				folderBounds.y + folderBounds.height / 2
			);
			root.renderer.flush();
			await waitFor(
				() => !!root.renderer.findByTestId(`welcome-avatar-${paths[0]}-image`)
			);
			expect(
				root.renderer.findByTestId(`welcome-avatar-${paths[1]}-initial`)
			).toBeDefined();
			expect(
				root.renderer.findByTestId(`welcome-avatar-${paths[1]}-image`)
			).toBeUndefined();
			expect(reads.length).toBeLessThan(25);
			expect(reads).not.toContain(paths[200]);
			expect(downloads).toBe(1);
			const list = root.renderer.findByTestId("welcome-repositories");

			if (!list) throw new Error("Missing discovery list");

			const first = root.renderer.findByTestId(
				`welcome-repository-${paths[0]}`
			);

			if (!first) throw new Error("Missing first repository");

			root.renderer.nativeSimulateKeyDown(first.id, "end");
			root.renderer.flush();
			await waitFor(
				() => !!root.renderer.findByTestId(`welcome-avatar-${paths[999]}-image`)
			);
			expect(reads).toContain("/test/discovered-999");
			expect(reads).not.toContain(paths[200]);
			expect(downloads).toBe(1);
		} finally {
			root.unmount();
			avatars.dispose();
			rmSync(f.directory, { recursive: true, force: true });
		}
	});
}
