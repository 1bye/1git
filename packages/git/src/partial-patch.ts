const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const UNSUPPORTED =
	/^(?:rename |copy |old mode |new mode |GIT binary patch|Binary files|(?:new|deleted) file mode (?:120000|160000)|index .* (?:120000|160000))/m;

interface PatchLine {
	readonly text: string;
	readonly key?: string;
	readonly noNewline?: boolean;
}

interface PatchHunk {
	readonly oldStart: number;
	readonly lines: readonly PatchLine[];
}

/** Stable old/new line coordinates shared by the native gutter and the commit transaction. */
export class PartialPatch {
	readonly lines: readonly string[];
	private readonly header: readonly string[];
	private readonly hunks: readonly PatchHunk[];

	constructor(patch: string) {
		const source = patch.split("\n");

		if (source.at(-1) === "") source.pop();

		if (!source[0]?.startsWith("diff --git ") || UNSUPPORTED.test(patch))
			throw new Error("This change only supports whole-file inclusion.");

		const header: string[] = [];
		const hunks: PatchHunk[] = [];
		const keys: string[] = [];
		let current: { oldStart: number; lines: PatchLine[] } | undefined;
		let oldLine = 0;
		let newLine = 0;
		let oldRemaining = 0;
		let newRemaining = 0;

		for (const text of source) {
			const match = HUNK.exec(text);

			if (match) {
				if (oldRemaining || newRemaining) throw new Error("Incomplete diff.");

				oldLine = Number(match[1]);
				newLine = Number(match[3]);
				oldRemaining = Number(match[2] ?? 1);
				newRemaining = Number(match[4] ?? 1);
				current = { oldStart: oldLine, lines: [] };
				hunks.push(current);
				continue;
			}

			if (!current) {
				if (header.length && text.startsWith("diff --git "))
					throw new Error("Select one file at a time.");

				header.push(text);
				continue;
			}

			if (text === "\\ No newline at end of file") {
				const previous = current.lines.pop();

				if (!previous) throw new Error("Invalid newline marker.");

				current.lines.push({ ...previous, noNewline: true });
				continue;
			}

			let key: string | undefined;

			if (text.startsWith("-")) {
				key = `-:${oldLine++}`;
				oldRemaining--;
			} else if (text.startsWith("+")) {
				key = `+:${newLine++}`;
				newRemaining--;
			} else if (text.startsWith(" ")) {
				oldLine++;
				newLine++;
				oldRemaining--;
				newRemaining--;
			} else throw new Error("Invalid diff line.");

			if (oldRemaining < 0 || newRemaining < 0)
				throw new Error("Invalid diff counts.");

			if (key) keys.push(key);

			current.lines.push({ text, key });
		}

		if (oldRemaining || newRemaining || !keys.length)
			throw new Error("No complete text changes to select.");

		this.header = header;
		this.hunks = hunks;
		this.lines = keys;
	}

	/** Keeps excluded deletions as context and drops excluded additions; working files are never rewritten. */
	select(includedLines: readonly string[]): string {
		const selected = new Set(includedLines);
		const available = new Set(this.lines);

		if (!selected.size || [...selected].some((key) => !available.has(key)))
			throw new Error("The selected lines no longer exist.");

		const output = this.header.filter((line) => !line.startsWith("index "));

		const deleted = output.findIndex((line) =>
			line.startsWith("deleted file mode ")
		);

		if (deleted >= 0 && selected.size < available.size) {
			output.splice(deleted, 1);
			const oldPath = output.find((line) => line.startsWith("--- "))?.slice(4);
			const newPath = oldPath?.replace(/^a\//, "b/").replace(/^"a\//, '"b/');
			const destination = output.indexOf("+++ /dev/null");

			if (!newPath || destination < 0)
				throw new Error("Invalid deleted-file patch.");

			output[destination] = `+++ ${newPath}`;
		}

		let delta = 0;

		for (const hunk of this.hunks) {
			if (!hunk.lines.some((line) => line.key && selected.has(line.key)))
				continue;

			const body: string[] = [];
			let oldCount = 0;
			let newCount = 0;

			for (const line of hunk.lines) {
				const prefix = line.text[0];

				if (prefix === "+" && !selected.has(line.key ?? "")) continue;

				const text =
					prefix === "-" && !selected.has(line.key ?? "")
						? ` ${line.text.slice(1)}`
						: line.text;

				if (!text.startsWith("+")) oldCount++;

				if (!text.startsWith("-")) newCount++;

				body.push(text);

				if (line.noNewline) body.push("\\ No newline at end of file");
			}

			let newStart = hunk.oldStart + delta;

			if (!oldCount) newStart++;

			if (!newCount) newStart--;

			output.push(
				`@@ -${hunk.oldStart},${oldCount} +${newStart},${newCount} @@`,
				...body
			);
			delta += newCount - oldCount;
		}

		return `${output.join("\n")}\n`;
	}
}
