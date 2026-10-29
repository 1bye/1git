import type { RepositorySnapshot } from "@1git/git";
import type { RepositoryReader } from "../repository-workspace/lib/repository-reader";
import type { RepositoryWorkspaceState } from "../repository-workspace/lib/repository-workspace-model";

/** Compact working-tree state; tracking counts come from existing refs, never an implicit fetch. */
export interface RepositoryOverview {
	readonly branch: string;
	readonly changes: number;
	readonly ahead: number | null;
	readonly behind: number | null;
}

export type RepositoryOverviewState =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly value: RepositoryOverview }
	| { readonly status: "unavailable"; readonly message: string };

const loading: RepositoryOverviewState = { status: "loading" };
const refreshMs = 15000;

/** Home-owned, visible-only read queue. Open workspaces supply their existing live data. */
export class RepositoryOverviews {
	private readonly entries = new Map<
		string,
		{ state: RepositoryOverviewState; time: number }
	>();
	private readonly listeners = new Map<string, Set<() => void>>();
	private readonly requests = new Map<string, AbortController>();
	private readonly opened = new Map<string, RepositoryOverview>();
	private visible = new Set<string>();
	private disposed = false;

	constructor(
		private readonly reader: typeof RepositoryReader.read,
		private readonly available: (path: string) => boolean,
		private readonly now = Date.now
	) {}

	static fromSnapshot(snapshot: RepositorySnapshot): RepositoryOverview {
		return {
			branch: snapshot.head.detached
				? `detached ${snapshot.head.oid?.slice(0, 7) ?? "HEAD"}`
				: (snapshot.head.branch ?? "unborn HEAD"),
			changes: new Set(
				snapshot.files
					.filter((file) => file.recordType !== "ignored")
					.map((file) => file.path)
			).size,
			ahead: snapshot.head.upstream ? snapshot.head.ahead : null,
			behind: snapshot.head.upstream ? snapshot.head.behind : null,
		};
	}

	read(path: string): RepositoryOverviewState {
		return this.entries.get(path)?.state ?? loading;
	}

	subscribe(path: string, listener: () => void): () => void {
		const listeners = this.listeners.get(path) ?? new Set();

		listeners.add(listener);
		this.listeners.set(path, listeners);

		return () => {
			listeners.delete(listener);

			if (!listeners.size) this.listeners.delete(path);
		};
	}

	setOpen(workspaces: readonly RepositoryWorkspaceState[]): void {
		const previous = new Set(this.opened.keys());

		this.opened.clear();

		for (const workspace of workspaces) {
			const repository = workspace.repository;

			if (!repository || workspace.preview) continue;

			this.opened.set(repository.root, {
				branch: repository.branch,
				changes: workspace.entries.changes.length,
				ahead: repository.upstream ? (repository.ahead ?? null) : null,
				behind: repository.upstream ? (repository.behind ?? null) : null,
			});
		}

		for (const path of previous) {
			if (!this.opened.has(path)) this.entries.delete(path);
		}

		this.refresh();
	}

	setVisible(paths: readonly string[]): void {
		this.visible = new Set(paths);

		for (const [path, request] of this.requests) {
			if (!this.visible.has(path) || this.opened.has(path)) request.abort();
		}

		this.refresh();
	}

	refresh(): void {
		if (this.disposed) return;

		for (const path of this.visible) {
			if (!this.available(path)) {
				this.requests.get(path)?.abort();
				this.set(path, {
					status: "unavailable",
					message: "Machine disconnected",
				});
				continue;
			}

			const opened = this.opened.get(path);

			if (opened) {
				this.requests.get(path)?.abort();
				this.set(path, { status: "ready", value: opened });
				continue;
			}

			const cached = this.entries.get(path);

			if (
				cached &&
				this.now() - cached.time < refreshMs &&
				cached.state.status !== "loading" &&
				!(
					cached.state.status === "unavailable" &&
					cached.state.message === "Machine disconnected"
				)
			)
				continue;

			if (this.requests.has(path) || this.requests.size >= 2) continue;

			const request = new AbortController();

			this.requests.set(path, request);
			void this.load(path, request);
		}
	}

	dispose(): void {
		this.disposed = true;

		for (const request of this.requests.values()) request.abort();

		this.listeners.clear();
	}

	private set(path: string, state: RepositoryOverviewState): void {
		const previous = this.entries.get(path)?.state;
		const unchanged = JSON.stringify(previous) === JSON.stringify(state);

		this.entries.set(path, {
			state: unchanged && previous ? previous : state,
			time: this.now(),
		});

		if (!unchanged)
			for (const listener of this.listeners.get(path) ?? []) listener();
	}

	private async load(path: string, request: AbortController): Promise<void> {
		try {
			const result = await this.reader(
				path,
				AbortSignal.any([request.signal, AbortSignal.timeout(10000)])
			);

			if (request.signal.aborted || this.disposed) return;

			this.set(
				path,
				result.ok
					? {
							status: "ready",
							value: RepositoryOverviews.fromSnapshot(result.value),
						}
					: { status: "unavailable", message: result.error.message }
			);
		} catch (error) {
			if (!request.signal.aborted && !this.disposed)
				this.set(path, {
					status: "unavailable",
					message:
						error instanceof Error ? error.message : "Repository unavailable",
				});
		} finally {
			this.requests.delete(path);
			this.refresh();
		}
	}
}
