/** Owns the one workspace's synchronous save-before-AppKit-quit callback. */
export class AppTermination {
	private static prepare: (() => boolean) | undefined;

	static register(prepare: () => boolean): () => void {
		this.prepare = prepare;

		return () => {
			if (this.prepare === prepare) this.prepare = undefined;
		};
	}

	/** A failed save vetoes termination instead of losing the latest draft. */
	static canQuit(): boolean {
		return this.prepare?.() ?? true;
	}
}
