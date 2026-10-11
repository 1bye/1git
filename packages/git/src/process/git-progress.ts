import { StringDecoder } from "node:string_decoder";
import type { GitTransferProgress } from "../contracts.js";

const progressPattern =
	/^(?:remote: )?(Counting objects|Compressing objects|Writing objects|Receiving objects|Resolving deltas):\s+(\d{1,3})%\s+\(\d+\/\d+\)/;

const phases = new Map<string, GitTransferProgress["phase"]>([
	["Counting objects", "counting"],
	["Compressing objects", "compressing"],
	["Writing objects", "sending"],
	["Receiving objects", "receiving"],
	["Resolving deltas", "resolving"],
]);

const maxLineLength = 1024;

/** Per-command, bounded stderr parser. Only recognized numbers and phase names leave this boundary. */
export class GitProgress {
	private readonly decoder = new StringDecoder("utf8");
	private line = "";
	private dropping = false;
	private previous: GitTransferProgress | undefined;

	constructor(
		private readonly onProgress: (progress: GitTransferProgress) => void
	) {}

	write(chunk: Buffer): void {
		this.consume(this.decoder.write(chunk));
	}

	finish(): void {
		this.consume(this.decoder.end());
		this.consume("\n");
	}

	private consume(text: string): void {
		for (const character of text) {
			if (character === "\r" || character === "\n") {
				if (!this.dropping) this.report(this.line);

				this.line = "";
				this.dropping = false;
			} else if (!this.dropping) {
				this.line += character;

				if (this.line.length > maxLineLength) {
					this.line = "";
					this.dropping = true;
				}
			}
		}
	}

	private report(line: string): void {
		const match = progressPattern.exec(line);

		if (!match) return;

		const name = match[1];
		const percent = Number(match[2]);

		if (!name || percent > 100) return;

		const phase = phases.get(name);

		if (!phase) return;

		if (this.previous?.phase === phase && this.previous.percent === percent)
			return;

		this.previous = { phase, percent };

		try {
			this.onProgress(this.previous);
		} catch {
			// Presentation observers must not interrupt a running Git write or its cleanup.
		}
	}
}
