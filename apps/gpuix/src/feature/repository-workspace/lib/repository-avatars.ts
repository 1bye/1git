import { MachineLocation } from "../../machines/machine-location";
import { Machines } from "../../machines/machines";
import { type RemoteInfo } from "@1git/git";
import { GitRepository } from "../../machines/repository-access";
import { getRepositoryAvatar } from "@1git/hosting/avatars";
import type { HostingProvider } from "@1git/hosting/provider";
import { parseRemote } from "@1git/hosting/remote";
import { GitHubProvider } from "@1git/hosting/providers/github";
import { GitLabProvider } from "@1git/hosting/providers/gitlab";
import { imageProcessor } from "./image-processing";
import type { RepositoryAvatarCache } from "./repository-avatar-cache";

const cacheLimit = 256;
const imageLimit = 1024 * 1024;
const successLifetimeMs = 24 * 60 * 60 * 1000;
const failureLifetimeMs = 5 * 60 * 1000;

const defaultProviders = async (): Promise<readonly HostingProvider[]> => [
	new GitHubProvider(),
	new GitLabProvider(),
];

export type RepositoryAvatarSource =
	| { readonly path: string }
	| { readonly remote: string; readonly avatarUrl?: string | null };

interface CachedImage {
	readonly src: string | null;
	readonly expires: number;
}

interface AvatarJob {
	readonly source: RepositoryAvatarSource;
	readonly key: string;
	readonly resolve: (src: string | null) => void;
}

/** One window's bounded thumbnail cache. Git and HTTP work run off the render/scroll path. */
export class RepositoryAvatars {
	private readonly controller = new AbortController();
	private readonly images = new Map<string, CachedImage>();
	private readonly pending = new Map<string, Promise<string | null>>();
	private readonly listeners = new Map<string, Set<() => void>>();
	private readonly queue: AvatarJob[] = [];
	private active = 0;
	private readonly assets = new Map<
		string,
		{
			readonly task: Promise<string | null>;
			readonly expires: number;
			readonly imageUrl?: string | null;
		}
	>();

	constructor(
		private readonly providers = defaultProviders,
		private readonly readRemotes = RepositoryAvatars.readRemotes,
		private readonly cache?: RepositoryAvatarCache
	) {}

	static key(source: RepositoryAvatarSource): string {
		return "path" in source ? `path:${source.path}` : `remote:${source.remote}`;
	}

	private static async readRemotes(
		path: string,
		signal: AbortSignal
	): Promise<readonly RemoteInfo[]> {
		const remote = MachineLocation.parse(path);

		if (
			remote &&
			Machines.shared.state(remote.machineId).status !== "Connected"
		)
			return [];

		const opened = await GitRepository.open({ path, signal });

		if (!opened.ok) return [];

		const remotes = await opened.value.getRemotes({ signal });

		return remotes.ok ? remotes.value : [];
	}

	/** Stable snapshot for a single avatar, never a whole-list subscription. */
	read(key: string): string | null {
		return this.images.get(key)?.src ?? null;
	}

	subscribe(key: string, listener: () => void): () => void {
		const listeners = this.listeners.get(key) ?? new Set();

		listeners.add(listener);
		this.listeners.set(key, listeners);

		return () => {
			listeners.delete(listener);

			if (!listeners.size) this.listeners.delete(key);
		};
	}

	/** Deduplicated and limited to four concurrent jobs; failure is an initials fallback. */
	async load(source: RepositoryAvatarSource): Promise<string | null> {
		if (this.controller.signal.aborted) return null;

		const key = RepositoryAvatars.key(source);
		const cached = this.images.get(key);

		if (cached && cached.expires > Date.now()) return cached.src;

		const pending = this.pending.get(key);

		if (pending) return await pending;

		const task = new Promise<string | null>((resolve) => {
			this.queue.push({ source, key, resolve });
		});

		this.pending.set(key, task);
		this.drain();

		return await task;
	}

	dispose(): void {
		this.controller.abort();
		this.listeners.clear();
		this.images.clear();
		this.assets.clear();
		this.drain();
	}

	/** Re-read a changed remote without allowing an older in-flight result to win. */
	async invalidate(path: string): Promise<void> {
		const source = { path };
		const key = RepositoryAvatars.key(source);

		await this.pending.get(key);
		this.images.delete(key);

		if (!this.controller.signal.aborted) void this.load(source);
	}

	private drain(): void {
		while (this.active < 4 && this.queue.length) {
			const job = this.queue.shift();

			if (!job) break;

			if (this.controller.signal.aborted) {
				this.pending.delete(job.key);
				job.resolve(null);

				continue;
			}

			this.active += 1;
			void this.run(job.source, job.key, job.resolve);
		}
	}

	private async run(
		source: RepositoryAvatarSource,
		key: string,
		resolve: (src: string | null) => void
	): Promise<void> {
		let src: string | null = null;

		try {
			if (!this.controller.signal.aborted)
				src = await this.resolve(source, key);
		} catch {
			// Optional artwork must never turn a repository row into an error state.
		} finally {
			this.publish(key, src);

			this.pending.delete(key);
			resolve(src);
			this.active -= 1;
			this.drain();
		}
	}

