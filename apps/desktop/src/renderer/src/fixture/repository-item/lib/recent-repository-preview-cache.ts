import {
	RECENT_REPOSITORY_PREVIEW_CACHE_LIMIT,
	RECENT_REPOSITORY_PREVIEW_CACHE_TTL_MS,
} from "@/fixture/repository-item/constants/repository-context-menu.js";

import type { RecentRepositoryPreview } from "../../../../../shared/repository-session.js";

interface RecentRepositoryPreviewCacheEntry {
	readonly expiresAt: number;
	readonly preview: RecentRepositoryPreview;
}

export type RecentRepositoryPreviewLoader = (
	path: string
) => Promise<RecentRepositoryPreview | null>;

interface RecentRepositoryPreviewCacheOptions {
	readonly loader: RecentRepositoryPreviewLoader;
	readonly maxEntries?: number;
	readonly now?: () => number;
	readonly ttlMs?: number;
}

export class RecentRepositoryPreviewCache {
	private readonly entries = new Map<
		string,
		RecentRepositoryPreviewCacheEntry
	>();
	private readonly loader: RecentRepositoryPreviewLoader;
	private readonly maxEntries: number;
	private readonly now: () => number;
	private readonly pending = new Map<
		string,
		Promise<RecentRepositoryPreview | null>
	>();
	private readonly ttlMs: number;

	constructor({
		loader,
		maxEntries = RECENT_REPOSITORY_PREVIEW_CACHE_LIMIT,
		now = Date.now,
		ttlMs = RECENT_REPOSITORY_PREVIEW_CACHE_TTL_MS,
	}: RecentRepositoryPreviewCacheOptions) {
		if (!(Number.isInteger(maxEntries) && maxEntries > 0)) {
			throw new Error(
				"Recent repository preview cache limit must be positive."
			);
		}
		if (!(Number.isFinite(ttlMs) && ttlMs > 0)) {
			throw new Error("Recent repository preview cache TTL must be positive.");
		}
		this.loader = loader;
		this.maxEntries = maxEntries;
		this.now = now;
		this.ttlMs = ttlMs;
	}

	peek(path: string): RecentRepositoryPreview | null {
		return this.entries.get(path)?.preview ?? null;
	}

	async load(path: string): Promise<RecentRepositoryPreview | null> {
		const cached = this.entries.get(path);
		if (cached && cached.expiresAt > this.now()) {
			return cached.preview;
		}

		const pending = this.pending.get(path);
		if (pending) {
			return await pending;
		}

		const request = this.loadAndRemember(path);
		this.pending.set(path, request);
		try {
			return await request;
		} finally {
			this.pending.delete(path);
		}
	}

	private async loadAndRemember(
		path: string
	): Promise<RecentRepositoryPreview | null> {
		const preview = await this.loader(path);
		if (!preview) {
			return null;
		}

		this.entries.delete(path);
		this.entries.set(path, {
			expiresAt: this.now() + this.ttlMs,
			preview,
		});
		while (this.entries.size > this.maxEntries) {
			const oldestPath = this.entries.keys().next().value;
			if (oldestPath === undefined) {
				break;
			}
			this.entries.delete(oldestPath);
		}
		return preview;
	}
}

export const recentRepositoryPreviewCache = new RecentRepositoryPreviewCache({
	loader: async (path) => {
		const result = await window.desktop.git.sessions.preview({ path });
		return result.ok ? result.value : null;
	},
});
