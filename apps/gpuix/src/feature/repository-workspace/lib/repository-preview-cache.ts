import type { GitResult } from "@1git/git";
import { imageLimits } from "./image-preview";
import {
	RepositoryDiff,
	type DiffSelection,
	type RepositoryDiffSection,
} from "./repository-diff";

/** A working snapshot or immutable commit in one window's preview cache. */
export interface PreviewRequest {
	readonly root: string;
	readonly change: DiffSelection;
	readonly version: object;
}

type Response = GitResult<readonly RepositoryDiffSection[]>;
interface Entry {
	readonly request: PreviewRequest;
	readonly sections: readonly RepositoryDiffSection[];
	readonly bytes: number;
}
interface Pending {
	readonly request: PreviewRequest;
	readonly controller: AbortController;
	readonly promise: Promise<Response>;
	consumers: number;
}

const previewBytes = 32 * 1024 * 1024;
const previewCount = 128;
const intentDelayMs = 80;

/** Window-owned LRU of complete patches and validated image pixels; one background read, shared foreground promises. */
export class RepositoryPreviewCache {
	private readonly entries = new Map<string, Entry>();
	private readonly pending = new Map<string, Pending>();
	private readonly versions = new WeakMap<object, number>();
	private nextVersion = 0;
	private bytes = 0;
	private background: AbortController | null = null;
	private backgroundRequests: readonly PreviewRequest[] = [];
	private intentRequest: PreviewRequest | null = null;
	private intentTimer: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;

	constructor(
		private readonly reader: typeof RepositoryDiff.read = RepositoryDiff.read,
		private readonly maxBytes = previewBytes
	) {}

	/** Immutable IDs ignore status refreshes; live content is scoped to the actual loaded snapshot. */
	key(request: PreviewRequest): string {
		const { root, change, version } = request;
		let snapshot = this.versions.get(version);

		if (snapshot === undefined) {
			snapshot = this.nextVersion++;
			this.versions.set(version, snapshot);
		}

		return JSON.stringify([
			root,
			change.path,
			change.originalPath,
			"commit" in change
				? [change.commit, change.base, change.beforeOid, change.afterOid]
				: snapshot,
		]);
	}

	/** Synchronous hits let the first render show ready content, without an effect/loading frame. */
	peek(request: PreviewRequest): readonly RepositoryDiffSection[] | undefined {
		const key = this.key(request);
		const entry = this.entries.get(key);

		if (!entry) return undefined;

		this.entries.delete(key);
		this.entries.set(key, entry);

		return entry.sections;
	}

	async read(request: PreviewRequest, signal: AbortSignal): Promise<Response> {
		signal.throwIfAborted();

		if (this.disposed) throw new Error("Preview cache is closed.");

		const cached = this.peek(request);

		if (cached) return { ok: true, value: cached };

		const key = this.key(request);
		let job = this.pending.get(key);

		if (!job) {
			const controller = new AbortController();

			job = {
				request,
				controller,
				consumers: 0,
				promise: this.load(request, key, controller),
			};
			this.pending.set(key, job);
		}

		job.consumers += 1;
		const combined = AbortSignal.any([signal, job.controller.signal]);
		const cancelled = Promise.withResolvers<never>();
		const abort = () => cancelled.reject(combined.reason);

		combined.addEventListener("abort", abort, { once: true });

		try {
			combined.throwIfAborted();

			return await Promise.race([job.promise, cancelled.promise]);
		} finally {
			combined.removeEventListener("abort", abort);
			job.consumers -= 1;

			if (job.consumers === 0 && this.pending.get(key) === job) {
				this.pending.delete(key);
				job.controller.abort();
			}
		}
	}

	/** Warms at most two neighbours, serially, without growing an eager repository-wide queue. */
	prefetch(requests: readonly PreviewRequest[]): void {
		this.cancelPrefetch();

		if (this.disposed) return;

		const controller = new AbortController();

		this.background = controller;
		this.backgroundRequests = requests.slice(0, 2);

		const warm = async (): Promise<void> => {
			for (const request of requests.slice(0, 2)) {
				if (controller.signal.aborted) return;

				// Conflicts require a fresh hash at the time of review, never a speculative read.
				if (
					"recordType" in request.change &&
					request.change.recordType === "unmerged"
				)
					continue;

				try {
					await this.read(request, controller.signal);
				} catch {
					// Background failures are retried by the normal, visible selection read.
					if (controller.signal.aborted) return;
				}
			}
		};

		void warm();
	}

