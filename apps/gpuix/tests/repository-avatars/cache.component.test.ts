/**
 * Covers: deduplicated thumbnails, bounded downloads, remote selection and failure fallback.
 * Real: avatar service, hosting providers, remote parser and Sharp image decoding.
 * Doubles: Git remotes and HTTP responses; no filesystem or live accounts.
 * Requires: none.
 */
import { expect, it, spyOn } from "bun:test";
import sharp from "sharp";
import { GitHubProvider } from "@1git/hosting/providers/github";
import { GitLabProvider } from "@1git/hosting/providers/gitlab";
import { RepositoryAvatars } from "../../src/feature/repository-workspace/lib/repository-avatars";

it("shares one owner download across tabs, saved paths and clone rows", async () => {
	const png = await sharp({
		create: { width: 8, height: 8, channels: 4, background: "#4466aa" },
	})
		.png()
		.toBuffer();

	const requests: { url: string; init?: RequestInit }[] = [];

	const provider = new GitHubProvider({
		fetch: async (url, init) => {
			requests.push({ url: String(url), init });

			return String(url).includes("api.github.com")
				? Response.json({
						avatar_url: "https://avatars.githubusercontent.com/u/1",
					})
				: new Response(png, { headers: { "content-type": "image/png" } });
		},
	});

	const avatars = new RepositoryAvatars(
		async () => [provider],
		async () => [
			{
				name: "backup",
				fetchUrls: ["https://unrecognized.test/other/repo"],
				pushUrls: [],
				defaultBranch: null,
			},
			{
				name: "origin",
				fetchUrls: ["git@github.com:alice/demo.git"],
				pushUrls: [],
				defaultBranch: null,
			},
		]
	);

	try {
		const sources = [
			{ path: "/test/project" },
			{ remote: "https://github.com/alice/demo" },
			{ remote: "https://github.com/alice/another" },
		];

		const images = await Promise.all(
			sources.map(async (source) => await avatars.load(source))
		);

		expect(new Set(images).size).toBe(1);
		expect(images[0]).toStartWith("data:image/png;base64,");
		expect(requests).toHaveLength(2);
		expect(new Headers(requests[1]?.init?.headers).has("authorization")).toBe(
			false
		);
		expect(requests[1]?.init?.credentials).toBe("omit");
		expect(requests[1]?.init?.redirect).toBe("error");
		expect(await avatars.load(sources[0] ?? { path: "" })).toBe(
			images[0] ?? null
		);
	} finally {
		avatars.dispose();
	}
});

it("uses validated GitLab metadata without a public-project lookup", async () => {
	const png = await sharp({
		create: { width: 4, height: 4, channels: 4, background: "red" },
	})
		.png()
		.toBuffer();

	let count = 0;

	const avatars = new RepositoryAvatars(async () => [
		new GitLabProvider({
			webUrl: "https://git.company.test",
			fetch: async (url) => {
				count += 1;
				expect(String(url)).toBe(
					"https://git.company.test/uploads/project.png"
				);

				return new Response(png, { headers: { "content-type": "image/png" } });
			},
		}),
	]);

	try {
		expect(
			await avatars.load({
				remote: "https://git.company.test/group/nested/project",
				avatarUrl: "https://git.company.test/uploads/project.png",
			})
		).toStartWith("data:image/png;base64,");
		expect(count).toBe(1);
	} finally {
		avatars.dispose();
	}
});

it("falls back for missing remotes, unsafe metadata, invalid bytes and oversized streams", async () => {
	for (const reply of [
		() =>
			new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }),
		() => new Response("invalid", { headers: { "content-type": "image/png" } }),
		() =>
			new Response(new Uint8Array(1024 * 1024 + 1), {
				headers: { "content-type": "image/png" },
			}),
		() => new Response(null, { status: 302 }),
	]) {
		const avatars = new RepositoryAvatars(
			async () => [new GitHubProvider({ fetch: async () => reply() })],
			async () => []
		);

		try {
			expect(await avatars.load({ path: "/missing" })).toBeNull();
			expect(
				await avatars.load({
					remote: "https://github.com/alice/demo",
					avatarUrl: "https://avatars.githubusercontent.com/u/1",
				})
			).toBeNull();
			expect(
				await avatars.load({ remote: "https://secret@github.com/alice/demo" })
			).toBeNull();
		} finally {
			avatars.dispose();
		}
	}
});

it("limits work to four concurrent jobs and aborts the window's outstanding requests", async () => {
	let active = 0;
	let peak = 0;

	const provider = new GitHubProvider({
		fetch: async (_url, init) => {
			active += 1;
			peak = Math.max(peak, active);
			await new Promise<void>((resolve) =>
				init?.signal?.addEventListener("abort", () => resolve(), { once: true })
			);
			active -= 1;

			return new Response(null, { status: 404 });
		},
	});

	const avatars = new RepositoryAvatars(async () => [provider]);

	const pending = Array.from({ length: 12 }, (_, index) =>
		avatars.load({ remote: `https://github.com/owner${index}/repo` })
	);

	await Bun.sleep(20);
	expect(peak).toBe(4);
	avatars.dispose();
	expect(await Promise.all(pending)).toEqual(Array(12).fill(null));
	expect(active).toBe(0);
});

it("retries failed artwork after expiry instead of caching failure for the whole session", async () => {
	let now = 1000;
	let found = false;
	const clock = spyOn(Date, "now").mockImplementation(() => now);

	const png = await sharp({
		create: { width: 4, height: 4, channels: 4, background: "blue" },
	})
		.png()
		.toBuffer();

	const avatars = new RepositoryAvatars(async () => [
		new GitHubProvider({
			fetch: async () =>
				found
					? new Response(png, { headers: { "content-type": "image/png" } })
					: new Response(null, { status: 404 }),
		}),
	]);

	const source = {
		remote: "https://github.com/alice/demo",
		avatarUrl: "https://avatars.githubusercontent.com/u/1",
	};

	try {
		expect(await avatars.load(source)).toBeNull();
		found = true;
		expect(await avatars.load(source)).toBeNull();
		now += 6 * 60 * 1000;
		expect(await avatars.load(source)).toStartWith("data:image/png;base64,");
	} finally {
		avatars.dispose();
		clock.mockRestore();
	}
});

it("settles a large queued batch on disposal even when an image fetch ignores cancellation", async () => {
	const avatars = new RepositoryAvatars(async () => [
		new GitHubProvider({
			fetch: async () => await new Promise<Response>(() => {}),
		}),
	]);

	const pending = Array.from({ length: 3000 }, (_, index) =>
		avatars.load({
			remote: `https://github.com/owner${index}/repo`,
			avatarUrl: `https://avatars.githubusercontent.com/u/${index}`,
		})
	);

	await Bun.sleep(10);
	avatars.dispose();
	expect(await Promise.all(pending)).toEqual(Array(3000).fill(null));
});
