/** One repository's debounced refresh queue. Its owner disposes it with the last tab. */
export class RepositoryRefresh {
	private timer: ReturnType<typeof setTimeout> | undefined;
	private deadline: ReturnType<typeof setTimeout> | undefined;
	private request: AbortController | undefined;
	private dirty = false;
	private paused = false;
	private disposed = false;

	constructor(
		private readonly refresh: (signal: AbortSignal) => Promise<void>,
		private readonly onError: (message: string) => void
	) {}

	/** Coalesces event bursts, with a one-second ceiling during continuous writes. */
	invalidate(): void {
		if (this.disposed) return;

		this.dirty = true;

		if (this.paused || this.request) return;

		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.run(), 250);
		this.deadline ??= setTimeout(() => void this.run(), 1000);
	}

	setPaused(paused: boolean): void {
		if (this.paused === paused) return;

		this.paused = paused;

		if (paused) {
			this.clearTimers();

			if (this.request) {
				this.dirty = true;
				this.request.abort();
			}
		} else if (this.dirty) this.invalidate();
	}

	dispose(): void {
		this.disposed = true;
		this.clearTimers();
		this.request?.abort();
	}

	private clearTimers(): void {
		clearTimeout(this.timer);
		clearTimeout(this.deadline);
		this.timer = undefined;
		this.deadline = undefined;
	}

	private async run(): Promise<void> {
		this.clearTimers();

		if (this.disposed || this.paused || this.request || !this.dirty) return;

		this.dirty = false;
		const request = new AbortController();

		this.request = request;

		try {
			await this.refresh(request.signal);
		} catch (error) {
			if (!request.signal.aborted)
				this.onError(
					error instanceof Error
						? error.message
						: "Could not refresh repository."
				);
		} finally {
			this.request = undefined;

			if (this.dirty) this.invalidate();
		}
	}
}