	/** A short dwell avoids firing Git/image reads as the pointer crosses a scrolling list. */
	intent(request: PreviewRequest | null): void {
		clearTimeout(this.intentTimer);
		this.intentRequest = request;

		if (!request || this.disposed || this.peek(request)) return;

		this.intentTimer = setTimeout(
			() => this.prefetch([request]),
			intentDelayMs
		);
	}

	cancelPrefetch(): void {
		clearTimeout(this.intentTimer);
		this.background?.abort();
		this.background = null;
		this.backgroundRequests = [];
		this.intentRequest = null;
	}

	/** Drops stale live entries/jobs and roots no longer open in this window. Commit blobs survive refreshes. */
	retain(
		snapshots: readonly { readonly root: string; readonly version: object }[]
	): void {
		const valid = (request: PreviewRequest) =>
			snapshots.some(
				(snapshot) =>
					snapshot.root === request.root &&
					("commit" in request.change || snapshot.version === request.version)
			);

		if (
			this.backgroundRequests.some((request) => !valid(request)) ||
			(this.intentRequest && !valid(this.intentRequest))
		)
			this.cancelPrefetch();

		for (const [key, entry] of this.entries) {
			if (!valid(entry.request)) this.remove(key);
		}

		for (const [key, job] of this.pending) {
			if (!valid(job.request)) {
				this.pending.delete(key);
				job.controller.abort();
			}
		}
	}

	/** Refresh/retry invalidation happens before the new read, even if Git status letters did not change. */
	invalidateWorking(root: string): void {
		this.cancelPrefetch();

		for (const [key, entry] of this.entries) {
			if (entry.request.root === root && !("commit" in entry.request.change))
				this.remove(key);
		}

		for (const [key, job] of this.pending) {
			if (job.request.root === root && !("commit" in job.request.change)) {
				this.pending.delete(key);
				job.controller.abort();
			}
		}
	}

	forget(request: PreviewRequest): void {
		const key = this.key(request);

		this.remove(key);
		const job = this.pending.get(key);

		this.pending.delete(key);
		job?.controller.abort();
	}

	dispose(): void {
		this.disposed = true;
		this.cancelPrefetch();
		this.retain([]);
	}

	private async load(
		request: PreviewRequest,
		key: string,
		controller: AbortController
	): Promise<Response> {
		try {
			const result = await this.reader(
				request.root,
				request.change,
				controller.signal
			);

			controller.signal.throwIfAborted();

			if (
				result.ok &&
				!result.value.some(
					(section) =>
						section.conflict ||
						section.image?.before?.error ||
						section.image?.after?.error
				)
			) {
				const bytes = RepositoryPreviewCache.size(result.value);

				if (bytes <= this.maxBytes) {
					this.remove(key);
					this.entries.set(key, { request, sections: result.value, bytes });
					this.bytes += bytes;

					while (
						this.bytes > this.maxBytes ||
						this.entries.size > previewCount
					) {
						const oldest = this.entries.keys().next().value;

						if (oldest === undefined) break;

						this.remove(oldest);
					}
				}
			}

			return result;
		} finally {
			if (this.pending.get(key)?.controller === controller)
				this.pending.delete(key);
		}
	}

	private remove(key: string): void {
		const entry = this.entries.get(key);

		if (!entry) return;

		this.bytes -= entry.bytes;
		this.entries.delete(key);
	}

	private static size(sections: readonly RepositoryDiffSection[]): number {
		let bytes = 0;

		for (const section of sections) {
			bytes +=
				section.patch.length * 2 + (section.message?.length ?? 0) * 2 + 256;

			for (const stat of section.stats) bytes += stat.path.length * 2 + 64;

			for (const side of [section.image?.before, section.image?.after]) {
				if (!side?.image) continue;

				const { image } = side;

				bytes += image.src.length * 2 + (image.svg?.content.length ?? 0) * 2;
				// Budget the maximum prepared bitmap too, not just a tiny compressed PNG.
				bytes +=
					Math.min(image.width, imageLimits.previewDimension) *
					Math.min(image.height, imageLimits.previewDimension) *
					4;
			}
		}

		return bytes;
	}
}
