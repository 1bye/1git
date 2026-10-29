import type { RepositoryReader } from "./repository-reader";

type Result = Awaited<ReturnType<typeof RepositoryReader.read>>;
type Consumer = {
	resolve: (result: Result) => void;
	reject: (cause: unknown) => void;
	cleanup: () => void;
};
type Request = {
	path: string;
	controller: AbortController;
	consumers: Map<AbortSignal, Consumer>;
};

/** Window-owned repository reads share in-flight results and limit simultaneous Git/SSH work. */
export class RepositoryReadQueue {
	private readonly requests = new Map<string, Request>();
	private pending: Request[] = [];
	private active = 0;

	constructor(private readonly reader: typeof RepositoryReader.read) {}

	read(path: string, signal: AbortSignal): Promise<Result> {
		signal.throwIfAborted();
		let request = this.requests.get(path);

		if (!request) {
			request = {
				path,
				controller: new AbortController(),
				consumers: new Map(),
			};
			this.requests.set(path, request);
			this.pending.push(request);
		}

		const shared = request;

		const result = new Promise<Result>((resolve, reject) => {
			const cancel = () => {
				signal.removeEventListener("abort", cancel);
				shared.consumers.delete(signal);
				reject(signal.reason);

				if (!shared.consumers.size) {
					shared.controller.abort();

					if (this.requests.get(path) === shared) this.requests.delete(path);

					this.pending = this.pending.filter((item) => item !== shared);
				}
			};

			shared.consumers.set(signal, {
				resolve,
				reject,
				cleanup: () => signal.removeEventListener("abort", cancel),
			});
			signal.addEventListener("abort", cancel, { once: true });
		});

		this.pump();

		return result;
	}

	prioritize(path: string): void {
		const index = this.pending.findIndex((request) => request.path === path);

		if (index > 0) this.pending.unshift(...this.pending.splice(index, 1));
	}

	private pump(): void {
		while (this.active < 2 && this.pending.length) {
			const request = this.pending.shift()!;

			this.active++;
			void this.run(request);
		}
	}

	private async run(request: Request): Promise<void> {
		try {
			const result = await this.reader(request.path, request.controller.signal);

			for (const consumer of request.consumers.values())
				consumer.resolve(result);
		} catch (cause) {
			for (const consumer of request.consumers.values()) consumer.reject(cause);
		} finally {
			for (const consumer of request.consumers.values()) consumer.cleanup();

			request.consumers.clear();

			if (this.requests.get(request.path) === request)
				this.requests.delete(request.path);

			this.active--;
			this.pump();
		}
	}
}