	private publish(key: string, src: string | null): void {
		if (this.controller.signal.aborted) return;

		this.images.delete(key);
		this.images.set(key, {
			src,
			expires: Date.now() + (src ? successLifetimeMs : failureLifetimeMs),
		});

		while (this.images.size > cacheLimit) {
			const oldest = this.images.keys().next().value;

			if (oldest !== undefined) this.images.delete(oldest);
		}

		for (const listener of this.listeners.get(key) ?? []) listener();
	}

	private async resolve(
		source: RepositoryAvatarSource,
		key: string
	): Promise<string | null> {
		const providers = await this.providers();

		const remotes =
			"remote" in source
				? [source.remote]
				: [...(await this.readRemotes(source.path, this.controller.signal))]
						.sort(
							(left, right) =>
								Number(right.name === "origin") - Number(left.name === "origin")
						)
						.flatMap((remote) => remote.fetchUrls);

		for (const remote of remotes) {
			const parsed = parseRemote(remote, providers);

			if (!parsed.ok) continue;

			const identity = parsed.value;

			const provider = providers.find((candidate) => {
				const url = new URL(
					candidate.options.webUrl ?? candidate.defaultWebUrl
				);

				return (
					candidate.id === identity.providerId &&
					identity.browserUrl.startsWith(`${url.href.replace(/\/$/u, "")}/`)
				);
			});

			if (!provider) continue;

			const assetKey = `${provider.id}:${provider.options.webUrl ?? provider.defaultWebUrl}:${provider.avatarCacheKey(identity.repository)}`;

			const imageUrl = provider.avatarUrl(
				"remote" in source ? source.avatarUrl : undefined
			);

			const diskKey = `${assetKey}\n${imageUrl ?? ""}`;
			const cached = await this.cache?.read(diskKey);

			if (this.controller.signal.aborted) return null;

			if (cached) {
				if (cached.updatedAt + successLifetimeMs > Date.now())
					return cached.src;

				this.publish(key, cached.src);
			}

			let asset = this.assets.get(assetKey);

			if (
				!asset ||
				asset.expires <= Date.now() ||
				(imageUrl && imageUrl !== asset.imageUrl)
			) {
				asset = {
					task: this.downloadAndCache(
						provider,
						identity.repository,
						diskKey,
						imageUrl
					),
					expires: Date.now() + failureLifetimeMs,
					imageUrl,
				};
				this.assets.set(assetKey, asset);

				while (this.assets.size > cacheLimit) {
					const oldest = this.assets.keys().next().value;

					if (oldest !== undefined) this.assets.delete(oldest);
				}
			}

			const src = await asset.task;

			return this.controller.signal.aborted
				? null
				: (src ?? cached?.src ?? null);
		}

		return null;
	}

	private async downloadAndCache(
		provider: HostingProvider,
		ref: { readonly owner: string; readonly name: string },
		diskKey: string,
		imageUrl?: string | null
	): Promise<string | null> {
		const src = await this.download(provider, ref, imageUrl);

		if (src && !this.controller.signal.aborted)
			await this.cache?.write(diskKey, src);

		return src;
	}

	private async download(
		provider: HostingProvider,
		ref: { readonly owner: string; readonly name: string },
		imageUrl?: string | null
	): Promise<string | null> {
		const signal = AbortSignal.any([
			this.controller.signal,
			AbortSignal.timeout(5000),
		]);

		let cancel: () => void = () => {};

		const cancelled = new Promise<null>((resolve) => {
			cancel = () => resolve(null);
			signal.addEventListener("abort", cancel, { once: true });
		});

		try {
			if (signal.aborted) return null;

			return await Promise.race([
				this.downloadImage(provider, ref, signal, imageUrl),
				cancelled,
			]);
		} finally {
			signal.removeEventListener("abort", cancel);
		}
	}

	private async downloadImage(
		provider: HostingProvider,
		ref: { readonly owner: string; readonly name: string },
		signal: AbortSignal,
		imageUrl?: string | null
	): Promise<string | null> {
		try {
			let url = provider.avatarUrl(imageUrl);

			if (!url) {
				const lookup = await getRepositoryAvatar(provider, ref, { signal });

				url = lookup.ok ? lookup.value : null;
			}

			url = provider.avatarThumbnailUrl(url);

			if (!url || signal.aborted) return null;

			// Image origins never receive account tokens, cookies or redirect authorization.
			const response = await (provider.options.fetch ?? fetch)(url, {
				signal,
				redirect: "error",
				credentials: "omit",
			});

			const mime = response.headers.get("content-type")?.split(";")[0]?.trim();

			if (
				signal.aborted ||
				!response.ok ||
				!response.body ||
				!mime ||
				!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime)
			) {
				await response.body?.cancel();

				return null;
			}

			const reader = response.body.getReader();
			const chunks: Uint8Array[] = [];
			let size = 0;

			try {
				while (true) {
					const chunk = await reader.read();

					if (chunk.done) break;

					size += chunk.value.length;

					if (size > imageLimit || signal.aborted) return null;

					chunks.push(chunk.value);
				}
			} finally {
				await reader.cancel();
			}

			const thumbnail = await imageProcessor(Buffer.concat(chunks), {
				limitInputPixels: 16 * 1024 * 1024,
			})
				.resize(64, 64, { fit: "cover" })
				.png()
				.toBuffer();

			return signal.aborted
				? null
				: `data:image/png;base64,${thumbnail.toString("base64")}`;
		} catch {
			return null;
		}
	}
}
